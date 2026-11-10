/**
 * Vehicle identification numbers for the drayage gate log: check a VIN
 * (17 characters, check digit), read its model year and maker, and place
 * the truck in an engine emission-standard band by model year. Optional
 * lookup of make, model and fuel through NHTSA's free vPIC decoder.
 *
 * The bands are US EPA / CARB heavy-duty engine certification limits, not
 * measured in-use emissions; engine and truck model years can differ by a
 * year (and glider kits differ more), so treat a band as a planning label.
 */

const TRANSLIT = Object.freeze({
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}); // prettier-ignore
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Model year codes (10th character); the cycle repeats every 30 years. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/**
 * World manufacturer identifiers (first three characters) for heavy trucks
 * seen at US ports. Anything else decodes as an unknown make until vPIC.
 */
export const HEAVY_TRUCK_WMI = Object.freeze({
  '1FU': 'Freightliner',
  '1FV': 'Freightliner',
  '3AK': 'Freightliner',
  '3AL': 'Freightliner',
  '1XK': 'Kenworth',
  '2XK': 'Kenworth',
  '3WK': 'Kenworth',
  '1XP': 'Peterbilt',
  '2XP': 'Peterbilt',
  '1NP': 'Peterbilt',
  '1HS': 'International',
  '1HT': 'International',
  '2HS': 'International',
  '3HS': 'International',
  '3HT': 'International',
  '4V4': 'Volvo',
  '4V5': 'Volvo',
  '4VG': 'Volvo',
  '1M1': 'Mack',
  '1M2': 'Mack',
  '5KK': 'Western Star',
  '5KJ': 'Western Star',
  '2WK': 'Western Star',
  '2FW': 'Sterling',
  '2FZ': 'Sterling',
});

/** Upper-case and strip spaces and dashes a person or a scan may add. */
export function normalizeVin(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

/** The check digit (0-9 or X) a VIN's other 16 characters call for. */
export function vinCheckDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
    if (value === undefined) return null;
    sum += value * WEIGHTS[i];
  }
  const rest = sum % 11;
  return rest === 10 ? 'X' : String(rest);
}

/**
 * Why `text` is not a usable VIN, or null when it is. Checks length, the
 * letters a VIN never uses (I, O, Q) and the check digit in position 9.
 */
export function vinProblem(text) {
  const vin = normalizeVin(text);
  if (!vin) return 'VIN is missing';
  if (vin.length !== 17)
    return `VIN must be 17 characters (this one has ${vin.length})`;
  if (/[IOQ]/.test(vin)) return 'VIN never uses the letters I, O or Q';
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
    return 'VIN uses only letters and digits';
  const expected = vinCheckDigit(vin);
  if (vin[8] !== expected)
    return `VIN check digit is wrong (position 9 should be ${expected}); check for a mistyped character`;
  return null;
}

export const isValidVin = (text) => vinProblem(text) === null;

/**
 * Model year from the 10th character: the latest year in the 30-year cycle
 * that is not after next year. Null for a code that is not a year.
 */
export function vinModelYear(vin, { now = new Date() } = {}) {
  const index = YEAR_CODES.indexOf(normalizeVin(vin)[9]);
  if (index < 0) return null;
  const latest = now.getUTCFullYear() + 1;
  let year = 1980 + index;
  while (year + 30 <= latest) year += 30;
  return year;
}

/**
 * Engine emission-standard bands by model year. NOx and PM are the
 * certification limits in g/bhp-hr (2004-06 NOx is the NMHC+NOx limit;
 * 2007-09 NOx is the typical phase-in family limit). `californiaOk` is
 * whether CARB's Truck and Bus rule lets a heavy truck run in California
 * (2010 or newer engine since January 2023).
 */
