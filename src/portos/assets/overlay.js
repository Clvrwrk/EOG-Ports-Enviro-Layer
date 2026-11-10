/**
 * Merge a port's private asset overlay into its public seed registry.
 *
 * The public seed (e.g. hueneme.js) holds only what public sources say.
 * Port staff's real records (meter links, unit and serial numbers, surveyed
 * positions, truck counts) arrive as an overlay with the same shape:
 *
 *   { portId?, source?, assets: [ { id, ...fields } ], remove?: [ids] }
 *
 * An overlay asset whose id is already in the seed patches that asset
 * (its fields win; `null` clears a field). One with a new id is added and
 * must carry a `class`. Ids in `remove` are dropped.
 *
 * Pure: no DOM, no fetch.
 */
import { validateRegistry } from '../assetClasses.js';

/** The seed with the overlay applied. Throws on a malformed overlay. */
export function applyOverlay(seed, overlay) {
  if (!overlay) return seed;
  if (!Array.isArray(overlay.assets))
    throw new Error('Asset overlay needs an assets array');
  const removed = new Set(overlay.remove ?? []);
  const byId = new Map(
    seed.assets
      .filter((asset) => !removed.has(asset.id))
      .map((asset) => [asset.id, asset]),
  );
  for (const patch of overlay.assets) {
    if (!patch?.id) throw new Error('Asset overlay entry without an id');
    const base = byId.get(patch.id);
    if (!base && !patch.class)
      throw new Error(`Asset overlay: new asset ${patch.id} needs a class`);
    const merged = { ...base, ...patch };
    for (const [key, value] of Object.entries(patch))
      if (value === null) delete merged[key];
    byId.set(patch.id, merged);
  }
  return Object.freeze({
    ...seed,
    source: overlay.source
      ? `${seed.source}; overlay: ${overlay.source}`
      : seed.source,
    overlay: true,
    assets: Object.freeze([...byId.values()]),
  });
}

/**
 * Apply an overlay and validate the result. Returns { registry, errors };
 * on any error the seed is returned unchanged so the app keeps working.
 * `meterIds` are the ids of the run-time meter registry.
 */
export function mergeOverlay(seed, overlay, { meterIds = [] } = {}) {
  let registry;
  try {
    registry = applyOverlay(seed, overlay);
  } catch (error) {
    return { registry: seed, errors: [error.message] };
  }
  const errors = validateRegistry(registry, { meterIds });
  return errors.length ? { registry: seed, errors } : { registry, errors };
}
