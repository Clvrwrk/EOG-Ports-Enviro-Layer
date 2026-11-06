// Turn AIS position records into port calls and timed operating-mode
// intervals, following EPA-420-B-22-011 Sections 3.8.2-3.8.5. Works on any AIS
// source that yields { mmsi, t (ms), lon, lat, sog (kn), draft? } records,
// including NOAA/BOEM MarineCadastre CSV rows (see parseMarineCadastreRow).

import { operatingMode, propulsionLoad } from './ogvMethod.js';
import { zoneFor } from './ports.js';

/** Gaps longer than this inside the domain are not filled (Section 3.8.3). */
export const DEFAULT_MAX_GAP_HOURS = 6;

const HOUR_MS = 3_600_000;

/**
 * Parse one MarineCadastre "AIS Vessel Broadcast Points" CSV row (already split
 * into an object keyed by header). Returns null for unusable rows.
 */
export function parseMarineCadastreRow(row) {
  const mmsi = String(row.MMSI ?? row.mmsi ?? '').trim();
  const t = Date.parse(
    `${String(row.BaseDateTime ?? row.base_date_time ?? '').trim()}Z`,
  );
  const lat = Number(row.LAT ?? row.latitude);
  const lon = Number(row.LON ?? row.longitude);
  const sog = Number(row.SOG ?? row.sog);
  if (
    !mmsi ||
    !Number.isFinite(t) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  )
    return null;
  const draft = Number(row.Draft ?? row.draft);
  return {
    mmsi,
    t,
    lon,
    lat,
    sog: Number.isFinite(sog) && sog >= 0 && sog < 102.3 ? sog : null,
    draft: Number.isFinite(draft) && draft > 0 ? draft : null,
    imo:
      String(row.IMO ?? row.imo ?? '')
        .replace(/^IMO/i, '')
        .trim() || null,
    name: String(row.VesselName ?? row.vessel_name ?? '').trim() || null,
    aisVesselType: Number(row.VesselType ?? row.vessel_type) || null,
    lengthM: Number(row.Length ?? row.length) || null,
  };
}

/**
 * Split one vessel's records into port calls. A call is a contiguous run of
 * in-domain records; it counts as a port call only if it reaches a berth
 * (Section 3.8.2, berth geofencing). Others are innocent passage.
 */
export function splitCalls(
  records,
  profile,
  { maxGapHours = DEFAULT_MAX_GAP_HOURS } = {},
) {
  const sorted = [...records].sort((a, b) => a.t - b.t);
  const calls = [];
  let current = null;
  for (const r of sorted) {
    const zone = zoneFor(profile, r.lon, r.lat);
    if (zone === null) {
      if (current) calls.push(current);
      current = null;
      continue;
    }
    const gapHours = current ? (r.t - current.records.at(-1).t) / HOUR_MS : 0;
    if (current && gapHours > maxGapHours) {
      calls.push(current);
      current = null;
    }
    current ??= { mmsi: r.mmsi, records: [], reachedBerth: false };
    current.records.push({ ...r, zone });
    if (zone === 'berth') current.reachedBerth = true;
  }
  if (current) calls.push(current);
  return calls.map((c) => ({
    ...c,
    kind: c.reachedBerth ? 'port-call' : 'passage',
    startMs: c.records[0].t,
    endMs: c.records.at(-1).t,
  }));
}

/**
 * Timed intervals for one call: each record represents the time until the next
 * record, in the mode set by its zone, speed and load (Table 3.11). The last
 * record has no duration.
 */
export function callIntervals(
  call,
  vessel = {},
  { maxGapHours = DEFAULT_MAX_GAP_HOURS } = {},
) {
  const out = [];
  const records = call.records;
  for (let i = 0; i < records.length - 1; i++) {
    const r = records[i];
    const hours = (records[i + 1].t - r.t) / HOUR_MS;
    if (!(hours > 0) || hours > maxGapHours) continue;
    const load = propulsionLoad({
      installedKw: vessel.propulsion?.installedKw,
      speedKn: r.sog,
      maxSpeedKn: vessel.propulsion?.maxSpeedKn,
      serviceSpeedKn: vessel.propulsion?.serviceSpeedKn,
      draftM: r.draft,
      maxDraftM: vessel.propulsion?.maxDraftM,
    });
    const mode = operatingMode({
      zone: r.zone,
      speedKn: r.sog,
      loadFactor: load.loadFactor,
    });
    if (!mode) continue;
    out.push({
      startMs: r.t,
      endMs: records[i + 1].t,
      hours,
      mode,
      speedKn: r.sog,
      draftM: r.draft,
    });
  }
  return out;
}

/** Group records by MMSI. */
export function groupByVessel(records) {
  const map = new Map();
  for (const r of records) {
    if (!r) continue;
    if (!map.has(r.mmsi)) map.set(r.mmsi, []);
    map.get(r.mmsi).push(r);
  }
  return map;
}
