/**
 * Port asset registry schema.
 *
 * Every asset a port operates belongs to one class below. A class names the
 * fields an asset of that class must carry, so the admin portal, the
 * simulator and the report generator all read the same shape. The registry
 * itself is plain data (see hueneme.js) and is checked with validateRegistry.
 */

/** Energy source an asset runs on. */
export const POWERTRAINS = Object.freeze([
  'diesel',
  'electric',
  'hybrid',
  'hydrogen',
  'grid',
  'none',
]);

const equipment = Object.freeze(['id', 'class', 'powertrain', 'specId']);

/**
 * Asset classes and their required fields. `group` is the inventory section
 * a staff user sees in the admin portal.
 */
export const ASSET_CLASSES = Object.freeze({
  // Cargo-handling equipment (CHE)
  utr: {
    group: 'che',
    label: 'Utility tractor rig (yard tractor)',
    required: equipment,
  },
  sts_crane: {
    group: 'che',
    label: 'Ship-to-shore crane',
    required: equipment,
  },
  mobile_harbor_crane: {
    group: 'che',
    label: 'Mobile harbor crane',
    required: equipment,
  },
  reach_stacker: { group: 'che', label: 'Reach stacker', required: equipment },
  top_handler: { group: 'che', label: 'Top handler', required: equipment },
  forklift: { group: 'che', label: 'Forklift', required: equipment },
  light_duty: {
    group: 'che',
    label: 'Light-duty pickup, van or runner',
    required: equipment,
  },
  // Harbor craft and rail
  tug: { group: 'harbor_craft', label: 'Tug', required: equipment },
  harbor_craft: {
    group: 'harbor_craft',
    label: 'Other harbor craft',
    required: equipment,
  },
  locomotive: { group: 'rail', label: 'Locomotive', required: equipment },
  // Fixed assets
  berth: {
    group: 'fixed',
    label: 'Berth',
    required: ['id', 'class', 'zone', 'shorePower'],
  },
  building: {
    group: 'fixed',
    label: 'Building',
    required: ['id', 'class', 'meterId'],
  },
  gate: {
    group: 'fixed',
    label: 'Truck gate',
    required: ['id', 'class', 'lanes'],
  },
  rail_spur: { group: 'fixed', label: 'Rail spur', required: ['id', 'class'] },
  // Electrical
  meter: {
    group: 'electrical',
    label: 'Utility meter',
    required: ['id', 'class', 'utility', 'tariffId'],
  },
  charger: {
    group: 'electrical',
    label: 'EV charger',
    required: ['id', 'class', 'meterId', 'kw'],
  },
  shore_power: {
    group: 'electrical',
    label: 'Shore power vault',
    required: ['id', 'class', 'meterId', 'berthId', 'kw'],
  },
  reefer_rack: {
    group: 'electrical',
    label: 'Reefer plug rack',
    required: ['id', 'class', 'meterId', 'plugs'],
  },
  battery_storage: {
    group: 'electrical',
    label: 'Battery storage (fixed or mobile)',
    required: ['id', 'class', 'kwh', 'kw'],
  },
});

/**
 * Check a registry and return a list of readable problems; an empty list
 * means the registry is usable. Checks required fields, known classes,
 * unique ids, and that every reference (spec, meter, berth) resolves.
 */
export function validateRegistry(registry) {
  const errors = [];
  const assets = registry?.assets;
  if (!Array.isArray(assets)) return ['registry.assets must be an array'];
  const specs = registry.specs || {};
  const ids = new Set();
  for (const asset of assets) {
    const where = asset?.id ? `asset ${asset.id}` : 'asset without id';
    const definition = ASSET_CLASSES[asset?.class];
    if (!definition) {
      errors.push(`${where}: unknown class ${asset?.class}`);
      continue;
    }
    for (const field of definition.required) {
      if (
        asset[field] === undefined ||
        asset[field] === null ||
        asset[field] === ''
      )
        errors.push(`${where}: missing ${field}`);
    }
    if (ids.has(asset.id)) errors.push(`${where}: duplicate id`);
    ids.add(asset.id);
    if (asset.powertrain && !POWERTRAINS.includes(asset.powertrain))
      errors.push(`${where}: unknown powertrain ${asset.powertrain}`);
    if (asset.specId && !specs[asset.specId])
      errors.push(`${where}: unknown spec ${asset.specId}`);
  }
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) {
    for (const [field, cls] of [
      ['meterId', 'meter'],
      ['berthId', 'berth'],
    ]) {
      if (asset[field] === undefined) continue;
      const target = byId.get(asset[field]);
      if (!target || target.class !== cls)
        errors.push(
          `asset ${asset.id}: ${field} ${asset[field]} is not a ${cls}`,
        );
    }
  }
  return errors;
}

/** Count assets by class and powertrain, e.g. { utr: { diesel: 25, electric: 2 } }. */
export function inventorySummary(registry) {
  const summary = {};
  for (const asset of registry.assets) {
    const row = (summary[asset.class] ||= {});
    const key = asset.powertrain || 'none';
    row[key] = (row[key] || 0) + 1;
  }
  return summary;
}
