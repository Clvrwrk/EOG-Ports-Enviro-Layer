/**
 * Port asset registry schema.
 *
 * Every asset a port operates or hosts belongs to one class below: berths,
 * buildings, yards, gates, rail, cargo-handling equipment, harbor craft and
 * electrical gear. A class lists every field an asset of that class can
 * carry (`fields`), so the admin portal, the twin, the simulator and the
 * report generator all read the same shape. The registry itself is plain
 * data (see hueneme.js) and is checked with validateRegistry.
 *
 * A registry is { portId, source, specs, assets: [{ id, class, ...fields }] }.
 *
 * Positions use [lat, lon], the same order as the meter registry, the twin's
 * surveyed points and the OpenStreetMap site file:
 *   at: [lat, lon]                point (or label point for an area)
 *   outline: [[lat, lon], ...]    area, e.g. a building footprint or yard
 *   path: [[lat, lon], ...]       line, e.g. a rail spur
 * `approximate: true` marks a position that was not surveyed.
 *
 * Mobile equipment, locomotives, tugs and drayage trucks can name their
 * model in the fleet catalog (`catalogId`, see fleet/catalog.js), which
 * carries energy use and emissions, diesel and zero-emission.
 *
 * Pure: no Cesium, no DOM.
 */
import { modelsForAssetClass } from './fleet/catalog.js';

/** Energy source an asset runs on. */
export const POWERTRAINS = Object.freeze([
  'diesel',
  'electric',
  'hybrid',
  'hydrogen',
  'grid',
  'none',
]);

/** Life-cycle status of an asset. */
export const STATUSES = Object.freeze(['active', 'planned', 'retired']);

/**
 * Field types a form can render:
 *   text, number, year, bool,
 *   enum  (options: [{ value, label }]),
 *   ref   (refClass: the class the id must point at; refClass 'meter' may
 *          also point at the separate meter registry),
 *   spec  (an id in registry.specs),
 *   point ([lat, lon]), area ([[lat, lon], ...]), line ([[lat, lon], ...]).
 */
export const FIELD_TYPES = Object.freeze([
  'text',
  'number',
  'year',
  'bool',
  'enum',
  'ref',
  'spec',
  'point',
  'area',
  'line',
]);

const options = (pairs) =>
  Object.freeze(pairs.map(([value, label]) => Object.freeze({ value, label })));

const f = (key, label, type, extra = {}) =>
  Object.freeze({ key, label, type, ...extra });

/** Fields every asset can carry, whatever its class. */
export const COMMON_FIELDS = Object.freeze([
  f('id', 'ID', 'text', { required: true }),
  f('label', 'Name', 'text'),
  f('status', 'Status', 'enum', {
    options: options([
      ['active', 'Active'],
      ['planned', 'Planned'],
      ['retired', 'Retired'],
    ]),
  }),
  f('operator', 'Operator or tenant', 'text'),
  f('at', 'Location', 'point'),
  f('approximate', 'Location is approximate', 'bool'),
  f('source', 'Source', 'text', {
    help: 'Where this record came from (document, survey, web page).',
  }),
  f('notes', 'Notes', 'text'),
]);

const POWERTRAIN_FIELD = f('powertrain', 'Powertrain', 'enum', {
  required: true,
  options: options(POWERTRAINS.map((value) => [value, value])),
});

/** Fields shared by mobile equipment, vessels and locomotives. */
const EQUIPMENT_FIELDS = Object.freeze([
  POWERTRAIN_FIELD,
  f('specId', 'Energy spec', 'spec', { required: true }),
  f('make', 'Make', 'text'),
  f('model', 'Model', 'text'),
  f('year', 'Model year', 'year'),
  f('engineTier', 'Engine tier', 'enum', {
    options: options([
      ['tier0', 'Tier 0'],
      ['tier1', 'Tier 1'],
      ['tier2', 'Tier 2'],
      ['tier3', 'Tier 3'],
      ['tier4i', 'Tier 4 interim'],
      ['tier4f', 'Tier 4 final'],
      ['ze', 'Zero emission'],
    ]),
  }),
  f('ratedKw', 'Rated power', 'number', { unit: 'kW' }),
  f('annualHours', 'Operating hours per year', 'number', { unit: 'h' }),
  f('homeId', 'Home base', 'ref', {
    refClass: ['berth', 'building', 'yard'],
    help: 'Berth, building or yard where it parks or ties up.',
  }),
  f('meterId', 'Charging meter', 'ref', { refClass: 'meter' }),
]);

const VESSEL_FIELDS = Object.freeze([
  f('mmsi', 'MMSI', 'text'),
  f('imo', 'IMO number', 'text'),
  f('lengthM', 'Length', 'number', { unit: 'm' }),
  f('bollardPullT', 'Bollard pull', 'number', { unit: 't' }),
]);

