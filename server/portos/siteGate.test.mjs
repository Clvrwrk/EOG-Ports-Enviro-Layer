import assert from 'node:assert/strict';
import test from 'node:test';
import { accessFixture } from './cfAccess.fixture.mjs';
import {
  createSiteGate,
  siteGatePlugin,
  siteGateSettings,
} from './siteGate.js';

const fixture = accessFixture();
const ENV = {
  CF_ACCESS_TEAM_DOMAIN: fixture.teamDomain,
  CF_ACCESS_AUD: fixture.aud,
};

function gate(env = ENV) {
  const settings = siteGateSettings(env);
  return createSiteGate({ settings, access: fixture.verifier(settings) });
}

/** Run a request through the gate; resolve to 'next' or the response. */
async function hit(g, { headers = {}, remoteAddress = '203.0.113.5' } = {}) {
  const req = {
    url: '/private/vessels/x.json',
    headers,
    socket: { remoteAddress },
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(text) {
      this.body = text;
    },
  };
  let passed = false;
  await g.middleware(req, res, () => {
    passed = true;
  });
  return passed ? 'next' : res;
}

const signedIn = (email) => ({
  'cf-access-jwt-assertion': fixture.token({ email }),
});

test('without Cloudflare settings, or with SITE_ACCESS=off, the site stays open', async () => {
  assert.equal(gate({}).enabled, false);
  assert.equal(await hit(gate({})), 'next');
  const off = gate({ ...ENV, SITE_ACCESS: 'off' });
  assert.equal(off.enabled, false);
  assert.equal(await hit(off), 'next');
});

test('staff emails pass; everyone else gets 403, including private files', async () => {
  const g = gate();
  assert.equal(g.enabled, true);
  for (const email of [
    'a@cleverwork.io',
    'b@zeroemissionadvisors.com',
    'c@portofh.org',
  ])
    assert.equal(await hit(g, { headers: signedIn(email) }), 'next', email);
  const anon = await hit(g);
  assert.equal(anon.statusCode, 403);
  assert.match(anon.headers['content-type'], /json/);
  const outsider = await hit(g, {
    headers: { ...signedIn('eve@gmail.com'), accept: 'text/html' },
  });
  assert.equal(outsider.statusCode, 403);
  assert.match(outsider.body, /Sign in required/);
  const forged = await hit(g, {
    headers: {
      'cf-access-jwt-assertion': fixture.forged({ email: 'a@cleverwork.io' }),
    },
  });
  assert.equal(forged.statusCode, 403);
});

test('direct requests from inside the container pass (health checks)', async () => {
  const g = gate();
  assert.equal(await hit(g, { remoteAddress: '127.0.0.1' }), 'next');
  const proxied = await hit(g, {
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': '203.0.113.9' },
  });
  assert.equal(proxied.statusCode, 403);
});

test('SITE_ACCESS_EMAILS replaces the default staff domains', async () => {
  const g = gate({ ...ENV, SITE_ACCESS_EMAILS: 'only@cleverwork.io' });
  assert.equal(
    await hit(g, { headers: signedIn('only@cleverwork.io') }),
    'next',
  );
  assert.equal(
    (await hit(g, { headers: signedIn('other@cleverwork.io') })).statusCode,
    403,
  );
});

test('the plugin runs before other plugins', () => {
  const plugin = siteGatePlugin();
  assert.equal(plugin.name, 'site-access-gate');
  assert.equal(plugin.enforce, 'pre');
});
