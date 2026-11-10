/**
 * Scenarios as saved, shared and compared things: cleaning a scenario that
 * came from a link or a file, packing it into a URL, keeping a named library
 * in the browser, and reducing a run to the numbers a comparison needs.
 *
 * Pure except for the storage object the library helpers are handed.
 */
import { CHARGING_STRATEGIES } from './fleetSim.js';
import {
  CALL_PROFILE,
  FACTORS,
  FLEET_PLAN,
  SPECS,
  UNIT_COSTS,
} from './hueneme.js';
import { DELIVERED_PROFILES } from './delivered.js';
import { DEFAULT_SCENARIO } from './scenario.js';
import { TARIFFS } from './tariffs.js';

export const SPEC_IDS = Object.freeze(Object.keys(SPECS));
export const CALL_TYPES = Object.freeze([
  ...new Set(CALL_PROFILE.map((row) => row.type)),
]);
export const YEAR_RANGE = Object.freeze([2023, 2040]);
export const LIBRARY_KEY = 'portos.scenarios.v1';
export const SCENARIO_PARAM = 'scenario';
export const TWIN_PATH = '/ports/california/port-of-hueneme';
const DEFAULT_ROUND_TRIP = 0.88;

const clamp = (value, low, high, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
};
const whole = (value, low, high, fallback) =>
  Math.round(clamp(value, low, high, fallback));

/** Diesel/electric units the fleet plan has for a spec in a year, or null. */
export function planMix(year, specId) {
  const years = Object.keys(FLEET_PLAN)
    .map(Number)
    .sort((a, b) => a - b);
  const pick = years.filter((y) => y <= year).pop() ?? years[0];
  const row = FLEET_PLAN[pick][specId];
  if (!row) return null;
  return { diesel: row[0], electric: row[1], chargers: row[1] };
}

/**
 * A full, safe scenario from anything: a link, an imported file, a saved
 * entry from an older build. Unknown keys are dropped and every number is
 * clamped, so the result can always be run.
 */
export function normalizeScenario(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_SCENARIO;
  const fleet = {};
  const rawFleet = raw.fleet && typeof raw.fleet === 'object' ? raw.fleet : {};
  for (const specId of SPEC_IDS) {
    const mix = rawFleet[specId];
    if (!mix || typeof mix !== 'object') continue;
    const electric = whole(mix.electric, 0, 200, 0);
    fleet[specId] = {
      electric,
      diesel: whole(mix.diesel, 0, 200, 0),
      chargers: whole(mix.chargers, 0, 400, electric),
    };
  }
  let battery = null;
  if (raw.battery && raw.battery.kwh > 0 && raw.battery.kw > 0) {
    const threshold = raw.battery.thresholdKw;
    battery = {
      kwh: clamp(raw.battery.kwh, 1, 200_000, 1000),
      kw: clamp(raw.battery.kw, 1, 100_000, 500),
      roundTripEfficiency: clamp(
        raw.battery.roundTripEfficiency,
        0.5,
        1,
        DEFAULT_ROUND_TRIP,
      ),
      thresholdKw:
        threshold == null || threshold === 'auto'
          ? 'auto'
          : clamp(threshold, 0, 1_000_000, 'auto'),
    };
  }
  let tariffAdjust = null;
  if (raw.tariffAdjust && typeof raw.tariffAdjust === 'object') {
    const pct = (value) => Math.round(clamp(value, -90, 300, 0) * 10) / 10;
    const adjust = {
      energyPct: pct(raw.tariffAdjust.energyPct),
      demandPct: pct(raw.tariffAdjust.demandPct),
      customerPct: pct(raw.tariffAdjust.customerPct),
    };
    if (adjust.energyPct || adjust.demandPct || adjust.customerPct)
      tariffAdjust = adjust;
  }
  let delivered = null;
  if (raw.delivered && typeof raw.delivered === 'object') {
    const sharePct = clamp(raw.delivered.sharePct, 0, 100, 0);
    if (sharePct > 0)
      delivered = {
        sharePct,
        profile: DELIVERED_PROFILES[raw.delivered.profile]
          ? raw.delivered.profile
          : 'share',
        pricePerKwh: clamp(raw.delivered.pricePerKwh, 0, 2, 0),
      };
  }
  const types = Array.isArray(raw.shorePowerTypes)
    ? raw.shorePowerTypes.filter((type) => CALL_TYPES.includes(type))
    : [...d.shorePowerTypes];
  return {
    name: String(raw.name ?? '').slice(0, 80) || 'Untitled scenario',
    year: whole(raw.year, YEAR_RANGE[0], YEAR_RANGE[1], d.year),
    seed: whole(raw.seed, 1, 999_999, d.seed),
    callScale: clamp(raw.callScale, 0.25, 3, d.callScale),
    tariffId: TARIFFS[raw.tariffId] ? raw.tariffId : d.tariffId,
    includeDeferredDemand: Boolean(raw.includeDeferredDemand),
    strategy: CHARGING_STRATEGIES[raw.strategy] ? raw.strategy : d.strategy,
    reserve: clamp(raw.reserve, 0, 0.9, d.reserve),
    chargerEfficiency: clamp(
      raw.chargerEfficiency,
      0.5,
      1,
      d.chargerEfficiency,
    ),
    fleet,
    shorePower: Boolean(raw.shorePower),
    shorePowerTypes: types.length ? types : [...d.shorePowerTypes],
    baseLoadKw: clamp(raw.baseLoadKw, 0, 100_000, d.baseLoadKw),
    battery,
    capexMethod: raw.capexMethod === 'workbook' ? 'workbook' : 'per-unit',
    fillGapWithDiesel: raw.fillGapWithDiesel !== false,
    tariffAdjust,
    delivered,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that differ from a default scenario, to keep links short. */
function diffFromDefault(scenario) {
  const full = normalizeScenario(scenario);
  const base = normalizeScenario({ name: full.name });
  const out = { name: full.name };
  for (const key of Object.keys(full))
    if (!same(full[key], base[key])) out[key] = full[key];
  return out;
}

const toBase64Url = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};
const fromBase64Url = (text) => {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
};

/** A scenario as a URL-safe token. */
export function encodeScenario(scenario) {
  return toBase64Url(JSON.stringify(diffFromDefault(scenario)));
}

/** The scenario in a token, or null when the token is not one. */
export function decodeScenario(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parsed = JSON.parse(fromBase64Url(token));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    return normalizeScenario(parsed);
  } catch {
    return null;
  }
}