const AREA_FIELDS = Object.freeze([
  f('outline', 'Outline', 'area'),
  f('areaM2', 'Area', 'number', { unit: 'm²' }),
]);

const METER_REF = f('meterId', 'Utility meter', 'ref', { refClass: 'meter' });

/** Build a class: common fields first, then the class's own. */
function assetClass(group, label, own) {
  const fields = Object.freeze([...COMMON_FIELDS, ...own]);
  return Object.freeze({
    group,
    label,
    fields,
    required: Object.freeze(
      ['id', 'class'].concat(
        fields.filter((x) => x.required && x.key !== 'id').map((x) => x.key),
      ),
    ),
  });
}

/** Inventory sections, in the order the admin portal and twin list them. */
export const ASSET_GROUPS = Object.freeze({
  fixed: 'Berths, buildings and yards',
  landside: 'Gates and rail',
  che: 'Cargo-handling equipment',
  harbor_craft: 'Tugs and harbor craft',
  rail: 'Locomotives',
  trucks: 'Drayage trucks',
  electrical: 'Electrical',
});

/** Asset classes before the fleet catalog pickers are added. */
const RAW_CLASSES = Object.freeze({
  // Cargo-handling equipment (CHE)
  utr: assetClass(
    'che',
    'Utility tractor rig (yard tractor)',
    EQUIPMENT_FIELDS,
  ),
  sts_crane: assetClass('che', 'Ship-to-shore crane', EQUIPMENT_FIELDS),
  mobile_harbor_crane: assetClass(
    'che',
    'Mobile harbor crane',
    EQUIPMENT_FIELDS,
  ),
  reach_stacker: assetClass('che', 'Reach stacker', EQUIPMENT_FIELDS),
  top_handler: assetClass('che', 'Top handler', EQUIPMENT_FIELDS),
  forklift: assetClass('che', 'Forklift', EQUIPMENT_FIELDS),
  rtg_crane: assetClass('che', 'Rubber-tired gantry crane', EQUIPMENT_FIELDS),
  straddle_carrier: assetClass('che', 'Straddle carrier', EQUIPMENT_FIELDS),
  empty_handler: assetClass('che', 'Empty container handler', EQUIPMENT_FIELDS),
  light_duty: assetClass(
    'che',
    'Light-duty pickup, van or runner',
    EQUIPMENT_FIELDS,
  ),

  // Harbor craft
  tug: assetClass('harbor_craft', 'Tug', [
    ...EQUIPMENT_FIELDS,
    ...VESSEL_FIELDS,
    f('assistsPerYear', 'Ship assists per year', 'number'),
  ]),
  harbor_craft: assetClass('harbor_craft', 'Other harbor craft', [
    f('craftType', 'Craft type', 'enum', {
      required: true,
      options: options([
        ['pilot', 'Pilot boat'],
        ['workboat', 'Workboat'],
        ['crew_supply', 'Crew or supply boat'],
        ['fireboat', 'Fireboat'],
        ['patrol', 'Patrol boat'],
        ['dredge', 'Dredge'],
        ['barge', 'Barge'],
        ['research', 'Research or survey vessel'],
        ['fishing', 'Commercial fishing vessel'],
        ['other', 'Other'],
      ]),
    }),
    ...EQUIPMENT_FIELDS,
    ...VESSEL_FIELDS,
  ]),

  // Rail
  locomotive: assetClass('rail', 'Locomotive', [
    ...EQUIPMENT_FIELDS,
    f('railroad', 'Railroad', 'text'),
    f('reportingMark', 'Reporting mark and number', 'text'),
    f('service', 'Service', 'enum', {
      options: options([
        ['switcher', 'Switcher'],
        ['line_haul', 'Line haul'],
      ]),
    }),
  ]),

  // Drayage trucks serving the port (owned by trucking companies, listed
  // so the EV planner and freight footprint can use the real fleet mix).
  drayage_truck: assetClass('trucks', 'Drayage truck or truck fleet', [
    POWERTRAIN_FIELD,
    f('units', 'Trucks in this fleet', 'number', { required: true }),
    f('make', 'Make', 'text'),
    f('model', 'Model', 'text'),
    f('year', 'Model year', 'year'),
    f('tripsPerDay', 'Port trips per truck per day', 'number'),
    f('cargo', 'Main cargo', 'enum', {
      options: options([
        ['container', 'Containers'],
        ['reefer', 'Reefer containers (fruit)'],
        ['autos', 'New vehicles (auto carrier)'],
        ['breakbulk', 'Break-bulk or project cargo'],
        ['other', 'Other'],
      ]),
    }),
    f('homeId', 'Staging yard', 'ref', { refClass: ['yard', 'building'] }),
  ]),

  // Fixed assets
  berth: assetClass('fixed', 'Berth', [
    f('zone', 'Zone', 'text', { required: true }),
    f('shorePower', 'Has shore power', 'bool', { required: true }),
    f('lengthM', 'Berth length', 'number', { unit: 'm' }),
    f('depthM', 'Depth alongside', 'number', { unit: 'm' }),
    f('wharf', 'Wharf', 'text'),
    f('cargo', 'Main cargo', 'text'),
    ...AREA_FIELDS,
  ]),
  building: assetClass('fixed', 'Building', [
    f('use', 'Use', 'enum', {
      required: true,
      options: options([
        ['cold_storage', 'Cold storage warehouse'],
        ['warehouse', 'Dry warehouse or transit shed'],
        ['office', 'Office or administration'],
        ['maintenance', 'Maintenance shop'],
        ['auto_processing', 'Vehicle processing'],
        ['gatehouse', 'Gatehouse or security'],
        ['tank', 'Storage tank'],
        ['utility', 'Utility or substation'],
        ['other', 'Other'],
      ]),
    }),
    ...AREA_FIELDS,
    f('floorAreaSqft', 'Floor area', 'number', { unit: 'sq ft' }),
    f('heightM', 'Height', 'number', { unit: 'm' }),
    f('yearBuilt', 'Year built', 'year'),
    f('refrigerated', 'Refrigerated', 'bool'),
    METER_REF,
    f('osmId', 'OpenStreetMap way id', 'number'),
  ]),
  yard: assetClass('fixed', 'Yard or lot', [
    f('use', 'Use', 'enum', {
      required: true,
      options: options([
        ['auto_storage', 'Vehicle storage'],
        ['container', 'Container yard'],
        ['reefer_stack', 'Reefer container stack'],
        ['breakbulk', 'Break-bulk or project cargo'],
        ['laydown', 'Laydown'],
        ['equipment_parking', 'Equipment parking or queue'],
        ['truck_staging', 'Truck staging'],
        ['rail_yard', 'Rail yard'],
        ['other', 'Other'],
      ]),
    }),
    ...AREA_FIELDS,
    f('capacity', 'Capacity', 'number'),
    f('capacityUnit', 'Capacity unit', 'enum', {
      options: options([
        ['vehicles', 'Vehicles'],
        ['teu', 'TEU'],
        ['ground_slots', 'Ground slots'],
        ['units', 'Equipment units'],
        ['railcars', 'Railcars'],
      ]),
    }),
    METER_REF,
  ]),
  gate: assetClass('landside', 'Truck gate', [
    f('lanes', 'Lanes', 'number', { required: true }),
    f('direction', 'Direction', 'enum', {
      options: options([
        ['in', 'Inbound'],
        ['out', 'Outbound'],
        ['both', 'Both'],
      ]),
    }),
    f('trucksPerDay', 'Trucks per day', 'number'),
    f('trucksPerMonth', 'Trucks per month', 'number'),
    f('trucksPerYear', 'Trucks per year', 'number'),
    f('hours', 'Gate hours', 'text'),
    f('meanDwellMin', 'Mean truck time in port', 'number', { unit: 'min' }),
    f('meanIdleMin', 'Mean idling at gate', 'number', { unit: 'min' }),
    f('street', 'Street access', 'text'),
  ]),
  rail_spur: assetClass('landside', 'Rail spur', [
    f('path', 'Track', 'line'),
    f('lengthM', 'Length', 'number', { unit: 'm' }),
    f('railroad', 'Serving railroad', 'text'),
    f('railcarsPerYear', 'Railcars per year', 'number'),
    f('trainsPerWeek', 'Trains per week', 'number'),
  ]),

  // Electrical
  meter: assetClass('electrical', 'Utility meter', [
    f('utility', 'Utility', 'text', { required: true }),
    f('tariffId', 'Rate schedule', 'text', { required: true }),
  ]),
  charger: assetClass('electrical', 'EV charger', [
    f('meterId', 'Utility meter', 'ref', { refClass: 'meter', required: true }),
    f('kw', 'Rated power', 'number', { unit: 'kW', required: true }),
    f('ports', 'Connectors', 'number'),
  ]),
  shore_power: assetClass('electrical', 'Shore power vault', [
    f('meterId', 'Utility meter', 'ref', { refClass: 'meter', required: true }),
    f('berthId', 'Berth', 'ref', { refClass: 'berth', required: true }),
    f('kw', 'Rated power', 'number', { unit: 'kW', required: true }),
  ]),
  reefer_rack: assetClass('electrical', 'Reefer plug rack', [
    f('meterId', 'Utility meter', 'ref', { refClass: 'meter', required: true }),
    f('plugs', 'Plugs', 'number', { required: true }),
  ]),
  battery_storage: assetClass(
    'electrical',
    'Battery storage (fixed or mobile)',
    [
      f('kwh', 'Energy capacity', 'number', { unit: 'kWh', required: true }),
      f('kw', 'Power rating', 'number', { unit: 'kW', required: true }),
      METER_REF,
    ],
  ),
});

