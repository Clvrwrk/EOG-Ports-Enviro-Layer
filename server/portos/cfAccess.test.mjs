import assert from 'node:assert/strict';
import test from 'node:test';
import { accessFixture } from './cfAccess.fixture.mjs';
import { accessToken, createAccessVerifier, teamOrigin } from './cfAccess.js';

test('team domains normalise to an https origin', () => {
  assert.equal(
    teamOrigin('port.cloudflareaccess.com'),
    'https://port.cloudflareaccess.com',
  );
  assert.equal(
    teamOrigin('https://port.cloudflareaccess.com/'),
    'https://port.cloudflareaccess.com',
  );
  assert.equal(teamOrigin(''), null);
});

test('a valid token yields the email; keys are fetched once and cached', async () => {
  const f = accessFixture();
  const access = f.verifier({ teamDomain: f.teamDomain, aud: f.aud });
  assert.equal(access.configured, true);
  assert.deepEqual(
    await access.verify(f.token({ email: 'dana@port.example' })),
    {
      email: 'dana@port.example',
    },
  );
  await access.verify(f.token({ email: 'lee@port.example' }));
  assert.equal(f.certFetches(), 1);
});

test('without settings nothing verifies and no keys are fetched', async () => {
  const f = accessFixture();
  const access = createAccessVerifier({ fetchImpl: f.fetchImpl });
  assert.equal(access.configured, false);
  assert.equal(
    await access.verify(f.token({ email: 'dana@port.example' })),
    null,
  );
  assert.equal(f.certFetches(), 0);
});

test('a token signed by an unknown key is refused after one refresh', async () => {
  const f = accessFixture();
  const access = f.verifier({ teamDomain: f.teamDomain, aud: f.aud });
  assert.equal(
    await access.verify(f.token({ email: 'a@b.c', exp: undefined })),
    null,
  );
  const unknownKid = f
    .token({ email: 'a@b.c' })
    .replace(
      /^[^.]+/,
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'nope' })).toString(
        'base64url',
      ),
    );
  assert.equal(await access.verify(unknownKid), null);
  assert.equal(await access.verify(f.forged({ email: 'a@b.c' })), null);
});

test('the header wins over the cookie', () => {
  assert.equal(
    accessToken({
      headers: { 'cf-access-jwt-assertion': 'h', cookie: 'CF_Authorization=c' },
    }),
    'h',
  );
  assert.equal(
    accessToken({ headers: { cookie: 'a=1; CF_Authorization=c' } }),
    'c',
  );
  assert.equal(accessToken({ headers: {} }), null);
});