/** The scenario named in a URL's query string, or null. */
export function scenarioFromSearch(search) {
  return decodeScenario(new URLSearchParams(search).get(SCENARIO_PARAM));
}

/** A link that opens `path` with the scenario loaded. */
export function scenarioLink(scenario, path, origin = '') {
  return `${origin}${path}?${SCENARIO_PARAM}=${encodeScenario(scenario)}`;
}

/** Scenario as a file, and back. */
export function exportScenarioJson(scenario) {
  return JSON.stringify(
    {
      format: 'portos-scenario',
      version: 1,
      scenario: normalizeScenario(scenario),
    },
    null,
    2,
  );
}
export function importScenarioJson(text) {
  try {
    const parsed = JSON.parse(text);
    const body =
      parsed?.format === 'portos-scenario' ? parsed.scenario : parsed;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return normalizeScenario(body);
  } catch {
    return null;
  }
}

// ---- the saved library ----------------------------------------------------

const emptyLibrary = () => ({ version: 1, items: [], baselineId: null });

/** Saved scenarios from storage; an empty library when there are none. */
export function readLibrary(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(LIBRARY_KEY) ?? 'null');
    if (!parsed || !Array.isArray(parsed.items)) return emptyLibrary();
    const items = parsed.items
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => ({
        id: item.id,
        savedAt: Number(item.savedAt) || 0,
        scenario: normalizeScenario(item.scenario),
      }));
    const baselineId = items.some((item) => item.id === parsed.baselineId)
      ? parsed.baselineId
      : null;
    return { version: 1, items, baselineId };
  } catch {
    return emptyLibrary();
  }
}