/** The catalog model picker for `cls`, or null when the catalog has none. */
function catalogField(cls) {
  const models = modelsForAssetClass(cls);
  if (models.length === 0) return null;
  return f('catalogId', 'Fleet catalog model', 'enum', {
    options: options(models.map((m) => [m.id, m.label])),
    help: 'Model in the fleet catalog (/ev-planning): its energy use and emissions, diesel and zero-emission.',
  });
}

/**
 * Asset classes. `group` is the inventory section a staff user sees;
 * `fields` lists every field, with `required: true` on the ones validation
 * insists on; `required` is the same list as plain keys. Classes with fleet
 * catalog models also get a `catalogId` picker.
 */
export const ASSET_CLASSES = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_CLASSES).map(([cls, definition]) => {
      const pick = catalogField(cls);
      if (!pick) return [cls, definition];
      const own = definition.fields.slice(COMMON_FIELDS.length);
      return [
        cls,
        assetClass(definition.group, definition.label, [...own, pick]),
      ];
    }),
  ),
);

/** The field definition for `key` on `cls`, or undefined. */
export function fieldOf(cls, key) {
  return ASSET_CLASSES[cls]?.fields.find((field) => field.key === key);
}

const isPoint = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  Math.abs(value[0]) <= 90 &&
  Math.abs(value[1]) <= 180;

