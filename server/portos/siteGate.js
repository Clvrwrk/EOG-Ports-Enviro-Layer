/**
 * Site-wide sign-in gate.
 *
 * Cloudflare Access sits in front of the whole site and lets in only people
 * who confirmed a one-time code or link sent to a staff email. This gate is
 * the app's own copy of that check: every request must carry a valid Access
 * token for an allowed email, so someone who reaches the server directly
 * (by its IP, skipping Cloudflare) still gets nothing, including the
 * private files under /private/.
 *
 * It turns on when CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set, and
 * SITE_ACCESS=off turns it off. Requests from this machine that did not come
 * through a proxy (container health checks, local development) pass.
 */
import {
  DEFAULT_ALLOWED_EMAILS,
  createAccessVerifier,
  emailAllowed,
  isLocalDirect,
  parseAllowList,
} from './cfAccess.js';

export function siteGateSettings(env = process.env) {
  return {
    teamDomain: String(env.CF_ACCESS_TEAM_DOMAIN ?? '').trim(),
    aud: String(env.CF_ACCESS_AUD ?? '').trim(),
    off:
      String(env.SITE_ACCESS ?? '')
        .trim()
        .toLowerCase() === 'off',
    allowed:
      env.SITE_ACCESS_EMAILS === undefined
        ? DEFAULT_ALLOWED_EMAILS
        : parseAllowList(env.SITE_ACCESS_EMAILS),
  };
}

const DENIED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in required</title><meta name="robots" content="noindex">
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0f1419;color:#e6e6e6}main{max-width:28rem;padding:24px}a{color:#7cc4ff}</style>
</head><body><main><h1>Sign in required</h1>
<p>This site is for invited staff. Open it at its normal address and sign in with the one-time code sent to your work email.</p>
<p><a href="/cdn-cgi/access/logout">Sign out</a></p></main></body></html>`;

/**
 * Build the gate middleware. Exposed for tests.
 *
 * @param {{ settings?: object, access?: object }} [options]
 */
export function createSiteGate({
  settings = siteGateSettings(),
  access = createAccessVerifier({
    teamDomain: settings.teamDomain,
    aud: settings.aud,
  }),
} = {}) {
  const enabled = access.configured && !settings.off;
  return {
    enabled,
    async middleware(req, res, next) {
      if (!enabled || isLocalDirect(req)) return next();
      const identity = await access.fromRequest(req);
      if (identity && emailAllowed(identity.email, settings.allowed))
        return next();
      const wantsHtml = String(req.headers?.accept || '').includes('text/html');
      res.statusCode = 403;
      res.setHeader('Cache-Control', 'no-store');
      if (wantsHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(DENIED_PAGE);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Sign in required' }));
      }
    },
  };
}

/** Vite plugin: run the gate before every other middleware. */
export function siteGatePlugin(options) {
  const install = (server) => {
    const gate = createSiteGate(options);
    if (!gate.enabled) return;
    server.middlewares.use((req, res, next) => {
      gate.middleware(req, res, next).catch(next);
    });
  };
  return {
    name: 'site-access-gate',
    enforce: 'pre',
    configureServer: install,
    configurePreviewServer: install,
  };
}