/** Returns false when the browser refuses the write (private mode, full). */
export function writeLibrary(storage, library) {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

/** Save a scenario under an id (a new one when `id` is not in the library). */
export function saveToLibrary(library, scenario, id, now = Date.now()) {
  const entry = {
    id:
      id ??
      `s${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    savedAt: now,
    scenario: normalizeScenario(scenario),
  };
  const exists = library.items.some((item) => item.id === entry.id);
  return {
    library: {
      ...library,
      items: exists
        ? library.items.map((item) => (item.id === entry.id ? entry : item))
        : [...library.items, entry],
    },
    id: entry.id,
  };
}

export function removeFromLibrary(library, id) {
  return {
    ...library,
    items: library.items.filter((item) => item.id !== id),
    baselineId: library.baselineId === id ? null : library.baselineId,
  };
}

/** The scenario every comparison is measured against. */
export function baselineScenario(library) {
  const item = library.items.find((entry) => entry.id === library.baselineId);
  return item
    ? item.scenario
    : normalizeScenario({ name: 'Fleet plan, as today' });
}

/** A name not yet used in the library ("Copy of X", "Copy of X 2", ...). */
export function uniqueName(library, wanted) {
  const taken = new Set(library.items.map((item) => item.scenario.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1)
    if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

// ---- comparing runs -------------------------------------------------------

/**
 * Net cost of the zero-emission units a scenario has beyond the 2023 fleet,
 * at the workbook's unit costs (capital less voucher, plus charging
 * infrastructure). The site battery is not priced: there is no cost for it
 * in the workbook.
 */
export function zeroEmissionCapex(result) {
  let total = 0;
  for (const [specId, fleet] of Object.entries(result.fleets)) {
    const cost = UNIT_COSTS[specId];
    if (!cost) continue;
    const had = FLEET_PLAN[2023][specId]?.[1] ?? 0;
    total +=
      Math.max(0, fleet.electric - had) *
      (cost.capital - cost.voucher + cost.infrastructure);
  }
  return total;
}

/** The numbers a comparison shows for one run. `better` is the good direction. */
export const METRICS = Object.freeze([
  { id: 'spend', label: 'Energy spend / yr', unit: '$', better: -1 },
  { id: 'electricity', label: 'Electricity bill / yr', unit: '$', better: -1 },
  { id: 'demand', label: 'of which demand charges', unit: '$', better: -1 },
  {
    id: 'delivered',
    label: 'Delivered energy cost / yr',
    unit: '$',
    better: -1,
  },
  { id: 'diesel', label: 'Diesel cost / yr', unit: '$', better: -1 },
  { id: 'peakKw', label: 'Peak at the meter', unit: 'kW', better: -1 },
  { id: 'mwh', label: 'Grid energy / yr', unit: 'MWh', better: 0 },
  { id: 'gallons', label: 'Diesel / yr', unit: 'gal', better: -1 },
  { id: 'co2', label: 'Equipment CO2 / yr', unit: 't', better: -1 },
  { id: 'capex', label: 'ZE equipment vs 2023 fleet', unit: '$', better: 0 },
  { id: 'unmet', label: 'Uncovered crew hours', unit: 'hr', better: -1 },
]);

export function summarize(result) {
  const t = result.totals;
  return {
    spend: t.electricityCost + (t.deliveredCost ?? 0) + t.dieselCost,
    electricity: t.electricityCost,
    demand: t.demandCost,
    delivered: t.deliveredCost ?? 0,
    diesel: t.dieselCost,
    peakKw: t.peakKw,
    mwh: t.kwh / 1000,
    gallons: t.dieselGallons,
    co2: t.co2Tonnes,
    capex: zeroEmissionCapex(result),
    unmet: t.unmetHours,
  };
}

/**
 * Comparison table: one row per metric, one cell per run, each with its
 * difference from the baseline run and whether that is good or bad.
 */
export function compareRuns(baseline, runs) {
  const base = summarize(baseline);
  const columns = runs.map(summarize);
  return METRICS.map((metric) => ({
    ...metric,
    base: base[metric.id],
    cells: columns.map((column) => {
      const value = column[metric.id];
      const delta = value - base[metric.id];
      const flat = Math.abs(delta) < 0.5;
      return {
        value,
        delta,
        tone:
          flat || !metric.better
            ? 'flat'
            : delta * metric.better > 0
              ? 'good'
              : 'bad',
      };
    }),
  }));
}

/** Simple payback of the extra ZE equipment from yearly energy savings. */
export function paybackYears(baseline, run) {
  const a = summarize(baseline);
  const b = summarize(run);
  const saving = a.spend - b.spend;
  const extra = b.capex - a.capex;
  if (extra <= 0 || saving <= 0) return null;
  return extra / saving;
}

// ---- exports ---------------------------------------------------------------

const csv = (rows) =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? '');
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(','),
    )
    .join('\n');
const r2 = (value) => Math.round(value * 100) / 100;

export function billsCsv(result) {
  return csv([
    ['month', 'kwh', 'max_kw', 'energy_usd', 'demand_usd', 'total_usd'],
    ...result.bills.map((b) => [
      b.month,
      r2(b.kwh),
      r2(b.maxKw),
      r2(b.energyCost),
      r2(b.demandCost),
      r2(b.total),
    ]),
  ]);
}

export function loadCsv(result) {
  const pad = (n) => String(n).padStart(2, '0');
  const rows = [
    ['time', 'tou_period', 'site_kw', 'meter_kw', 'diesel_gal', 'co2_kg'],
  ];
  for (let i = 0; i < result.meterKw.length; i += 1) {
    const t = result.calendar[i];
    rows.push([
      `${result.scenario.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}`,
      result.periods[i],
      r2(result.siteKw[i]),
      r2(result.meterKw[i]),
      Math.round(result.dieselGallons[i] * 1e4) / 1e4,
      r2(result.dieselGallons[i] * FACTORS.dieselKgCo2PerGallon),
    ]);
  }
  return csv(rows);
}
