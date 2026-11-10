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
 * Data entry is typed on purpose: a value that feeds a formula is never
 * free text. Fields are dropdowns (enum, multi, ref, spec, choice), numbers
 * with units and limits (number, integer, year) or codes with a fixed
 * pattern (code). Only names and notes (text) take free text, and no
 * formula reads them.
 *
 * Pure: no Cesium, no DOM.
 */
import { TARIFFS } from './tariffs.js';

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
 *   text    free text, only for names and notes no formula reads
 *   number  a number, with optional unit, min, max and step
 *   integer a whole number, with optional unit, min and max
 *   year    a four-digit year
 *   bool    yes or no
 *   enum    one of options: [{ value, label, aliases? }]
 *   multi   any of options, stored as an array of values
 *   choice  a name picked from the values already in the registry (or a
 *           new one added once), so the same operator or document is not
 *           spelled three ways
 *   code    an identifier with a fixed pattern (MMSI, IMO, reporting mark)
 *   ref     the id of another asset (refClass: the class it must point at;
 *           refClass 'meter' may also point at the separate meter registry)
 *   spec    an id in registry.specs
 *   point   [lat, lon]; area [[lat, lon], ...]; line [[lat, lon], ...]
 */
export const FIELD_TYPES = Object.freeze([
  'text',
  'number',
  'integer',
  'year',
  'bool',
  'enum',
  'multi',
  'choice',
  'code',
  'ref',
  'spec',
  'point',
  'area',
  'line',
]);

/**
 * Options from [value, label, aliases?] rows. Aliases are other spellings
 * (older records, spreadsheet headings) that mean the same option.
 */
const options = (rows) =>
  Object.freeze(
    rows.map(([value, label, aliases = []]) =>
      Object.freeze({ value, label, aliases: Object.freeze(aliases) }),
    ),
  );

/** Railroads that serve or could serve a port. */
export const RAILROADS = options([
  [
    'vcrr',
    'Ventura County Railroad',
    [
      'VCRR',
      'VCRY',
      'Ventura County Railroad (Genesee & Wyoming)',
      'Ventura County Railway',
    ],
  ],
  ['up', 'Union Pacific', ['UP', 'UPRR', 'Union Pacific Railroad']],
  ['bnsf', 'BNSF Railway', ['BNSF']],
  ['metrolink', 'Metrolink', ['SCRRA']],
  ['amtrak', 'Amtrak', []],
  ['other', 'Other', []],
]);

/** Electric utilities. */
export const UTILITIES = options([
  ['sce', 'Southern California Edison', ['SCE', 'Edison']],
  ['pge', 'Pacific Gas and Electric', ['PG&E', 'PGE']],
  ['sdge', 'San Diego Gas & Electric', ['SDG&E', 'SDGE']],
  ['ladwp', 'Los Angeles Department of Water and Power', ['LADWP']],
  ['other', 'Other', []],
]);

/** Rate schedules the billing engine knows (tariffs.js). */
export const TARIFF_OPTIONS = options(
  Object.values(TARIFFS).map((tariff) => [tariff.id, tariff.name || tariff.id]),
);

/** Terminal zones of a port. */
export const ZONES = options([
  ['south_terminal', 'South Terminal', ['South']],
  ['north_terminal', 'North Terminal', ['North']],
  ['navy_terminal', 'Navy Terminal', ['Navy', 'Joint Use', 'Joint use']],
  ['other', 'Other', []],
]);

/** Wharves. */
export const WHARVES = options([
  ['wharf_1', 'Wharf 1', []],
  ['wharf_2', 'Wharf 2', []],
  ['navy_wharf', 'Navy wharf', []],
]);