const isPointList = (value, min) =>
  Array.isArray(value) && value.length >= min && value.every(isPoint);

/** One field value's problem, or null when it fits the field's type. */
function checkValue(field, value) {
  switch (field.type) {
    case 'number':
      return Number.isFinite(value) ? null : 'must be a number';
    case 'year':
      return Number.isInteger(value) && value > 1800 && value < 2200
        ? null
        : 'must be a year';
    case 'bool':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return field.options.some((option) => option.value === value)
        ? null
        : `must be one of ${field.options.map((o) => o.value).join(', ')}`;
    case 'point':
      return isPoint(value) ? null : 'must be [lat, lon]';
    case 'area':
      return isPointList(value, 3) ? null : 'must be 3+ [lat, lon] points';
    case 'line':
      return isPointList(value, 2) ? null : 'must be 2+ [lat, lon] points';
    default:
      return null;
  }
}

/**
 * Check a registry and return a list of readable problems; an empty list
 * means the registry is usable. Checks known classes, required fields,
 * field types, unique ids, and that every reference (spec, meter, berth,
 * home base) resolves. `meterIds` lists ids from the separate meter
 * registry (src/portos/meters) that meterId fields may also point at.
 */
export function validateRegistry(registry, { meterIds = [] } = {}) {
  const errors = [];
  const assets = registry?.assets;
  if (!Array.isArray(assets)) return ['registry.assets must be an array'];
  const specs = registry.specs || {};
  const ids = new Set();
  const byId = new Map();
  for (const asset of assets) {
    if (asset?.id) byId.set(asset.id, asset);
  }
  const externalMeters = new Set(meterIds);
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
    for (const field of definition.fields) {
      const value = asset[field.key];
      if (value === undefined || value === null) continue;
      const problem = checkValue(field, value);
      if (problem) errors.push(`${where}: ${field.key} ${problem}`);
      if (field.type === 'spec' && !specs[value])
        errors.push(`${where}: unknown spec ${value}`);
      if (field.type === 'ref') {
        const allowed = [].concat(field.refClass);
        const target = byId.get(value);
        const ok =
          (target && allowed.includes(target.class)) ||
          (allowed.includes('meter') && externalMeters.has(value));
        if (!ok)
          errors.push(
            `${where}: ${field.key} ${value} is not a ${allowed.join(' or ')}`,
          );
      }
    }
  }
  return errors;
}

/**
 * Where to put an asset on a map: its `at` point, else the centre of its
 * outline or path. { lat, lon } or null when it has no position.
 */
export function assetPosition(asset) {
  if (isPoint(asset?.at)) return { lat: asset.at[0], lon: asset.at[1] };
  const points = asset?.outline || asset?.path;
  if (!isPointList(points, 1)) return null;
  const sum = points.reduce(
    (acc, [lat, lon]) => [acc[0] + lat, acc[1] + lon],
    [0, 0],
  );
  return { lat: sum[0] / points.length, lon: sum[1] / points.length };
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

/** Assets grouped by inventory section: { fixed: [...], che: [...], ... }. */
export function assetsByGroup(registry) {
  const groups = Object.fromEntries(
    Object.keys(ASSET_GROUPS).map((group) => [group, []]),
  );
  for (const asset of registry.assets) {
    const group = ASSET_CLASSES[asset.class]?.group;
    if (group) groups[group].push(asset);
  }
  return groups;
}
