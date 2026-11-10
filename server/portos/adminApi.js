/**
 * HTTP API for the port asset admin portal, mounted at /api/portos/admin.
 *
 * Sign-in is one staff password from PORTOS_ADMIN_PASSWORD plus the name the
 * person types, which is what the change history records. Without that
 * variable the portal stays locked: every route but GET /session answers 503.
 * Sessions are random tokens in an HttpOnly, SameSite=Strict cookie, and
 * every write also needs the `X-Portos-Admin: 1` header, which a cross-site
 * form cannot send, so a signed-in browser cannot be made to write by another
 * site.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from '../../src/portos/assetClasses.js';
import { HUENEME_REGISTRY } from '../../src/portos/hueneme.js';
import { AdminError, openAdminStore } from './adminStore.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ADMIN_BASE = '/api/portos/admin';
const COOKIE = 'portos_admin';
const MAX_BODY = 4 * 1024 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

/** Settings from the environment; `password` null means the portal is locked. */
export function adminSettings(env = process.env) {
  const password = String(env.PORTOS_ADMIN_PASSWORD ?? '');
  return {
    password: password.length >= 8 ? password : null,
    tooShort: password.length > 0 && password.length < 8,
    dataDir: env.PORTOS_DATA_DIR
      ? path.resolve(env.PORTOS_DATA_DIR)
      : path.join(ROOT, '.gev-data', 'portos'),
  };
}

const digest = (text) => createHash('sha256').update(String(text)).digest();
/** Constant-time password comparison. */
export function passwordMatches(given, expected) {
  if (!expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const isHttps = (req) =>
  Boolean(req.socket?.encrypted) ||
  String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim() === 'https';

function sessionCookie(req, value, maxAgeSeconds) {
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/api/portos/admin',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
    ...(isHttps(req) ? ['Secure'] : []),
  ].join('; ');
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

const cleanName = (name) =>
  String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 60);

/**
 * Build the request handler. Exposed for tests; the Vite plugin below mounts it.
 *
 * @param {{ settings?: object, openStore?: () => object, now?: () => number }} [options]
 */
export function createAdminHandler({
  settings = adminSettings(),
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
          now,
        });
    return store;
  };
  const failures = new Map();

  const throttled = (ip) => {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (now() - entry.first > LOGIN_WINDOW_MS) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= LOGIN_MAX_FAILURES;
  };
  const fail = (ip) => {
    const entry = failures.get(ip);
    if (!entry || now() - entry.first > LOGIN_WINDOW_MS)
      failures.set(ip, { first: now(), count: 1 });
    else entry.count += 1;
  };

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://local');
    // Mounted under ADMIN_BASE, so url.pathname is relative to it.
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    try {
      if (method !== 'GET' && req.headers['x-portos-admin'] !== '1')
        throw new AdminError(403, 'Missing X-Portos-Admin header');

      if (route === '/session') {
        if (method === 'GET') {
          const session = settings.password
            ? getStore().checkSession(readCookie(req, COOKIE))
            : null;
          return send(res, 200, {
            configured: Boolean(settings.password),
            tooShort: settings.tooShort,
            signedIn: Boolean(session),
            name: session?.name ?? null,
          });
        }
        if (!settings.password)
          throw new AdminError(503, 'The admin portal is not configured');
        if (method === 'POST') {
          const ip = req.socket?.remoteAddress || 'unknown';
          if (throttled(ip))
            throw new AdminError(
              429,
              'Too many failed sign-ins. Try again in 15 minutes.',
            );
          const body = await readJson(req);
          const name = cleanName(body.name);
          if (!name) throw new AdminError(400, 'Enter your name');
          if (!passwordMatches(body.password ?? '', settings.password)) {
            fail(ip);
            throw new AdminError(401, 'Wrong password');
          }
          failures.delete(ip);
          const { token, maxAgeSeconds } = getStore().createSession(name);
          return send(
            res,
            200,
            { signedIn: true, name },
            { 'Set-Cookie': sessionCookie(req, token, maxAgeSeconds) },
          );
        }
        if (method === 'DELETE') {
          getStore().endSession(readCookie(req, COOKIE));
          return send(
            res,
            200,
            { signedIn: false },
            { 'Set-Cookie': sessionCookie(req, '', 0) },
          );
        }
        throw new AdminError(405, 'Method not allowed');
      }

      if (!settings.password)
        throw new AdminError(503, 'The admin portal is not configured');
      const session = getStore().checkSession(readCookie(req, COOKIE));
      if (!session) throw new AdminError(401, 'Sign in first');
      const by = session.name;
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
