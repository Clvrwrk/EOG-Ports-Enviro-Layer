/**
 * Where the scenario builder and twin get the asset registry from.
 *
 * The public pages run on the built-in seed registry. When port staff are
 * signed in to /admin in the same browser, the pages can run on the registry
 * they edited instead. Staff records never leave the server for anyone who
 * is not signed in.
 */
const API = '/api/portos/admin';

/** Powertrains that draw from the meter in the simulator. */
const ELECTRIC = new Set(['electric', 'hybrid', 'grid']);

/**
 * The edited registry, or null when nobody is signed in (or the portal is
 * not set up on this server). Never throws.
 */
export async function fetchAdminRegistry(fetchImpl = globalThis.fetch) {
  try {
    const session = await fetchImpl(`${API}/session`, {
      credentials: 'same-origin',
    });
    if (!session.ok) return null;
    const state = await session.json();
    if (!state.signedIn) return null;
    const response = await fetchImpl(`${API}/registry`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const data = await response.json();
    const assets = data.assets.map(
      ({ rev: _r, updatedAt: _a, updatedBy: _b, ...rest }) => rest,
    );
    return {
      portId: data.portId,
      source: 'admin portal',
      specs: data.specs,
      assets,
      signedInAs: state.name,
    };
  } catch {
    return null;
  }
}

/**
 * Electric and diesel unit counts per energy spec from the registry's
 * active equipment, in the scenario's fleet shape. Planned and retired
 * units are left out; plug-in hybrids count as electric because they draw
 * from the meter while working. Powertrains the simulator does not model
 * (hydrogen) are skipped.
 */
export function fleetFromRegistry(registry) {
  const fleet = {};
  for (const asset of registry?.assets || []) {
    if (!asset.specId || !registry.specs?.[asset.specId]) continue;
    if (asset.status && asset.status !== 'active') continue;
    const kind = ELECTRIC.has(asset.powertrain)
      ? 'electric'
      : asset.powertrain === 'diesel'
        ? 'diesel'
        : null;
    if (!kind) continue;
    const row = (fleet[asset.specId] ||= { electric: 0, diesel: 0 });
    row[kind] += 1;
  }
  for (const row of Object.values(fleet)) row.chargers = row.electric;
  return fleet;
}
