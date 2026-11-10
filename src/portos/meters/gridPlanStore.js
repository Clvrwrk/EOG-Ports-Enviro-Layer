/**
 * Load and save the port's hand-drawn electrical plan (gridPlan.js).
 *
 * The plan lives on the server (/api/portos/grid-plan), so every signed-in
 * person sees the same routes. Where the server cannot save (local
 * development with no sign-in set up), the plan is kept in this browser
 * instead and the caller is told so.
 */
import { emptyGridPlan, normalizeGridPlan } from './gridPlan.js';

const API = '/api/portos/grid-plan';
const KEY = (portId) => `portos.gridPlan.${portId}`;

const storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function readLocal(portId) {
  try {
    const saved = JSON.parse(storage()?.getItem(KEY(portId)) ?? 'null');
    return saved ? normalizeGridPlan(saved).plan : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ plan: object, rev: number, where: 'server'|'browser',
 *   updatedBy: string|null }>} never throws
 */
export async function loadGridPlan(
  portId = 'port-of-hueneme',
  fetchImpl = globalThis.fetch,
) {
  try {
    const response = await fetchImpl(`${API}/${portId}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const type = response.headers?.get?.('content-type') ?? '';
    if (response.ok && type.includes('json')) {
      const data = await response.json();
      if (data.canSave)
        return {
          plan: normalizeGridPlan(data.plan).plan,
          rev: Number(data.rev) || 0,
          where: 'server',
          updatedBy: data.updatedBy ?? null,
        };
      // The server holds a plan but cannot take ours: show its routes
      // unless this browser has its own drawing in progress.
      const local = readLocal(portId);
      return {
        plan: local ?? normalizeGridPlan(data.plan).plan,
        rev: Number(data.rev) || 0,
        where: 'browser',
        updatedBy: data.updatedBy ?? null,
      };
    }
  } catch {
    // Fall through to the browser copy.
  }
  return {
    plan: readLocal(portId) ?? emptyGridPlan(),
    rev: 0,
    where: 'browser',
    updatedBy: null,
  };
}

/**
 * @returns {Promise<{ ok: true, rev: number, where: string } |
 *   { ok: false, error: string, problems?: string[] }>}
 */
export async function saveGridPlan(
  { plan, rev, where },
  portId = 'port-of-hueneme',
  fetchImpl = globalThis.fetch,
) {
  if (where !== 'server') {
    try {
      storage()?.setItem(KEY(portId), JSON.stringify(plan));
      return { ok: true, rev, where: 'browser' };
    } catch {
      return { ok: false, error: 'This browser could not store the routes' };
    }
  }
  try {
    const response = await fetchImpl(`${API}/${portId}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Portos-Admin': '1' },
      body: JSON.stringify({ plan, rev }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error: data.error ?? `The server answered ${response.status}`,
        problems: data.problems,
      };
    return { ok: true, rev: data.rev, where: 'server' };
  } catch {
    return { ok: false, error: 'The server could not be reached' };
  }
}
