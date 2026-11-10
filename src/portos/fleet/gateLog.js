/**
 * The POH truck gate log: one row per truck visit with the VIN, time in and
 * time out (what the gate records for every truck). Reads spreadsheets of
 * gate rows and of trucker registrations (which link a VIN to its carrier
 * from the first registration on), summarizes visits, time on terminal and
 * the diesel fleet by age and engine standard, and models swapping diesel
 * visits for N electric trucks doing N trips a day, oldest diesels first.
 *
 * Times are wall-clock strings 'YYYY-MM-DDTHH:MM' (port local time); no
 * time zone is applied. Pure functions, no DOM: the same code runs in tests.
 */
import { parseCsv } from '../admin/adminModel.js';
import {
  DEFAULT_BEV_DRAYAGE_ID,
  DEFAULT_DIESEL_DRAYAGE_ID,
  EMISSION_FACTORS,
  emissionsPerUnit,
  energyPerUnit,
  fleetModel,
} from './catalog.js';
import { ENGINE_BANDS, decodeVin, normalizeVin, vinProblem } from './vin.js';

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' from '2026-11-10', '11/10/2026' or '11/10/26'; else null. */
export function readDate(text) {
  const s = String(text ?? '').trim();
  let y;
  let m;
  let d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    [, m, d, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 'HH:MM' from '6:05', '06:05:30', '6:05 pm', '1805' or '6 PM'; else null. */
export function readTime(text) {
  const s = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  const match = s.match(/^(\d{1,2})(?::?(\d{2}))?(?::\d{2})?\s*(am|pm|a|p)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3]?.[0];
  if (!match[2] && !half) return null; // a bare number is not a time
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** { date, time } from a time with an optional date in front. */
function readStamp(text) {
  const s = String(text ?? '').trim();
  if (!s) return { date: null, time: null };
  const split = s.match(/^(\S+?)[T ]+(.+)$/);
  if (split && readDate(split[1]))
    return { date: readDate(split[1]), time: readTime(split[2]) };
  return { date: null, time: readTime(s) };
}

/** Minutes since 1970 for a wall-clock 'YYYY-MM-DDTHH:MM'. */
export function stampMinutes(stamp) {
  const [date, time] = stamp.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) / 60000;
}

function addDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const MAX_DWELL_MIN = 24 * 60;

/**
 * Check one visit. Input fields are text: vin, date (optional when the
 * times carry one), timeIn, timeOut (optional: still on terminal).
 * A time out earlier than the time in, with no date of its own, is the
 * next morning. Returns { row: { vin, timeIn, timeOut } } or { error }.
 */
export function readGateRow({ vin, date = '', timeIn, timeOut = '' }) {
  const problem = vinProblem(vin);
  if (problem) return { error: problem };
  const day = String(date).trim() ? readDate(date) : null;
  if (String(date).trim() && !day)
    return { error: `date "${date}" is not a date` };
  const inStamp = readStamp(timeIn);
  if (!inStamp.time)
    return { error: `time in "${timeIn ?? ''}" is not a time` };
  const inDate = inStamp.date ?? day;
  if (!inDate) return { error: 'the visit has no date' };
  const row = {
    vin: normalizeVin(vin),
    timeIn: `${inDate}T${inStamp.time}`,
    timeOut: null,
  };
  if (String(timeOut ?? '').trim()) {
    const outStamp = readStamp(timeOut);
    if (!outStamp.time) return { error: `time out "${timeOut}" is not a time` };
    let outDate = outStamp.date ?? inDate;
    if (!outStamp.date && outStamp.time < inStamp.time)
      outDate = addDay(inDate);
    row.timeOut = `${outDate}T${outStamp.time}`;
    const dwell = stampMinutes(row.timeOut) - stampMinutes(row.timeIn);
    if (dwell < 0) return { error: 'time out is before time in' };
    if (dwell > MAX_DWELL_MIN)
      return { error: 'more than 24 hours on terminal; check the times' };
  }
  return { row };
}

const norm = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Which gate-log field a spreadsheet column holds, or null. */
function gateColumn(header) {
  const h = norm(header);
  if (h === 'vin' || h.startsWith('vin') || h.endsWith('vin')) return 'vin';
  if (/out|exit|depart|left/.test(h)) return 'timeOut';
  if (/in$|^in|entr|arriv/.test(h)) return 'timeIn';
  if (/date|day/.test(h)) return 'date';
  return null;
}

/**
 * Gate visits from CSV text. Columns are found by name: VIN; time in (In,
 * Entry, Arrival); time out (Out, Exit, Departure); Date when the times
 * carry none. Returns { rows, errors: [{ line, problem }], unknownColumns }.
 */
export function gateRowsFromCsv(text) {
  const table = parseCsv(text);
  if (!table.length)
    return {
      rows: [],
      errors: [{ line: 0, problem: 'The file is empty' }],
      unknownColumns: [],
    };
  const [header, ...body] = table;
  const columns = header.map(gateColumn);
  const unknownColumns = header.filter((_, i) => !columns[i]);
  for (const need of ['vin', 'timeIn'])
    if (!columns.includes(need))
      return {
        rows: [],
        errors: [
          {
            line: 1,
            problem: `No ${need === 'vin' ? 'VIN' : 'time in'} column (found: ${header.join(', ')})`,
          },
        ],
        unknownColumns,
      };
  const rows = [];
  const errors = [];
  body.forEach((cells, i) => {
    const input = {};
    columns.forEach((key, c) => {
      if (key && input[key] === undefined) input[key] = cells[c] ?? '';
    });
    const { row, error } = readGateRow(input);
    if (row) rows.push(row);
    else errors.push({ line: i + 2, vin: input.vin ?? '', problem: error });
  });
  return { rows, errors, unknownColumns };
}

/**
 * VIN-to-carrier links from a trucker registration export. Only the VIN,
 * the dispatching carrier and the entry date are read; names, phones and
 * plates are ignored. A VIN belongs to the carrier that registered it
 * first. Returns { byVin: Map<vin, { carrier, since }>, changed, errors }.
 * `changed` lists VINs later registered by a different carrier.
 */
export function registrationsFromCsv(text) {
  const table = parseCsv(text);
  const byVin = new Map();
  const changed = [];
  const errors = [];
  if (!table.length) return { byVin, changed, errors: ['The file is empty'] };
  const [header, ...body] = table.map((r) => r.map((c) => c.trim()));
  const find = (test) => header.findIndex((h) => test(norm(h)));
  const vinCol = find((h) => h === 'vin' || h.includes('vin'));
  const carrierCol = find((h) => /carrier|broker|dispatch|company/.test(h));
  const dateCol = find((h) => /date|entry|submitted|created/.test(h));
  if (vinCol < 0 || carrierCol < 0)
    return {
      byVin,
      changed,
      errors: [`Needs VIN and carrier columns (found: ${header.join(', ')})`],
    };
  const entries = [];
  body.forEach((cells, i) => {
    const vin = normalizeVin(cells[vinCol]);
    const carrier = (cells[carrierCol] ?? '').replace(/\s+/g, ' ').trim();
    const problem = vinProblem(vin);
    if (problem) errors.push(`line ${i + 2}: ${problem}`);
    else if (!carrier) errors.push(`line ${i + 2}: no carrier`);
    else {
      const stamp = dateCol >= 0 ? readStamp(cells[dateCol]) : {};
      entries.push({ vin, carrier, since: stamp.date ?? null, order: i });
    }
  });
  entries.sort(
    (a, b) =>
      (a.since ?? '9999').localeCompare(b.since ?? '9999') || a.order - b.order,
  );
  for (const { vin, carrier, since } of entries) {
    const first = byVin.get(vin);
    if (!first) byVin.set(vin, { carrier, since });
    else if (first.carrier.toLowerCase() !== carrier.toLowerCase())
      changed.push({ vin, carrier: first.carrier, later: carrier });
  }
  return { byVin, changed, errors };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export const UNKNOWN_BAND = Object.freeze({
  id: 'unknown',
  label: 'Model year unknown',
  californiaOk: null,
});

export const NOT_REGISTERED = 'Not registered (compliant trucks)';

/**
 * Summarize gate visits. `registrations` maps VIN to { carrier };
 * `lookups` (from vin.lookupVins) can correct make and model year.
 */
export function summarizeGateLog(
  rows,
  { registrations = new Map(), lookups = new Map(), now = new Date() } = {},
) {
  const trucks = new Map();
  const days = new Map();
  const byHour = new Array(24).fill(0);
  const dwell = [];
  for (const row of rows) {
    let truck = trucks.get(row.vin);
    if (!truck) {
      const decoded = decodeVin(row.vin, { now });
      const looked = lookups.get(row.vin);
      const modelYear = looked?.modelYear ?? decoded.modelYear;
      truck = {
        vin: row.vin,
        visits: 0,
        make: looked?.make ?? decoded.make,
        model: looked?.model ?? null,
        fuel: looked?.fuel ?? null,
        modelYear,
        ageYears: modelYear === null ? null : now.getUTCFullYear() - modelYear,
        band:
          ENGINE_BANDS.find((b) => modelYear >= b.from && modelYear <= b.to) ??
          UNKNOWN_BAND,
        carrier: registrations.get(row.vin)?.carrier ?? null,
      };
      trucks.set(row.vin, truck);
    }
    truck.visits += 1;
    const date = row.timeIn.slice(0, 10);
    const day = days.get(date) ?? { date, visits: 0, vins: new Set() };
    day.visits += 1;
    day.vins.add(row.vin);
    days.set(date, day);
    byHour[Number(row.timeIn.slice(11, 13))] += 1;
    if (row.timeOut)
      dwell.push(stampMinutes(row.timeOut) - stampMinutes(row.timeIn));
  }
  dwell.sort((a, b) => a - b);
  const list = [...trucks.values()];
  const group = (keyOf) => {
    const out = new Map();
    for (const t of list) {
      const key = keyOf(t);
      const g = out.get(key) ?? { key, trucks: 0, visits: 0 };
      g.trucks += 1;
      g.visits += t.visits;
      out.set(key, g);
    }
    return [...out.values()].sort((a, b) => b.visits - a.visits);
  };
  const bandGroups = new Map(group((t) => t.band.id).map((g) => [g.key, g]));
  const ages = list
    .map((t) => t.ageYears)
    .filter((a) => a !== null)
    .sort((a, b) => a - b);
  const notOk = list.filter((t) => t.band.californiaOk === false);
  return {
    visits: rows.length,
    trucks: list.length,
    days: days.size,
    visitsPerDay: days.size ? rows.length / days.size : 0,
    byDay: [...days.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ date, visits, vins }) => ({ date, visits, trucks: vins.size })),
    byHour,
    dwellMinutes: {
      count: dwell.length,
      median: quantile(dwell, 0.5),
      p90: quantile(dwell, 0.9),
      mean: dwell.length
        ? dwell.reduce((a, b) => a + b, 0) / dwell.length
        : null,
    },
    medianAgeYears: quantile(ages, 0.5),
    bands: [...ENGINE_BANDS, UNKNOWN_BAND].map((band) => ({
      band,
      trucks: bandGroups.get(band.id)?.trucks ?? 0,
      visits: bandGroups.get(band.id)?.visits ?? 0,
    })),
    californiaNotOk: {
      trucks: notOk.length,
      visits: notOk.reduce((sum, t) => sum + t.visits, 0),
    },
    byCarrier: group((t) => t.carrier ?? NOT_REGISTERED),
    byMake: group((t) => t.make ?? 'Unknown make'),
    truckList: list.sort((a, b) => b.visits - a.visits),
  };
}

/** Engine work per mile for a diesel drayage tractor (bhp-hr per mile). */
export const BHP_HR_PER_MILE =
  EMISSION_FACTORS.rail.bhpHrPerGallon / EMISSION_FACTORS.truck.dieselMpg;

/**
 * Swap diesel visits for electric trucks. `evTrucks` trucks each make
 * `tripsPerTruck` port visits a day, each a round trip of `roundTripMi`
 * miles (home yard to the port, the drop site and back). They displace
 * diesel visits from the oldest engine band first (unknown years last).
 * Emissions per visit: NOx and PM from the band's certification limit
 * times engine work per mile; CO2 from the catalog diesel tractor; the EV
 * adds grid CO2 at its charging site. Results are per day and per year.
 */
export function evSwapScenario(
  summary,
  {
    evTrucks = 0,
    tripsPerTruck = 2,
    roundTripMi = 60,
    operatingDays = 260,
    bhpHrPerMile = BHP_HR_PER_MILE,
  } = {},
) {
  const days = summary.days || 1;
  const diesel = fleetModel(DEFAULT_DIESEL_DRAYAGE_ID);
  const ev = fleetModel(DEFAULT_BEV_DRAYAGE_ID);
  const dieselCo2PerMi = emissionsPerUnit(diesel).co2eKg;
  const evCo2PerMi = emissionsPerUnit(ev).co2eKg;
  const evKwhPerMi = energyPerUnit(ev).kwh;
  const perVisit = (band) => {
    const work = bhpHrPerMile * roundTripMi;
    // An unknown year counts as the fleet-average planning factor.
    const nox = band.noxGPerBhpHr
      ? band.noxGPerBhpHr * work
      : EMISSION_FACTORS.truck.noxGPerMi * roundTripMi;
    const pm = band.pmGPerBhpHr
      ? band.pmGPerBhpHr * work
      : EMISSION_FACTORS.truck.pm25GPerMi * roundTripMi;
    return {
      noxKg: nox / 1000,
      pmKg: pm / 1000,
      co2Kg: dieselCo2PerMi * roundTripMi,
    };
  };
  const order = [...summary.bands]
    .filter((b) => b.visits > 0)
    .sort((a, b) => (a.band.from ?? 99999) - (b.band.from ?? 99999));
  const dieselPerDay = summary.visitsPerDay;
  let left = Math.min(evTrucks * tripsPerTruck, dieselPerDay);
  const evVisits = left;
  const baseline = { noxKg: 0, pmKg: 0, co2Kg: 0 };
  const saved = { noxKg: 0, pmKg: 0, co2Kg: 0 };
  const displaced = [];
  for (const { band, visits } of order) {
    const daily = visits / days;
    const e = perVisit(band);
    for (const k of Object.keys(baseline)) baseline[k] += e[k] * daily;
    const take = Math.min(left, daily);
    left -= take;
    if (take > 0) {
      displaced.push({ band, visitsPerDay: take });
      for (const k of Object.keys(saved)) saved[k] += e[k] * take;
    }
  }
  const evGridCo2Kg = evCo2PerMi * roundTripMi * evVisits;
  saved.co2Kg -= evGridCo2Kg;
  const scenario = {
    noxKg: baseline.noxKg - saved.noxKg,
    pmKg: baseline.pmKg - saved.pmKg,
    co2Kg: baseline.co2Kg - saved.co2Kg,
  };
  const year = (o) =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, v * operatingDays]),
    );
  return {
    evVisitsPerDay: evVisits,
    requestedVisitsPerDay: evTrucks * tripsPerTruck,
    dieselVisitsPerDay: dieselPerDay,
    displaced,
    evGridCo2KgPerDay: evGridCo2Kg,
    perDay: { baseline, scenario, saved },
    perYear: {
      baseline: year(baseline),
      scenario: year(scenario),
      saved: year(saved),
    },
    evEnergyKwhPerDay: evKwhPerMi * roundTripMi * evVisits,
  };
}
