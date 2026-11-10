import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adminSettings } from './adminApi.js';
import { accessFixture } from './cfAccess.fixture.mjs';
import { createGridPlanHandler, openGridPlanStore } from './gridPlanApi.js';

const fixture = accessFixture();
const ENV = {
  CF_ACCESS_TEAM_DOMAIN: fixture.teamDomain,
  CF_ACCESS_AUD: fixture.aud,
  PORTOS_ADMIN_EMAILS: 'staff@portofh.org',
};
const PORT = '/port-of-hueneme';
const plan = {
  feedAt: null,
  sources: [{ id: 'T1', at: [34.1485, -119.2085], kva: 1500 }],
  fedFrom: { 'meter-1': 'T1' },
  routes: { 'service:meter-1': [[34.149, -119.209]] },
};

async function call(
  handle,
  { method = 'GET', url = PORT, body, headers = {} },
) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress: '10.0.0.1' };
  req.headers = {
    ...(method !== 'GET' ? { 'x-portos-admin': '1' } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...headers,
  };
  req.destroy = () => {};
  const res = {
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text;
      this.done();
    },
  };
  const finished = new Promise((resolve) => (res.done = resolve));
  handle(req, res);
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await finished;
  return { status: res.status, json: JSON.parse(res.body) };
}

function handler(env = ENV, store = openGridPlanStore({ dir: null })) {
  const settings = adminSettings(env);
  return createGridPlanHandler({
    settings,
    access: fixture.verifier(settings),
    store,
  });
}
const as = (email) => ({
  'cf-access-jwt-assertion': fixture.token({ email }),
});

test('anyone on the site reads the plan; only staff may save', async () => {
  const handle = handler();
  const empty = await call(handle, {});
  assert.equal(empty.status, 200);
  assert.equal(empty.json.rev, 0);
  assert.equal(empty.json.canSave, false);
  assert.deepEqual(empty.json.plan.sources, []);
  const staff = await call(handle, { headers: as('staff@portofh.org') });
  assert.equal(staff.json.canSave, true);
  const put = (headers, body = { plan, rev: 0 }) =>
    call(handle, { method: 'PUT', body, headers });
  assert.equal((await put({})).status, 401);
  assert.equal((await put(as('visitor@portofh.org'))).status, 401);
  assert.equal(
    (await put({ ...as('staff@portofh.org'), 'x-portos-admin': '' })).status,
    403,
  );
  const saved = await put(as('staff@portofh.org'));
  assert.equal(saved.status, 200);
  assert.equal(saved.json.rev, 1);
  assert.equal(saved.json.updatedBy, 'staff@portofh.org');
  const read = await call(handle, {});
  assert.deepEqual(read.json.plan, plan);
});

test('a stale or malformed save is refused', async () => {
  const handle = handler();
  const headers = as('staff@portofh.org');
  const put = (body) => call(handle, { method: 'PUT', body, headers });
  assert.equal((await put({ plan, rev: 0 })).status, 200);
  const stale = await put({ plan, rev: 0 });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /staff@portofh\.org/);
  const bad = await put({
    plan: { ...plan, sources: [{ id: 'T1', at: 'by the gate', kva: 'big' }] },
    rev: 1,
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.json.problems.length >= 1);
  assert.equal((await call(handle, {})).json.rev, 1);
  assert.equal((await call(handle, { url: '/somewhere-else' })).status, 404);
  assert.equal((await call(handle, { method: 'DELETE', headers })).status, 405);
});

test('saving is off where sign-in is not set up', async () => {
  const handle = handler({});
  assert.equal((await call(handle, {})).json.canSave, false);
  const put = await call(handle, { method: 'PUT', body: { plan, rev: 0 } });
  assert.equal(put.status, 503);
});

test('plans are kept as one file per port', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'grid-plan-'));
  try {
    const store = openGridPlanStore({ dir, now: () => 5 });
    assert.equal(store.read('port-of-hueneme').rev, 0);
    store.write('port-of-hueneme', { plan, rev: 0, by: 'a@b.c' });
    assert.deepEqual(readdirSync(dir), ['grid-plan-port-of-hueneme.json']);
    const again = openGridPlanStore({ dir }).read('port-of-hueneme');
    assert.deepEqual(again, { plan, rev: 1, updatedAt: 5, updatedBy: 'a@b.c' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
