import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { validateRegistry } from '../../src/portos/assetClasses.js';
import { HUENEME_REGISTRY } from '../../src/portos/hueneme.js';
import {
  adminSettings,
  createAdminHandler,
  passwordMatches,
} from './adminApi.js';
import { openAdminStore } from './adminStore.js';

const PASSWORD = 'harbor-staff-2026';

function memoryStore(now = () => 1_000) {
  return openAdminStore({
    dir: ':memory:',
    seed: HUENEME_REGISTRY,
    validate: validateRegistry,
    now,
  });
}

/** Call the handler like Node's HTTP server would and collect the answer. */
async function call(
  handle,
  { method = 'GET', url, body, cookie, headers = {} },
) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress: '10.0.0.1' };
  req.headers = {
    ...(cookie ? { cookie } : {}),
    ...(method !== 'GET' ? { 'x-portos-admin': '1' } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...headers,
  };
  req.destroy = () => {};
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, h) {
      this.status = status;
      this.headers = h;
    },
    end(text) {
      this.body = text;
      this.done();
    },
  };
  const finished = new Promise((resolve) => (res.done = resolve));
  handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await finished;
  const cookieHeader = res.headers['Set-Cookie'];
  return {
    status: res.status,
    json: JSON.parse(res.body),
    cookie: cookieHeader ? cookieHeader.split(';')[0] : null,
    setCookie: cookieHeader,
  };
}

function handler(env = { PORTOS_ADMIN_PASSWORD: PASSWORD }) {
  const store = memoryStore();
  return createAdminHandler({
    settings: adminSettings(env),
    openStore: () => store,
  });
}

async function signIn(handle, name = 'Dana') {
  const r = await call(handle, {
    method: 'POST',
    url: '/session',
    body: { name, password: PASSWORD },
  });
  assert.equal(r.status, 200);
  return r.cookie;
}

test('store seeds the registry once, with seed history', () => {
  const store = memoryStore();
  assert.equal(store.assets().length, HUENEME_REGISTRY.assets.length);
  assert.deepEqual(
    validateRegistry(store.registry()),
    validateRegistry(HUENEME_REGISTRY),
  );
  const seedRows = store.history({ limit: 500 });
  assert.ok(seedRows.every((row) => row.action === 'seed'));
});

test('store records who changed what, and refuses stale revisions', () => {
  let clock = 1_000;
  const store = memoryStore(() => clock);
  const berth = store.assets().find((a) => a.class === 'berth');
  clock = 2_000;
  const saved = store.saveAsset({
    asset: { ...berth, label: 'Wharf 1' },
    by: 'Dana',
    rev: berth.rev,
  });
  assert.equal(saved.rev, berth.rev + 1);
  assert.equal(saved.updatedBy, 'Dana');
  const [entry] = store.history({ assetId: berth.id });
  assert.equal(entry.action, 'update');
  assert.equal(entry.by, 'Dana');
  assert.equal(entry.after.label, 'Wharf 1');
  assert.equal(entry.before.label, berth.label);
  assert.throws(
    () =>
      store.saveAsset({
        asset: { ...berth, label: 'Old' },
        by: 'Lee',
        rev: berth.rev,
      }),
    (error) => error.status === 409 && /Dana/.test(error.message),
  );
});

test('store refuses a change that breaks a reference', () => {
  const store = memoryStore();
  const charger = store.assets().find((a) => a.class === 'charger');
  assert.throws(
    () =>
      store.saveAsset({
        asset: { ...charger, meterId: 'meter-nowhere' },
        by: 'Dana',
        rev: charger.rev,
      }),
    (error) =>
      error.status === 422 &&
      error.details.some((p) => p.includes('meter-nowhere')),
  );
  // Deleting the meter the chargers hang off is refused too.
  const meter = store.assets().find((a) => a.id === charger.meterId);
  assert.throws(
    () => store.deleteAsset({ id: meter.id, by: 'Dana' }),
    (error) => error.status === 422,
  );
  assert.ok(store.assets().some((a) => a.id === meter.id));
});