/** Cargo types a berth or yard handles. */
export const CARGO_TYPES = options([
  ['reefer_containers', 'Reefer containers', ['reefer', 'reefers']],
  ['dry_containers', 'Dry containers', ['containers']],
  ['breakbulk_reefer', 'Break-bulk reefer (palletized fruit)', []],
  ['roro', 'Ro-ro (vehicles)', ['ro-ro', 'RoRo', 'vehicles', 'autos']],
  ['liquid_bulk', 'Liquid bulk (tankers)', ['tankers', 'tanker']],
  ['dry_bulk', 'Dry bulk', []],
  ['breakbulk', 'Break-bulk', ['break-bulk']],
  ['project_cargo', 'Project or heavy-lift cargo', ['heavy lift', 'project']],
  ['general_cargo', 'General cargo', ['general']],
  ['military', 'Military cargo', []],
]);

const f = (key, label, type, extra = {}) =>
  Object.freeze({ key, label, type, ...extra });

/** A count: a whole number, zero or more. */
const count = (key, label, extra = {}) =>
  f(key, label, 'integer', { min: 0, ...extra });

/** A measured quantity: a number, zero or more, with a unit. */
const quantity = (key, label, unit, extra = {}) =>
  f(key, label, 'number', { unit, min: 0, ...extra });

const YEAR = { min: 1900, max: 2100 };

/** Fields every asset can carry, whatever its class. */
export const COMMON_FIELDS = Object.freeze([
  f('id', 'ID', 'code', {
    required: true,
    pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$',
    example: 'utr-031',
    help: 'Filled in for you on a new asset.',
  }),
  f('label', 'Name', 'text'),
  f('status', 'Status', 'enum', {
    options: options([
      ['active', 'Active'],
      ['planned', 'Planned'],
      ['retired', 'Retired'],
    ]),
  }),
  f('operator', 'Operator or tenant', 'choice'),
  f('at', 'Location', 'point'),
  f('approximate', 'Location is approximate', 'bool'),
  f('source', 'Source', 'choice', {
    help: 'Where this record came from (document, survey, web page).',
  }),
  f('notes', 'Notes', 'text', { multiline: true }),
]);

const POWERTRAIN_FIELD = f('powertrain', 'Powertrain', 'enum', {
  required: true,
  options: options(POWERTRAINS.map((value) => [value, value])),
});

/** Fields shared by mobile equipment, vessels and locomotives. */
const EQUIPMENT_FIELDS = Object.freeze([
  POWERTRAIN_FIELD,
  f('specId', 'Energy spec', 'spec', { required: true }),
  f('make', 'Make', 'choice'),
  f('model', 'Model', 'choice'),
  f('year', 'Model year', 'year', YEAR),
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
  quantity('ratedKw', 'Rated power', 'kW', { max: 100000 }),
  count('annualHours', 'Operating hours per year', { unit: 'h', max: 8784 }),
  f('homeId', 'Home base', 'ref', {
    refClass: ['berth', 'building', 'yard'],
    help: 'Berth, building or yard where it parks or ties up.',
  }),
  f('meterId', 'Charging meter', 'ref', { refClass: 'meter' }),
]);

const VESSEL_FIELDS = Object.freeze([
  f('mmsi', 'MMSI', 'code', { pattern: '^[0-9]{9}$', example: '367123450' }),
  f('imo', 'IMO number', 'code', {
    pattern: '^[0-9]{7}$',
    check: 'imo',
    example: '9074729',
  }),
  quantity('lengthM', 'Length', 'm', { max: 500 }),
  quantity('bollardPullT', 'Bollard pull', 't', { max: 300 }),
]);

const AREA_FIELDS = Object.freeze([
  f('outline', 'Outline', 'area'),
  quantity('areaM2', 'Area', 'm²'),
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
  electrical: 'Electrical',
});

/**
 * Asset classes. `group` is the inventory section a staff user sees;
 * `fields` lists every field, with `required: true` on the ones validation
 * insists on; `required` is the same list as plain keys.
 */
