// Vessel characteristics: what the emissions method needs that AIS does not
// broadcast (EPA ship type and subtype, engine types, keel-laid year,
// installed power, maximum speed).
//
// AIS carries only a two-digit ship type code (ITU-R M.1371), so a "cargo"
// code (70-79) can be a car carrier, a reefer or a container ship. When a
// vessel has no registry entry, `characteristicsFor` returns the candidate EPA
// types instead of guessing one, and the caller reports a range.

import { DEFAULT_AUX_KW, DEFAULT_BOILER_KW } from './ogvFactors.js';

/** AIS ship type family (first digit of the code) to candidate EPA ship types. */
export const AIS_FAMILY_EPA_TYPES = Object.freeze({
  6: Object.freeze([
    'Cruise',
    'Ferry/Passenger (C3)',
    'Ferry/Roll-on/Passenger (C3)',
  ]),
  7: Object.freeze([
    'Bulk Carrier',
    'Container Ship',
    'General Cargo',
    'Reefer',
    'RORO',
    'Vehicle Carrier',
  ]),
  8: Object.freeze(
    Object.keys(DEFAULT_AUX_KW).filter((type) => type.includes('Tanker')),
  ),
});

/** Ocean-going (Category 3) families the method covers. Others are harbor craft. */
export const OGV_AIS_FAMILIES = Object.freeze(
  Object.keys(AIS_FAMILY_EPA_TYPES).map(Number),
);

/** The AIS ship type family (6, 7, 8 ...) from a raw code or family label. */
export function aisFamily(type) {
  const text = String(type ?? '')
    .trim()
    .toUpperCase();
  if (/^\d+$/.test(text)) {
    const code = Number(text);
    return code >= 20 && code < 100 ? Math.floor(code / 10) : null;
  }
  if (text === 'PASSENGER') return 6;
  if (text === 'CARGO') return 7;
  if (text === 'TANKER') return 8;
  return null;
}

/**
 * Validate and index registry rows. Each row names the vessel (MMSI and/or
 * IMO), its EPA characteristics, and a `source` for those values, so every
 * number stays traceable. Rows without a source are refused.
 */
export function createVesselRegistry(rows = []) {
  const byMmsi = new Map();
  const byImo = new Map();
  for (const row of rows) {
    if (!row?.source)
      throw new TypeError(
        `Vessel registry row needs a source: ${row?.mmsi || row?.imo}`,
      );
    if (!DEFAULT_AUX_KW[row.shipType]?.[row.subtype])
      throw new TypeError(
        `Unknown EPA type or subtype: ${row.shipType} / ${row.subtype}`,
      );
    const entry = Object.freeze({ ...row });
    if (row.mmsi) byMmsi.set(String(row.mmsi), entry);
    if (row.imo) byImo.set(String(row.imo).replace(/^IMO/i, ''), entry);
  }
  return Object.freeze({
    size: new Set([...byMmsi.values(), ...byImo.values()]).size,
    lookup({ mmsi, imo } = {}) {
      return (
        (imo && byImo.get(String(imo).replace(/^IMO/i, ''))) ||
        (mmsi && byMmsi.get(String(mmsi))) ||
        null
      );
    },
  });
}

/**
 * Characteristics for one AIS vessel: the registry entry when there is one,
 * otherwise the EPA types its AIS code allows, narrowed to the types the port
 * handles when the profile lists them (`profile.epaShipTypes`) and at least
 * one of them fits the code.
 *
 * Returns { known, entry?, family, candidates: [{ shipType, subtype }] }.
 * `candidates` is empty for harbor craft and unknown codes.
 */
export function characteristicsFor(vessel, { registry, profile } = {}) {
  const entry = registry?.lookup(vessel) ?? null;
  const family = aisFamily(vessel?.type ?? vessel?.shipType);
  if (entry)
    return {
      known: true,
      entry,
      family,
      candidates: [{ shipType: entry.shipType, subtype: entry.subtype }],
    };
  const portTypes = profile?.epaShipTypes?.types;
  const familyTypes = AIS_FAMILY_EPA_TYPES[family] ?? [];
  const portMatches = portTypes
    ? familyTypes.filter((type) => portTypes.includes(type))
    : [];
  // A visitor outside the port's usual trades still gets its family's range.
  const types = portMatches.length ? portMatches : familyTypes;
  const candidates = types.flatMap((shipType) =>
    Object.keys(DEFAULT_AUX_KW[shipType] ?? {}).map((subtype) => ({
      shipType,
      subtype,
    })),
  );
  return { known: false, entry: null, family, candidates };
}

/**
 * Appendix E hotel loads for a mode across a set of candidates, as a range.
 * Returns null when there are no candidates.
 */
export function hotelLoadRange(candidates, mode) {
  let range = null;
  for (const { shipType, subtype } of candidates) {
    const aux = DEFAULT_AUX_KW[shipType]?.[subtype]?.[mode];
    const boiler = DEFAULT_BOILER_KW[shipType]?.[subtype]?.[mode];
    if (aux === undefined || boiler === undefined) continue;
    range = range
      ? {
          auxKw: [Math.min(range.auxKw[0], aux), Math.max(range.auxKw[1], aux)],
          boilerKw: [
            Math.min(range.boilerKw[0], boiler),
            Math.max(range.boilerKw[1], boiler),
          ],
        }
      : { auxKw: [aux, aux], boilerKw: [boiler, boiler] };
  }
  return range;
}