export const ENGINE_BANDS = Object.freeze(
  [
    {
      id: 'pre_1998',
      label: 'Before 1998',
      from: 0,
      to: 1997,
      noxGPerBhpHr: 5.0,
      pmGPerBhpHr: 0.1,
    },
    {
      id: 'y1998_2003',
      label: '1998 to 2003',
      from: 1998,
      to: 2003,
      noxGPerBhpHr: 4.0,
      pmGPerBhpHr: 0.1,
    },
    {
      id: 'y2004_2006',
      label: '2004 to 2006',
      from: 2004,
      to: 2006,
      noxGPerBhpHr: 2.5,
      pmGPerBhpHr: 0.1,
    },
    {
      id: 'y2007_2009',
      label: '2007 to 2009 (particulate filter)',
      from: 2007,
      to: 2009,
      noxGPerBhpHr: 1.2,
      pmGPerBhpHr: 0.01,
    },
    {
      id: 'y2010_2023',
      label: '2010 to 2023 (SCR, 0.2 g NOx)',
      from: 2010,
      to: 2023,
      noxGPerBhpHr: 0.2,
      pmGPerBhpHr: 0.01,
    },
    {
      id: 'y2024_on',
      label: '2024 and newer (CARB low-NOx)',
      from: 2024,
      to: 9999,
      noxGPerBhpHr: 0.05,
      pmGPerBhpHr: 0.005,
    },
  ].map((band) => Object.freeze({ ...band, californiaOk: band.from >= 2010 })),
);

export const ENGINE_BAND_SOURCE =
  'US EPA heavy-duty diesel engine certification limits (40 CFR 86.004-11, 86.007-11) and CARB Omnibus low-NOx (2024+); CARB Truck and Bus regulation (13 CCR 2025) requires 2010+ engines from 2023. Certification limits, not in-use emissions.';

/** The engine band for a model year, or null when the year is unknown. */
export function engineBand(modelYear) {
  if (!Number.isInteger(modelYear)) return null;
  return (
    ENGINE_BANDS.find((b) => modelYear >= b.from && modelYear <= b.to) ?? null
  );
}

/**
 * Everything a VIN alone says: { vin, valid, problem, wmi, make, modelYear,
 * ageYears, band }. Make is null for a maker not in HEAVY_TRUCK_WMI.
 */
export function decodeVin(text, { now = new Date() } = {}) {
  const vin = normalizeVin(text);
  const problem = vinProblem(vin);
  if (problem) return { vin, valid: false, problem };
  const wmi = vin.slice(0, 3);
  const modelYear = vinModelYear(vin, { now });
  return {
    vin,
    valid: true,
    problem: null,
    wmi,
    make: HEAVY_TRUCK_WMI[wmi] ?? null,
    modelYear,
    ageYears: modelYear === null ? null : now.getUTCFullYear() - modelYear,
    band: engineBand(modelYear),
  };
}

export const VPIC_BATCH_URL =
  'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/';

/**
 * Look up make, model, model year, fuel and weight class for VINs with
 * NHTSA vPIC (free, no key; the VINs go to NHTSA). Batches of 50.
 * @returns {Promise<Map<string, {make, model, modelYear, fuel, gvwr, engine}>>}
 */
export async function lookupVins(vins, { fetchImpl = fetch } = {}) {
  const unique = [...new Set(vins.map(normalizeVin).filter(isValidVin))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const body = new URLSearchParams({ format: 'json', data: batch.join(';') });
    const response = await fetchImpl(VPIC_BATCH_URL, { method: 'POST', body });
    if (!response.ok)
      throw new Error(`NHTSA lookup failed (${response.status})`);
    const { Results = [] } = await response.json();
    for (const r of Results) {
      const year = Number.parseInt(r.ModelYear, 10);
      out.set(normalizeVin(r.VIN), {
        make: r.Make || null,
        model: r.Model || null,
        modelYear: Number.isInteger(year) ? year : null,
        fuel: r.FuelTypePrimary || null,
        gvwr: r.GVWR || null,
        engine:
          [r.EngineManufacturer, r.EngineModel].filter(Boolean).join(' ') ||
          null,
      });
    }
  }
  return out;
}