export const ASSET_CLASSES = Object.freeze({
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
  light_duty: assetClass(
    'che',
    'Light-duty pickup, van or runner',
    EQUIPMENT_FIELDS,
  ),

  // Harbor craft
  tug: assetClass('harbor_craft', 'Tug', [
    ...EQUIPMENT_FIELDS,
    ...VESSEL_FIELDS,
    count('assistsPerYear', 'Ship assists per year'),
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
    f('railroad', 'Railroad', 'enum', { options: RAILROADS }),
    f('reportingMark', 'Reporting mark and number', 'code', {
      pattern: '^[A-Z]{2,4} [0-9]{1,6}$',
      example: 'VCRR 101',
    }),
    f('service', 'Service', 'enum', {
      options: options([
        ['switcher', 'Switcher'],
        ['line_haul', 'Line haul'],
      ]),
    }),
  ]),

  // Fixed assets
  berth: assetClass('fixed', 'Berth', [
    f('zone', 'Zone', 'enum', { required: true, options: ZONES }),
    f('shorePower', 'Has shore power', 'bool', { required: true }),
    quantity('lengthM', 'Berth length', 'm', { max: 2000 }),
    quantity('depthM', 'Depth alongside', 'm', { max: 40, step: 0.1 }),
    f('wharf', 'Wharf', 'enum', { options: WHARVES }),
    f('cargoTypes', 'Cargo handled', 'multi', { options: CARGO_TYPES }),
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
    quantity('floorAreaSqft', 'Floor area', 'sq ft'),
    quantity('heightM', 'Height', 'm', { max: 300 }),
    f('yearBuilt', 'Year built', 'year', YEAR),
    f('refrigerated', 'Refrigerated', 'bool'),
    METER_REF,
    count('osmId', 'OpenStreetMap way id', { min: 1 }),
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
    count('capacity', 'Capacity'),
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
    count('lanes', 'Lanes', { required: true, min: 1, max: 50 }),
    f('direction', 'Direction', 'enum', {
      options: options([
        ['in', 'Inbound'],
        ['out', 'Outbound'],
        ['both', 'Both'],
      ]),
    }),
    count('trucksPerDay', 'Trucks per day'),
    count('trucksPerMonth', 'Trucks per month'),
    count('trucksPerYear', 'Trucks per year'),
    quantity('hoursPerDay', 'Open hours per day', 'h', { max: 24, step: 0.5 }),
    count('daysPerWeek', 'Open days per week', { max: 7 }),
    quantity('meanDwellMin', 'Mean truck time in port', 'min', { max: 1440 }),
    quantity('meanIdleMin', 'Mean idling at gate', 'min', { max: 1440 }),
    f('street', 'Street access', 'choice'),
  ]),
  rail_spur: assetClass('landside', 'Rail spur', [
    f('path', 'Track', 'line'),
    quantity('lengthM', 'Length', 'm', { max: 50000 }),
    f('railroad', 'Serving railroad', 'enum', { options: RAILROADS }),
    count('railcarsPerYear', 'Railcars per year'),
    count('trainsPerWeek', 'Trains per week'),
  ]),

  // Electrical
  meter: assetClass('electrical', 'Utility meter', [
    f('utility', 'Utility', 'enum', { required: true, options: UTILITIES }),
    f('tariffId', 'Rate schedule', 'enum', {
      required: true,
      options: TARIFF_OPTIONS,
    }),
  ]),
  charger: assetClass('electrical', 'EV charger', [
    f('meterId', 'Utility meter', 'ref', { refClass: 'meter', required: true }),
    quantity('kw', 'Rated power', 'kW', { required: true, max: 10000 }),
    count('ports', 'Connectors', { min: 1, max: 64 }),
  ]),
  shore_power: assetClass('electrical', 'Shore power vault', [
    f('meterId', 'Utility meter', 'ref', { refClass: 'meter', required: true }),
    f('berthId', 'Berth', 'ref', { refClass: 'berth', required: true }),
    quantity('kw', 'Rated power', 'kW', { required: true, max: 50000 }),
  ]),
  reefer_rack: assetClass('electrical', 'Reefer plug rack', [
    f('meterId', 'Utility meter', 'ref', { refClass: 'meter', required: true }),
    count('plugs', 'Plugs', { required: true, min: 1, max: 5000 }),
  ]),
  battery_storage: assetClass(
    'electrical',
    'Battery storage (fixed or mobile)',
    [
      quantity('kwh', 'Energy capacity', 'kWh', { required: true }),
      quantity('kw', 'Power rating', 'kW', { required: true }),
      METER_REF,
    ],
  ),
});

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

