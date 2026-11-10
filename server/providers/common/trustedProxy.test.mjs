import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardedClientAddress,
  forwardedProtocol,
  trustedProxyEnabled,
} from './trusted-proxy.js';
import { clientKey } from './rate-limit.js';
import { admitSameSite } from './same-site.js';
import { isGeminiRequestOriginAllowed } from '../gemini/request.js';

/** Run `fn` with GEV_TRUST_PROXY set to `value` (undefined unsets it). */
function withTrust(value, fn) {
  const saved = process.env.GEV_TRUST_PROXY;
  if (value === undefined) delete process.env.GEV_TRUST_PROXY;
  else process.env.GEV_TRUST_PROXY = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.GEV_TRUST_PROXY;
    else process.env.GEV_TRUST_PROXY = saved;
  }
}

/** A same-origin browser request as Coolify/Traefik delivers it. */
function proxiedRequest(extraHeaders = {}) {
  return {
    method: 'POST',
    socket: { remoteAddress: '10.0.1.5', encrypted: false },
    headers: {
      host: 'ports.example.org',
      origin: 'https://ports.example.org',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'ports.example.org',
      'x-real-ip': '203.0.113.9',
      ...extraHeaders,
    },
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('trustedProxyEnabled reads only explicit truthy values', () => {
  for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
    assert.equal(trustedProxyEnabled({ GEV_TRUST_PROXY: value }), true, value);
  }
  for (const value of [undefined, '', '0', 'false', 'no', 'maybe']) {
    assert.equal(trustedProxyEnabled({ GEV_TRUST_PROXY: value }), false, value);
  }
});

test('forwardedProtocol honours a single https token or a TLS socket', () => {
  assert.equal(forwardedProtocol(proxiedRequest()), 'https:');
  assert.equal(
    forwardedProtocol(proxiedRequest({ 'x-forwarded-proto': 'https,http' })),
    'http:',
  );
  assert.equal(
    forwardedProtocol({ socket: { encrypted: true }, headers: {} }),
    'https:',
  );
});

test('forwardedClientAddress takes the last X-Forwarded-For entry', () => {
  assert.equal(
    forwardedClientAddress(
      proxiedRequest({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }),
    ),
    '198.51.100.7',
  );
  assert.equal(
    forwardedClientAddress(
      proxiedRequest({ 'x-forwarded-for': '2001:db8::5' }),
    ),
    '2001:db8::5',
  );
  assert.equal(
    forwardedClientAddress(
      proxiedRequest({ 'x-forwarded-for': 'evil<script>' }),
    ),
    null,
  );
  assert.equal(forwardedClientAddress({ headers: {} }), null);
});

test('without GEV_TRUST_PROXY proxied requests stay refused (default unchanged)', () => {
  withTrust(undefined, () => {
    const res = fakeResponse();
    assert.equal(admitSameSite(proxiedRequest(), res), true);
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /Proxied requests are not accepted/);
    assert.equal(clientKey(proxiedRequest()), '10.0.1.5');
    assert.equal(
      isGeminiRequestOriginAllowed(proxiedRequest(), '0.0.0.0', [
        'ports.example.org',
      ]),
      false,
    );
  });
});

test('with GEV_TRUST_PROXY a same-origin request through the proxy is admitted', () => {
  withTrust('1', () => {
    const res = fakeResponse();
    assert.equal(admitSameSite(proxiedRequest(), res), false);
    assert.equal(clientKey(proxiedRequest()), '203.0.113.9');
    assert.equal(
      isGeminiRequestOriginAllowed(proxiedRequest(), '0.0.0.0', [
        'ports.example.org',
      ]),
      true,
    );
  });
});

test('with GEV_TRUST_PROXY cross-site and foreign-origin requests are still refused', () => {
  withTrust('1', () => {
    const crossSite = fakeResponse();
    assert.equal(
      admitSameSite(
        proxiedRequest({ 'sec-fetch-site': 'cross-site' }),
        crossSite,
      ),
      true,
    );
    assert.equal(crossSite.statusCode, 403);

    const foreign = fakeResponse();
    assert.equal(
      admitSameSite(
        proxiedRequest({ origin: 'https://evil.example' }),
        foreign,
      ),
      true,
    );
    assert.equal(foreign.statusCode, 403);

    // An http Origin does not match the https scheme the proxy reports.
    const downgraded = fakeResponse();
    assert.equal(
      admitSameSite(
        proxiedRequest({ origin: 'http://ports.example.org' }),
        downgraded,
      ),
      true,
    );
    assert.equal(
      isGeminiRequestOriginAllowed(
        proxiedRequest({ host: 'other.example.org' }),
        '0.0.0.0',
        ['ports.example.org'],
      ),
      false,
    );
  });
});
