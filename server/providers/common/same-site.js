import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';
import { forwardedProtocol, trustedProxyEnabled } from './trusted-proxy.js';

/**
 * Cross-site request gate for cost-bearing and log endpoints. Feeds the
 * request to the pure, unit-tested `admitSameSiteRequest` and answers 403
 * itself when the request is refused. Returns true when it has already
 * responded (the caller returns); false when the handler should continue.
 * Refuses cross-site browser requests (foreign or opaque Origin, a
 * Sec-Fetch-Site other than same-origin/none, or reverse-proxy headers) while
 * keeping loopback non-browser tools and the HOST=0.0.0.0 LAN opt-in working.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} True when a 403 was sent.
 */
export function admitSameSite(req, res) {
  // GEV_TRUST_PROXY: one proxy the owner runs fronts the app, so its
  // forwarding headers are expected and its X-Forwarded-Proto is the scheme
  // the browser's Origin carries. Origin and Sec-Fetch-Site still apply.
  const trusted = trustedProxyEnabled();
  const verdict = admitSameSiteRequest({
    hostHeader: req.headers?.host,
    protocol: trusted
      ? forwardedProtocol(req)
      : req.socket?.encrypted
        ? 'https:'
        : 'http:',
    origin: req.headers?.origin,
    secFetchSite: req.headers?.['sec-fetch-site'],
    proxyHeaders: trusted ? {} : req.headers || {},
  });
  if (verdict.ok) return false;
  res.statusCode = verdict.status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: verdict.error }));
  return true;
}

/**
 * Wrap a middleware handler so cross-site requests are refused with 403
 * before the handler runs. Loopback tools and same-origin browser requests
 * pass straight through.
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: Function) => unknown} handler
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: Function) => unknown}
 */
export function sameSiteGated(handler) {
  return (req, res, next) => {
    if (admitSameSite(req, res)) return undefined;
    return handler(req, res, next);
  };
}

/**
 * Cross-site gate for keyless routes the map needs in order to render
 * (`/api/terrain/heights`, `/api/overpass`). It refuses the same cross-site browser shapes as
 * `admitSameSite` (a `Sec-Fetch-Site` other than same-origin/none, a foreign
 * or opaque `Origin`) but does not refuse reverse-proxy forwarding headers:
 * those protect credentials and spend, which a keyless route has neither of,
 * and refusing them would break rendering for an instance served behind the
 * reverse proxy the README documents. A single `X-Forwarded-Proto` supplies
 * the scheme an `Origin` is compared against. That header cannot be attached
 * to a cross-site browser request without a CORS preflight this server never
 * answers, and `Sec-Fetch-Site` is still enforced regardless.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} True when a 403 was sent.
 */
export function admitSameSiteKeyless(req, res) {
  const verdict = admitSameSiteRequest({
    hostHeader: req.headers?.host,
    protocol: forwardedProtocol(req),
    origin: req.headers?.origin,
    secFetchSite: req.headers?.['sec-fetch-site'],
    proxyHeaders: {},
  });
  if (verdict.ok) return false;
  res.statusCode = verdict.status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: verdict.error }));
  return true;
}
