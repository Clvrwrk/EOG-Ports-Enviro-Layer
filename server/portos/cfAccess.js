/**
 * Cloudflare Access sign-in for staff routes.
 *
 * Staff never type a password into this app. Cloudflare Access sits in front
 * of the staff paths (/admin and /api/portos/admin) and signs people in with
 * a one-time code or magic link sent to their work email. Every request it
 * lets through carries a signed JWT in the `Cf-Access-Jwt-Assertion` header
 * (and the `CF_Authorization` cookie). This module checks that token against
 * the team's public keys and the Access application's audience tag, and
 * returns the person's email, which the change history records.
 *
 * Settings: CF_ACCESS_TEAM_DOMAIN (e.g. `cleverwork.cloudflareaccess.com`)
 * and CF_ACCESS_AUD (the Access application's audience tag). Without both,
 * nobody is signed in.
 */
import { createPublicKey, verify as verifySignature } from 'node:crypto';

/** Staff email domains Chris verified (2026-11-10). */
export const DEFAULT_ALLOWED_EMAILS = [
  '@cleverwork.io',
  '@zeroemissionadvisors.com',
  '@portofh.org',
];

/** Parse a comma or space separated list of emails and @domains. */
export const parseAllowList = (text) =>
  String(text ?? '')
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

/** Whether an email passes the allow list (an empty list allows anyone). */
export function emailAllowed(email, allowed) {
  if (!allowed?.length) return true;
  const value = String(email || '').toLowerCase();
  const domain = value.slice(value.lastIndexOf('@'));
  return allowed.some((entry) =>
    entry.startsWith('@') ? domain === entry : value === entry,
  );
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** A request from this machine that did not come through any proxy. */
export const isLocalDirect = (req) =>
  LOOPBACK.has(req.socket?.remoteAddress) &&
  !req.headers?.['x-forwarded-for'] &&
  !req.headers?.['x-real-ip'] &&
  !req.headers?.['cf-connecting-ip'];

const CERTS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;

/** Normalise a team domain to `https://<host>` (no trailing slash). */
export function teamOrigin(teamDomain) {
  const host = String(teamDomain || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return host ? `https://${host}` : null;
}

const b64url = (text) => Buffer.from(String(text), 'base64url');

function decode(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64url(parts[0]).toString('utf8')),
      payload: JSON.parse(b64url(parts[1]).toString('utf8')),
      signed: Buffer.from(`${parts[0]}.${parts[1]}`),
      signature: b64url(parts[2]),
    };
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The Access token a request carries, header first. */
export function accessToken(req) {
  return (
    req.headers?.['cf-access-jwt-assertion'] ||
    readCookie(req, 'CF_Authorization') ||
    null
  );
}

/**
 * Build a verifier. `verify(token)` resolves to `{ email }` for a valid
 * token and `null` otherwise; it never throws.
 *
 * @param {{ teamDomain?: string, aud?: string, fetchImpl?: Function,
 *   now?: () => number }} options
 */
export function createAccessVerifier({
  teamDomain,
  aud,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const origin = teamOrigin(teamDomain);
  const audience = String(aud || '').trim();
  const configured = Boolean(origin && audience);
  let keys = null; // Map kid -> KeyObject
  let fetchedAt = 0;
  let pending = null;

  async function loadKeys(force = false) {
    if (!force && keys && now() - fetchedAt < CERTS_TTL_MS) return keys;
    pending ||= (async () => {
      try {
        const response = await fetchImpl(`${origin}/cdn-cgi/access/certs`);
        if (!response.ok) throw new Error(`certs HTTP ${response.status}`);
        const body = await response.json();
        const next = new Map();
        for (const jwk of body.keys || []) {
          if (jwk.kty !== 'RSA' || !jwk.kid) continue;
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        }
        keys = next;
        fetchedAt = now();
      } catch (error) {
        console.warn('[cf-access] could not load signing keys:', error.message);
      } finally {
        pending = null;
      }
      return keys;
    })();
    return pending;
  }

  async function verify(token) {
    if (!configured) return null;
    const jwt = decode(token);
    if (!jwt || jwt.header.alg !== 'RS256' || !jwt.header.kid) return null;
    let key = (await loadKeys())?.get(jwt.header.kid);
    // Keys rotate: one forced refresh for an unknown key id.
    if (!key) key = (await loadKeys(true))?.get(jwt.header.kid);
    if (!key) return null;
    let ok = false;
    try {
      ok = verifySignature('RSA-SHA256', jwt.signed, key, jwt.signature);
    } catch {
      ok = false;
    }
    if (!ok) return null;
    const claims = jwt.payload;
    const seconds = now() / 1000;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(audience)) return null;
    if (claims.iss !== origin) return null;
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < seconds)
      return null;
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > seconds)
      return null;
    const email = String(claims.email || '').trim();
    if (!email) return null; // service tokens carry no person
    return { email };
  }

  return {
    configured,
    logoutUrl: '/cdn-cgi/access/logout',
    verify,
    /** Verify the token a request carries. */
    fromRequest: (req) => verify(accessToken(req)),
  };
}
