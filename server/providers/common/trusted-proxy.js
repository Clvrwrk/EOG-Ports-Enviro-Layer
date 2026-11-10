/**
 * Opt-in trust for ONE reverse proxy in front of the app (GEV_TRUST_PROXY).
 *
 * By default the cost-bearing routes refuse any request that carries
 * forwarding headers, because the app is built to run on the owner's own
 * machine. A public deployment behind a platform proxy (Coolify/Traefik,
 * Caddy, nginx) sends every request with those headers, so without this
 * switch AI chat, voice, the HUD summary, Google places and TomTom all answer
 * 403 there. Setting GEV_TRUST_PROXY=1 says "exactly one proxy I run sits in
 * front of this server and overwrites the forwarding headers":
 *
 *  - the same-site gate stops refusing forwarding headers and compares the
 *    browser's Origin against the scheme the proxy reports
 *    (X-Forwarded-Proto), so the Origin and Sec-Fetch-Site checks still apply;
 *  - per-IP rate limits key on the address the proxy appended (the LAST
 *    X-Forwarded-For entry) instead of the proxy's own socket address, which
 *    would otherwise put every visitor in one bucket.
 *
 * It never relaxes the credential panel (Provider Settings) or the MCP
 * sharing gate: those stay loopback-only whatever this says.
 *
 * Only set it when the app is reachable SOLELY through that proxy (for example
 * the container port is not published to the internet). Otherwise a direct
 * caller could supply its own forwarding headers.
 */

/**
 * Whether GEV_TRUST_PROXY is switched on. Accepts 1, true, yes, on.
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function trustedProxyEnabled(env = process.env) {
  const raw = String(env?.GEV_TRUST_PROXY ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Scheme the browser used, for comparing against its Origin. A TLS socket is
 * https; otherwise a single-token X-Forwarded-Proto of "https" is honoured,
 * never a comma-separated chain.
 * @param {import('node:http').IncomingMessage} req
 * @returns {'http:'|'https:'}
 */
export function forwardedProtocol(req) {
  if (req?.socket?.encrypted) return 'https:';
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
    .trim()
    .toLowerCase();
  return proto === 'https' ? 'https:' : 'http:';
}

const ADDRESS_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The client address the trusted proxy appended: the LAST X-Forwarded-For
 * entry. Earlier entries are client-supplied and ignored. Returns null when the
 * header is absent or the entry is not a plain IPv4/IPv6 address.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string|null}
 */
export function forwardedClientAddress(req) {
  const header = req?.headers?.['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : String(header || '');
  const last = raw.split(',').pop()?.trim() || '';
  return ADDRESS_RE.test(last) ? last : null;
}
