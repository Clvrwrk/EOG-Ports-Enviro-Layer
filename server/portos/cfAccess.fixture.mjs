/**
 * Test helper: a fake Cloudflare Access team with a real RSA key, so tests
 * can mint tokens the verifier accepts (and forged ones it must refuse).
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAccessVerifier } from './cfAccess.js';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function accessFixture({
  teamDomain = 'port-test.cloudflareaccess.com',
  aud = 'aud-port-admin-test',
  kid = 'key-1',
} = {}) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...pair.publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
  };
  const certs = { keys: [jwk] };
  let certFetches = 0;
  const fetchImpl = async (url) => {
    certFetches += 1;
    if (url !== `https://${teamDomain}/cdn-cgi/access/certs`)
      return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => certs };
  };

  function mint(privateKey, claims = {}) {
    const seconds = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'RS256', kid, typ: 'JWT' });
    const payload = b64({
      aud: [aud],
      iss: `https://${teamDomain}`,
      iat: seconds,
      exp: seconds + 3600,
      sub: 'user-1',
      ...claims,
    });
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      privateKey,
    ).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  return {
    teamDomain,
    aud,
    certs,
    fetchImpl,
    certFetches: () => certFetches,
    token: (claims) => mint(pair.privateKey, claims),
    /** Same header and claims, signed by a key the team never published. */
    forged: (claims) => mint(other.privateKey, claims),
    verifier: (settings) =>
      createAccessVerifier({
        teamDomain: settings.teamDomain,
        aud: settings.aud,
        fetchImpl,
      }),
  };
}