/** The option `text` names: its value, its label or an alias (any case). */
export function matchOption(field, text) {
  const wanted = String(text).trim().toLowerCase();
  if (!wanted) return undefined;
  return (field.options || []).find(
    (option) =>
      String(option.value).toLowerCase() === wanted ||
      String(option.label).toLowerCase() === wanted ||
      (option.aliases || []).some((alias) => alias.toLowerCase() === wanted),
  );
}

/** IMO ship number check digit: 7 digits, the last checks the first six. */
export function imoValid(text) {
  if (!/^[0-9]{7}$/.test(String(text))) return false;
  const digits = String(text).split('').map(Number);
  const sum = digits
    .slice(0, 6)
    .reduce((acc, digit, i) => acc + digit * (7 - i), 0);
  return sum % 10 === digits[6];
}

const inRange = (field, value) => {
  if (field.min !== undefined && value < field.min)
    return `must be at least ${field.min}`;
  if (field.max !== undefined && value > field.max)
    return `must be at most ${field.max}`;
  return null;
};

/** One field value's problem, or null when it fits the field's type. */
export function checkValue(field, value) {
  switch (field.type) {
    case 'number':
      return Number.isFinite(value)
        ? inRange(field, value)
        : 'must be a number';
    case 'integer':
      return Number.isInteger(value)
        ? inRange(field, value)
        : 'must be a whole number';
    case 'year':
      return Number.isInteger(value) &&
        value >= (field.min ?? 1800) &&
        value <= (field.max ?? 2200)
        ? null
        : 'must be a year';
    case 'bool':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return field.options.some((option) => option.value === value)
        ? null
        : `must be one of ${field.options.map((o) => o.value).join(', ')}`;
    case 'multi':
      return Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((v) => field.options.some((o) => o.value === v))
        ? null
        : `must be a list of ${field.options.map((o) => o.value).join(', ')}`;
    case 'choice':
    case 'text':
      return typeof value === 'string' && value.trim() === value && value
        ? value.length <= 2000
          ? null
          : 'is too long'
        : 'must be text without leading or trailing spaces';
    case 'code':
      if (typeof value !== 'string' || !new RegExp(field.pattern).test(value))
        return `must look like ${field.example}`;
      if (field.check === 'imo' && !imoValid(value))
        return 'is not a valid IMO number (check digit)';
      return null;
    case 'ref':
    case 'spec':
      return typeof value === 'string' && value ? null : 'must be an id';
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

/** Collapse runs of spaces in a name, so "Oxnard  Harbor" matches. */
export const tidyText = (text) => String(text).replace(/\s+/g, ' ').trim();

/**
 * Read a typed value from text (a form box or a spreadsheet cell). Returns
 * { value } (undefined for an empty cell) or { error }. Strict on purpose:
 * "3" reads as 3 for a count, "three" is refused, so a formula never sees
 * text where it needs a number. Points and outlines are left to the admin
 * model, which parses coordinate text.
 */
export function readValue(field, input) {
  if (input === undefined || input === null) return { value: undefined };
  if (typeof input !== 'string') {
    if (Array.isArray(input) && field.type === 'multi') input = input.join(';');
    else if (typeof input === 'number' || typeof input === 'boolean')
      input = String(input);
    else return { value: input };
  }
  const text = input.trim();
  if (!text) return { value: undefined };
  let value;
  switch (field.type) {
    case 'number':
    case 'integer':
    case 'year': {
      const cleaned = text.replace(/,/g, '');
      if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned))
        return { error: 'must be a number (digits, like 3 or 2.5)' };
      value = Number(cleaned);
      break;
    }
    case 'bool': {
      const lower = text.toLowerCase();
      if (['true', 'yes', 'y', '1', 'x'].includes(lower)) value = true;
      else if (['false', 'no', 'n', '0'].includes(lower)) value = false;
      else return { error: 'must be yes or no' };
      break;
    }
    case 'enum': {
      const option = matchOption(field, text);
      if (!option)
        return {
          error: `is not an option (pick one of: ${field.options.map((o) => o.label).join(', ')})`,
        };
      value = option.value;
      break;
    }
    case 'multi': {
      const parts = text.split(/\s*[;|]\s*/).filter(Boolean);
      const picked = [];
      for (const part of parts) {
        const option = matchOption(field, part);
        if (!option) return { error: `"${part}" is not an option` };
        if (!picked.includes(option.value)) picked.push(option.value);
      }
      value = picked;
      break;
    }
    case 'choice':
    case 'text':
    case 'ref':
    case 'spec':
      value = field.multiline ? text : tidyText(text);
      break;
    case 'code':
      value =
        field.key === 'reportingMark' ? tidyText(text).toUpperCase() : text;
      break;
    default:
      return { value: text };
  }
  const problem = checkValue(field, value);
  return problem ? { error: problem } : { value };
}