test('store imports many rows in one checked transaction', () => {
  const store = memoryStore();
  const before = store.assets().length;
  const result = store.importAssets({
    by: 'Dana',
    rows: [
      {
        id: 'meter-shed',
        class: 'meter',
        utility: 'SCE',
        tariffId: 'SCE-TOU-8-D',
      },
      {
        id: 'charger-shed-1',
        class: 'charger',
        meterId: 'meter-shed',
        kw: 150,
      },
    ],
  });
  assert.deepEqual(result, { created: 2, updated: 0, unchanged: 0 });
  assert.equal(store.assets().length, before + 2);
  // A bad row rolls back the whole import.
  assert.throws(() =>
    store.importAssets({
      by: 'Dana',
      rows: [
        {
          id: 'charger-shed-2',
          class: 'charger',
          meterId: 'meter-shed',
          kw: 150,
        },
        {
          id: 'charger-shed-3',
          class: 'charger',
          meterId: 'meter-missing',
          kw: 150,
        },
      ],
    }),
  );
  assert.equal(store.assets().length, before + 2);
});

test('store rejects unsafe ids', () => {
  const store = memoryStore();
  assert.throws(
    () =>
      store.saveAsset({ asset: { id: '../x', class: 'berth' }, by: 'Dana' }),
    (error) => error.status === 400,
  );
});

test('sessions expire', () => {
  let clock = 0;
  const store = memoryStore(() => clock);
  const { token } = store.createSession('Dana');
  assert.deepEqual(store.checkSession(token), { name: 'Dana' });
  clock = 13 * 60 * 60 * 1000;
  assert.equal(store.checkSession(token), null);
});

test('password check needs the exact password and 8+ characters', () => {
  assert.ok(passwordMatches(PASSWORD, PASSWORD));
  assert.ok(!passwordMatches('harbor-staff-2027', PASSWORD));
  assert.ok(!passwordMatches('', null));
  assert.equal(
    adminSettings({ PORTOS_ADMIN_PASSWORD: 'short' }).password,
    null,
  );
  assert.equal(
    adminSettings({ PORTOS_ADMIN_PASSWORD: 'short' }).tooShort,
    true,
  );
});

test('portal stays locked without a password', async () => {
  const handle = handler({});
  const session = await call(handle, { url: '/session' });
  assert.equal(session.status, 200);
  assert.equal(session.json.configured, false);
  const registry = await call(handle, { url: '/registry' });
  assert.equal(registry.status, 503);
});

test('API needs sign-in, the write header, and records the signed-in name', async () => {
  const handle = handler();
  assert.equal((await call(handle, { url: '/registry' })).status, 401);
  const wrong = await call(handle, {
    method: 'POST',
    url: '/session',
    body: { name: 'Dana', password: 'nope-nope-nope' },
  });
  assert.equal(wrong.status, 401);

  const cookie = await signIn(handle);
  const { json } = await call(handle, { url: '/registry', cookie });
  assert.equal(json.portId, HUENEME_REGISTRY.portId);
  const gate = { id: 'gate-test', class: 'gate', lanes: 2 };
  const missingHeader = await call(handle, {
    method: 'POST',
    url: '/assets',
    cookie,
    body: { asset: gate },
    headers: { 'x-portos-admin': '' },
  });
  assert.equal(missingHeader.status, 403);
  const created = await call(handle, {
    method: 'POST',
    url: '/assets',
    cookie,
    body: { asset: gate },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.asset.updatedBy, 'Dana');
  const history = await call(handle, {
    url: '/history?assetId=gate-test',
    cookie,
  });
  assert.equal(history.json.entries[0].action, 'create');

  const updated = await call(handle, {
    method: 'PUT',
    url: '/assets/gate-test',
    cookie,
    body: { asset: { ...gate, lanes: 3 }, rev: created.json.asset.rev },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.asset.lanes, 3);

  const removed = await call(handle, {
    method: 'DELETE',
    url: `/assets/gate-test?rev=${updated.json.asset.rev}`,
    cookie,
  });
  assert.equal(removed.status, 200);

  const out = await call(handle, { method: 'DELETE', url: '/session', cookie });
  assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await call(handle, { url: '/registry', cookie })).status, 401);
});

test('session cookie is HttpOnly, SameSite=Strict, and Secure behind https', async () => {
  const handle = handler();
  const r = await call(handle, {
    method: 'POST',
    url: '/session',
    body: { name: 'Dana', password: PASSWORD },
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Strict/);
  assert.match(r.setCookie, /Secure/);
});

test('repeated wrong passwords are throttled', async () => {
  const handle = handler();
  for (let i = 0; i < 10; i += 1)
    await call(handle, {
      method: 'POST',
      url: '/session',
      body: { name: 'X', password: 'wrong-wrong' },
    });
  const r = await call(handle, {
    method: 'POST',
    url: '/session',
    body: { name: 'Dana', password: PASSWORD },
  });
  assert.equal(r.status, 429);
});
