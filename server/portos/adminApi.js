/**
 * HTTP API for the port asset admin portal, mounted at /api/portos/admin.
 *
 * There are no passwords. Cloudflare Access guards /admin and this API and
 * signs staff in with a one-time code or magic link sent to their email; the
 * server checks the Access token on every request (see cfAccess.js) and
 * records the person's email in the change history. Without
 * CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD the portal stays locked: every
 * route but GET /session answers 503. On top of the Access policy, only
 * emails on PORTOS_ADMIN_EMAILS (emails or @domains; defaults to the staff
 * domains in DEFAULT_ALLOWED_EMAILS) may use the portal.
 *
 * Every write also needs the `X-Portos-Admin: 1` header, which a cross-site
 * form cannot send, so a signed-in browser cannot be made to write by
 * another site.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  migrateAsset,
  validateRegistry,
} from '../../src/portos/assetClasses.js';
import { HUENEME_REGISTRY } from '../../src/portos/hueneme.js';
import { AdminError, openAdminStore } from './adminStore.js';
import {
  DEFAULT_ALLOWED_EMAILS,
  createAccessVerifier,
  emailAllowed,
  isLocalDirect,
  parseAllowList,
} from './cfAccess.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ADMIN_BASE = '/api/portos/admin';
const MAX_BODY = 4 * 1024 * 1024;

/** Settings from the environment. */
export function adminSettings(env = process.env) {
  return {
    teamDomain: String(env.CF_ACCESS_TEAM_DOMAIN ?? '').trim(),
    aud: String(env.CF_ACCESS_AUD ?? '').trim(),
    allowed:
      env.PORTOS_ADMIN_EMAILS === undefined
        ? DEFAULT_ALLOWED_EMAILS
        : parseAllowList(env.PORTOS_ADMIN_EMAILS),
    // Local development only: who to treat as signed in for requests from
    // this machine that did not come through a proxy.
    devEmail: String(env.PORTOS_ADMIN_DEV_EMAIL ?? '').trim(),
    dataDir: env.PORTOS_DATA_DIR
      ? path.resolve(env.PORTOS_DATA_DIR)
      : path.join(ROOT, '.gev-data', 'portos'),
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) {
      reject(new AdminError(415, 'Send JSON'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new AdminError(413, 'Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new AdminError(400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build the request handler. Exposed for tests; the Vite plugin below mounts it.
 *
 * @param {{ settings?: object, access?: object, openStore?: () => object,
 *   now?: () => number }} [options]
 */
export function createAdminHandler({
  settings = adminSettings(),
  access = createAccessVerifier({
    teamDomain: settings.teamDomain,
    aud: settings.aud,
  }),
  openStore,
  now = Date.now,
} = {}) {
  let store = null;
  const getStore = () => {
    store ||= openStore
      ? openStore()
      : openAdminStore({
          dir: settings.dataDir,
          seed: HUENEME_REGISTRY,
          validate: validateRegistry,
          migrate: migrateAsset,
          now,
        });
    return store;
  };
  const configured = access.configured || Boolean(settings.devEmail);

  /** The signed-in person's email, or null. */
  async function who(req) {
    if (settings.devEmail && isLocalDirect(req)) return settings.devEmail;
    const identity = await access.fromRequest(req);
    if (!identity) return null;
    return emailAllowed(identity.email, settings.allowed)
      ? identity.email
      : null;
  }

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://local');
    // Mounted under ADMIN_BASE, so url.pathname is relative to it.
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    try {
      if (method !== 'GET' && req.headers['x-portos-admin'] !== '1')
        throw new AdminError(403, 'Missing X-Portos-Admin header');

      if (route === '/session') {
        if (method !== 'GET') throw new AdminError(405, 'Method not allowed');
        const email = configured ? await who(req) : null;
        return send(res, 200, {
          configured,
          signedIn: Boolean(email),
          name: email,
          logoutUrl: access.logoutUrl,
        });
      }

      if (!configured)
        throw new AdminError(503, 'The admin portal is not configured');
      const by = await who(req);
      if (!by) throw new AdminError(401, 'Sign in first');
      const db = getStore();

      if (route === '/registry' && method === 'GET') {
        return send(res, 200, {
          portId: db.portId,
          specs: db.registry().specs,
          assets: db.assets(),
        });
      }
      if (route === '/history' && method === 'GET') {
        return send(res, 200, {
          entries: db.history({
            assetId: url.searchParams.get('assetId') || undefined,
            limit: url.searchParams.get('limit') || undefined,
          }),
        });
      }
      if (route === '/assets' && method === 'POST') {
        const body = await readJson(req);
        return send(res, 201, {
          asset: db.saveAsset({ asset: body.asset, by }),
        });
      }
      const match = route.match(/^\/assets\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (method === 'PUT') {
          const body = await readJson(req);
          if (body.asset?.id !== id)
            throw new AdminError(
              400,
              'Asset id in the body must match the URL',
            );
          if (body.rev === undefined)
            throw new AdminError(400, 'Send the rev you are editing');
          return send(res, 200, {
            asset: db.saveAsset({ asset: body.asset, by, rev: body.rev }),
          });
        }
        if (method === 'DELETE') {
          const rev = url.searchParams.get('rev');
          return send(
            res,
            200,
            db.deleteAsset({ id, by, rev: rev === null ? undefined : rev }),
          );
        }
        throw new AdminError(405, 'Method not allowed');
      }
      if (route === '/import' && method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, db.importAssets({ rows: body.rows, by }));
      }
      throw new AdminError(404, 'Unknown admin route');
    } catch (error) {
      if (error instanceof AdminError)
        return send(res, error.status, {
          error: error.message,
          ...(error.details ? { problems: error.details } : {}),
        });
      console.error('[portos-admin]', error);
      return send(res, 500, { error: 'The admin server hit an error' });
    }
  };
}

/** Vite plugin: mount the admin API on the dev and preview servers. */
export function portosAdminPlugin(options) {
  const install = (server) => {
    const handle = createAdminHandler(options);
    server.middlewares.use(ADMIN_BASE, (req, res) => {
      handle(req, res);
    });
  };
  return {
    name: 'portos-admin',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export { emailAllowed };
