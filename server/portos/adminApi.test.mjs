import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { validateRegistry } from '../../src/portos/assetClasses.js';
import { HUENEME_REGISTRY } from '../../src/portos/hueneme.js';
import { adminSettings, createAdminHandler, emailAllowed } from './adminApi.js';
import { openAdminStore } from './adminStore.js';
import { accessFixture } from './cfAccess.fixture.mjs';

const fixture = accessFixture();
const ENV = {
  CF_ACCESS_TEAM_DOMAIN: fixture.teamDomain,
  CF_ACCESS_AUD: fixture.aud,
};

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
  { method = 'GET', url, body, cookie, headers = {}, socket },
) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = socket || { remoteAddress: '10.0.0.1' };
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
  // After the handler's async sign-in check, as a real request body would.
  setImmediate(() => {
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

function handler(env = ENV) {
  const store = memoryStore();
  const settings = adminSettings(env);
  return createAdminHandler({
    settings,
    access: fixture.verifier(settings),
    openStore: () => store,
  });
}

/** Headers Cloudflare Access adds for a signed-in person. */
const as = (email, claims) => ({
  'cf-access-jwt-assertion': fixture.token({ email, ...claims }),
});

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

test('portal stays locked without Cloudflare Access settings', async () => {
  const handle = handler({});
  const session = await call(handle, { url: '/session' });
  assert.equal(session.status, 200);
  assert.equal(session.json.configured, false);
  const registry = await call(handle, {
    url: '/registry',
    headers: as('dana@portofh.org'),
  });
  assert.equal(registry.status, 503);
});

test('API needs an Access token, the write header, and records the email', async () => {
  const handle = handler();
  assert.equal((await call(handle, { url: '/registry' })).status, 401);
  const headers = as('dana@portofh.org');
  const session = await call(handle, { url: '/session', headers });
  assert.deepEqual(
    [session.json.configured, session.json.signedIn, session.json.name],
    [true, true, 'dana@portofh.org'],
  );
  assert.equal(session.json.logoutUrl, '/cdn-cgi/access/logout');

  const { json } = await call(handle, { url: '/registry', headers });
  assert.equal(json.portId, HUENEME_REGISTRY.portId);
  const gate = { id: 'gate-test', class: 'gate', lanes: 2 };
  const missingHeader = await call(handle, {
    method: 'POST',
    url: '/assets',
    body: { asset: gate },
    headers: { ...headers, 'x-portos-admin': '' },
  });
  assert.equal(missingHeader.status, 403);
  const created = await call(handle, {
    method: 'POST',
    url: '/assets',
    body: { asset: gate },
    headers,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.asset.updatedBy, 'dana@portofh.org');
  const history = await call(handle, {
    url: '/history?assetId=gate-test',
    headers,
  });
  assert.equal(history.json.entries[0].action, 'create');

  const updated = await call(handle, {
    method: 'PUT',
    url: '/assets/gate-test',
    body: { asset: { ...gate, lanes: 3 }, rev: created.json.asset.rev },
    headers,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.asset.lanes, 3);

  const removed = await call(handle, {
    method: 'DELETE',
    url: `/assets/gate-test?rev=${updated.json.asset.rev}`,
    headers,
  });
  assert.equal(removed.status, 200);
});

test('the Access cookie works too, and forged or stale tokens do not', async () => {
  const handle = handler();
  const cookie = `CF_Authorization=${fixture.token({ email: 'dana@portofh.org' })}`;
  assert.equal((await call(handle, { url: '/registry', cookie })).status, 200);
  const cases = {
    expired: as('dana@portofh.org', { exp: 1 }),
    otherAudience: as('dana@portofh.org', { aud: ['someone-else'] }),
    otherIssuer: as('dana@portofh.org', {
      iss: 'https://evil.cloudflareaccess.com',
    }),
    noEmail: as(''),
    forged: {
      'cf-access-jwt-assertion': fixture.forged({ email: 'dana@portofh.org' }),
    },
    garbage: { 'cf-access-jwt-assertion': 'not.a.jwt' },
  };
  for (const [name, headers] of Object.entries(cases))
    assert.equal(
      (await call(handle, { url: '/registry', headers })).status,
      401,
      name,
    );
});

test('PORTOS_ADMIN_EMAILS narrows who may edit', async () => {
  assert.ok(emailAllowed('a@portofh.org', []));
  assert.ok(emailAllowed('A@PortOfH.org', ['@portofh.org']));
  assert.ok(emailAllowed('b@x.com', ['b@x.com', '@portofh.org']));
  assert.ok(!emailAllowed('b@x.com', ['@portofh.org']));
  const handle = handler({ ...ENV, PORTOS_ADMIN_EMAILS: '@portofh.org' });
  assert.equal(
    (await call(handle, { url: '/registry', headers: as('dana@portofh.org') }))
      .status,
    200,
  );
  assert.equal(
    (await call(handle, { url: '/registry', headers: as('eve@elsewhere.com') }))
      .status,
    401,
  );
});

test('the local dev email only applies to direct requests from this machine', async () => {
  const handle = handler({ PORTOS_ADMIN_DEV_EMAIL: 'dev@localhost' });
  const remote = await call(handle, { url: '/session' });
  assert.equal(remote.json.signedIn, false);
  const local = await call(handle, {
    url: '/session',
    socket: { remoteAddress: '127.0.0.1' },
  });
  assert.equal(local.json.name, 'dev@localhost');
  const proxied = await call(handle, {
    url: '/session',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.9' },
  });
  assert.equal(proxied.json.signedIn, false);
});

test('without PORTOS_ADMIN_EMAILS only the staff domains get in', async () => {
  assert.deepEqual(adminSettings({}).allowed, [
    '@cleverwork.io',
    '@zeroemissionadvisors.com',
    '@portofh.org',
  ]);
  const handle = handler();
  for (const email of [
    'a@cleverwork.io',
    'b@zeroemissionadvisors.com',
    'c@portofh.org',
  ])
    assert.equal(
      (await call(handle, { url: '/registry', headers: as(email) })).status,
      200,
      email,
    );
  for (const email of ['eve@gmail.com', 'eve@cleverwork.io.evil.com'])
    assert.equal(
      (await call(handle, { url: '/registry', headers: as(email) })).status,
      401,
      email,
    );
});
