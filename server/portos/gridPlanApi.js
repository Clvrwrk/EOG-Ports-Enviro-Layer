/**
 * HTTP API for the port's hand-drawn electrical plan, mounted at
 * /api/portos/grid-plan (see src/portos/meters/gridPlan.js for what a plan
 * holds).
 *
 * One JSON file per port in the data directory (PORTOS_DATA_DIR, a Coolify
 * volume in production), outside the repository, so conduit routes port
 * staff draw never reach the public repo.
 *
 * Reading follows the site: whoever may open the page may read the plan.
 * Saving needs a Cloudflare Access sign-in on the staff list, exactly as
 * the admin portal does (cfAccess.js), plus the `X-Portos-Admin: 1` header a
 * cross-site form cannot send. A save that names a stale `rev` is refused,
 * so two people drawing at once cannot silently overwrite each other.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeGridPlan } from '../../src/portos/meters/gridPlan.js';
import { adminSettings } from './adminApi.js';
import {
  createAccessVerifier,
  emailAllowed,
  isLocalDirect,
} from './cfAccess.js';

export const GRID_PLAN_BASE = '/api/portos/grid-plan';
const PORTS = new Set(['port-of-hueneme']);
const MAX_BODY = 1024 * 1024;

class PlanError extends Error {
  constructor(status, message, problems = undefined) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (
      !String(req.headers['content-type'] || '').startsWith('application/json')
    )
      return reject(new PlanError(415, 'Send JSON'));
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new PlanError(413, 'Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new PlanError(400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Plans kept as files in `dir`; `dir: null` keeps them in memory (tests). */
export function openGridPlanStore({ dir, now = Date.now }) {
  const memory = new Map();
  const file = (portId) => path.join(dir, `grid-plan-${portId}.json`);
  const blank = () => ({
    plan: normalizeGridPlan(null).plan,
    rev: 0,
    updatedAt: null,
    updatedBy: null,
  });
  function read(portId) {
    if (!dir) return memory.get(portId) ?? blank();
    try {
      const saved = JSON.parse(readFileSync(file(portId), 'utf8'));
      return {
        plan: normalizeGridPlan(saved.plan).plan,
        rev: Number(saved.rev) || 0,
        updatedAt: saved.updatedAt ?? null,
        updatedBy: saved.updatedBy ?? null,
      };
    } catch (error) {
      if (error.code !== 'ENOENT')
        console.warn('[portos-grid-plan] unreadable plan:', error.message);
      return blank();
    }
  }
  function write(portId, { plan, rev, by }) {
    const current = read(portId);
    if (Number(rev) !== current.rev)
      throw new PlanError(
        409,
        current.updatedBy
          ? `The routes were changed by ${current.updatedBy} since you opened them. Reload to see their change.`
          : 'The routes were changed since you opened them. Reload to see the change.',
      );
    const next = {
      plan,
      rev: current.rev + 1,
      updatedAt: now(),
      updatedBy: by,
    };
    if (!dir) memory.set(portId, next);
    else {
      mkdirSync(dir, { recursive: true });
      const target = file(portId);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(next));
      renameSync(temp, target);
    }
    return next;
  }
  return { read, write };
}

/**
 * Build the request handler. Exposed for tests; the Vite plugin mounts it.
 * @param {{ settings?: object, access?: object, store?: object }} [options]
 */
export function createGridPlanHandler({
  settings = adminSettings(),
  access = createAccessVerifier({
    teamDomain: settings.teamDomain,
    aud: settings.aud,
  }),
  store = openGridPlanStore({ dir: settings.dataDir }),
} = {}) {
  const configured = access.configured || Boolean(settings.devEmail);
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
    const portId = url.pathname.replace(/^\/+|\/+$/g, '');
    const method = req.method || 'GET';
    try {
      if (!PORTS.has(portId)) throw new PlanError(404, 'Unknown port');
      if (method === 'GET') {
        const email = configured ? await who(req) : null;
        return send(res, 200, {
          ...store.read(portId),
          canSave: Boolean(email),
        });
      }
      if (method !== 'PUT') throw new PlanError(405, 'Method not allowed');
      if (req.headers['x-portos-admin'] !== '1')
        throw new PlanError(403, 'Missing X-Portos-Admin header');
      if (!configured)
        throw new PlanError(503, 'Saving routes is not set up on this server');
      const by = await who(req);
      if (!by) throw new PlanError(401, 'Sign in first');
      const body = await readJson(req);
      const { plan, problems } = normalizeGridPlan(body.plan);
      if (problems.length)
        throw new PlanError(422, 'The routes were not saved', problems);
      return send(res, 200, {
        ...store.write(portId, { plan, rev: body.rev, by }),
        canSave: true,
      });
    } catch (error) {
      if (error instanceof PlanError)
        return send(res, error.status, {
          error: error.message,
          ...(error.problems ? { problems: error.problems } : {}),
        });
      console.error('[portos-grid-plan]', error);
      return send(res, 500, { error: 'The server hit an error' });
    }
  };
}

/** Vite plugin: mount the API on the dev and preview servers. */
export function portosGridPlanPlugin(options) {
  const install = (server) => {
    const handle = createGridPlanHandler(options);
    server.middlewares.use(GRID_PLAN_BASE, (req, res) => {
      handle(req, res);
    });
  };
  return {
    name: 'portos-grid-plan',
    configureServer: install,
    configurePreviewServer: install,
  };
}