/**
 * Bring a record saved under an older form up to the current one: old
 * spellings become dropdown values ("VCRR" and "Ventura County Railroad
 * (Genesee & Wyoming)" both become vcrr), numbers saved as text become
 * numbers, and renamed fields move (a berth's free-text `cargo` becomes
 * `cargoTypes`, a gate's free-text `hours` moves to its notes). A value
 * that cannot be read is left as it was, so validation still reports it and
 * nothing is silently lost. Pure; returns a new object.
 */
export function migrateAsset(asset) {
  const definition = ASSET_CLASSES[asset?.class];
  if (!definition) return asset;
  const out = { ...asset };
  const note = (text) => {
    out.notes = out.notes ? `${out.notes} ${text}` : text;
  };
  if (
    typeof out.cargo === 'string' &&
    definition.fields.some((x) => x.key === 'cargoTypes')
  ) {
    const field = definition.fields.find((x) => x.key === 'cargoTypes');
    const found = [];
    const lower = out.cargo.toLowerCase();
    const has = (word) => lower.includes(word);
    if (has('reefer')) found.push('reefer_containers');
    if (has('tanker') || has('liquid')) found.push('liquid_bulk');
    if (has('roro') || has('ro-ro') || has('vehicle')) found.push('roro');
    if (has('heavy lift') || has('project')) found.push('project_cargo');
    if (has('general')) found.push('general_cargo');
    if (has('break-bulk') || has('breakbulk')) found.push('breakbulk');
    if (found.length && !out.cargoTypes)
      out.cargoTypes = field.options
        .map((o) => o.value)
        .filter((v) => found.includes(v));
    note(`Cargo (as first entered): ${out.cargo}.`);
    delete out.cargo;
  }
  if (typeof out.hours === 'string' && asset.class === 'gate') {
    note(`Gate hours (as first entered): ${out.hours}.`);
    delete out.hours;
  }
  for (const field of definition.fields) {
    const value = out[field.key];
    if (value === undefined || value === null) continue;
    if (!checkValue(field, value)) continue;
    if (['point', 'area', 'line'].includes(field.type)) continue;
    const read = readValue(field, value);
    if (read.error === undefined && read.value !== undefined)
      out[field.key] = read.value;
  }
  return out;
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
