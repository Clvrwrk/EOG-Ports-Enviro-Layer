// Live port activity: turns a stream of AIS snapshots into per-vessel time in
// each operating mode inside one port's inventory domain, and an at-berth
// estimate of auxiliary load and emissions.
//
// Method: EPA-420-B-22-011. Zones and modes follow Table 3.11 (via zoneFor and
// operatingMode); time between two fixes is credited to the mode of the
// earlier fix, and gaps over `maxGapHours` are not filled (Section 3.8.3).
//
// AIS does not say which EPA ship type or subtype a vessel is, or its engine
// tier, so without a registry entry each estimate is a [low, high] range over
// the candidates its AIS code allows. Propulsion (transit and maneuvering)
// needs installed power and is left out until the vessel table supplies it.

import { zoneFor } from './ports.js';
import { engineEmissionFactors, operatingMode } from './ogvMethod.js';
import {
  OGV_AIS_FAMILIES,
  characteristicsFor,
  hotelLoadRange,
} from './vesselRegistry.js';
import { DEFAULT_MAX_GAP_HOURS } from './aisCalls.js';

const MS_PER_HOUR = 3_600_000;
const AT_BERTH_SULFUR = 0.001; // ECA and CARB at-berth distillate limit.
// Keel-laid years standing for each NOx tier row of Table 3.5.
const TIER_KEEL_YEARS = Object.freeze([1999, 2005, 2012, 2017]);
const AUX_ENGINE_TYPES = Object.freeze(['MSD', 'HSD']);
const TRACKED = Object.freeze(['nox', 'pm25', 'dpm', 'co2']);

const zeroRange = () => [0, 0];
const addRange = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scaleRange = (a, b) => [a[0] * b[0], a[1] * b[1]];

/** [low, high] g/kWh per tracked pollutant for one engine group. */
export function factorRange(group, { keelYear, engineType } = {}) {
  const years = keelYear ? [keelYear] : TIER_KEEL_YEARS;
  const types =
    group === 'boiler'
      ? ['Boiler']
      : engineType
        ? [engineType]
        : AUX_ENGINE_TYPES;
  const range = Object.fromEntries(TRACKED.map((p) => [p, null]));
  for (const type of types) {
    for (const year of years) {
      const { factors } = engineEmissionFactors({
        group,
        fuel: 'MGO/MDO',
        engineType: type,
        keelYear: year,
        fuelSulfur: AT_BERTH_SULFUR,
      });
      for (const p of TRACKED) {
        const v = factors[p];
        if (v === null || v === undefined) continue;
        range[p] = range[p]
          ? [Math.min(range[p][0], v), Math.max(range[p][1], v)]
          : [v, v];
      }
    }
  }
  for (const p of TRACKED) range[p] ??= zeroRange();
  return range;
}

/**
 * Track one port. `observe` takes vessel records shaped like the AIS layer's
 * analyst records ({ mmsi, name, lat, lon, speedKts, shipType, imo }).
 */
export function createPortActivity(
  profile,
  { registry = null, maxGapHours = DEFAULT_MAX_GAP_HOURS } = {},
) {
  const vessels = new Map();
  const maxGapMs = maxGapHours * MS_PER_HOUR;

  function hotelEstimate(vessel) {
    const info = characteristicsFor(
      { mmsi: vessel.mmsi, imo: vessel.imo, type: vessel.shipType },
      { registry, profile },
    );
    const loads = hotelLoadRange(info.candidates, 'hotelling');
    if (!loads) return null;
    return {
      known: info.known,
      candidates: info.candidates.length,
      auxKw: loads.auxKw,
      boilerKw: loads.boilerKw,
      auxFactors: factorRange('auxiliary', {
        keelYear: info.entry?.keelYear,
        engineType: info.entry?.auxiliary?.engineType,
      }),
      boilerFactors: factorRange('boiler'),
    };
  }

  function credit(vessel, hours) {
    vessel.hoursByMode[vessel.mode] =
      (vessel.hoursByMode[vessel.mode] ?? 0) + hours;
    if (vessel.mode !== 'hotelling' || !vessel.hotel) return;
    const h = [hours, hours];
    const aux = scaleRange(vessel.hotel.auxKw, h);
    const boiler = scaleRange(vessel.hotel.boilerKw, h);
    vessel.auxKwh = addRange(vessel.auxKwh, aux);
    vessel.boilerKwh = addRange(vessel.boilerKwh, boiler);
    for (const p of TRACKED) {
      vessel.grams[p] = addRange(
        vessel.grams[p],
        addRange(
          scaleRange(aux, vessel.hotel.auxFactors[p]),
          scaleRange(boiler, vessel.hotel.boilerFactors[p]),
        ),
      );
    }
  }

  function observe(records, atMs) {
    if (!Number.isFinite(atMs)) throw new TypeError('observe needs a time');
    for (const record of records ?? []) {
      const mmsi = String(record?.mmsi ?? '').trim();
      if (!mmsi || !Number.isFinite(record.lat) || !Number.isFinite(record.lon))
        continue;
      const family = characteristicsFor(
        { type: record.shipType ?? record.type },
        {},
      ).family;
      if (!OGV_AIS_FAMILIES.includes(family)) continue;
      const zone = zoneFor(profile, record.lon, record.lat);
      const mode = operatingMode({ zone, speedKn: record.speedKts });
      let vessel = vessels.get(mmsi);
      if (vessel && vessel.mode && atMs > vessel.lastMs) {
        const gap = atMs - vessel.lastMs;
        if (gap <= maxGapMs) credit(vessel, gap / MS_PER_HOUR);
      }
      if (!zone) {
        if (vessel) {
          vessel.zone = null;
          vessel.mode = null;
          vessel.lastMs = atMs;
        }
        continue;
      }
      if (!vessel) {
        vessel = {
          mmsi,
          firstSeenMs: atMs,
          hoursByMode: {},
          auxKwh: zeroRange(),
          boilerKwh: zeroRange(),
          grams: Object.fromEntries(TRACKED.map((p) => [p, zeroRange()])),
        };
        vessels.set(mmsi, vessel);
      }
      Object.assign(vessel, {
        name: record.name ?? vessel.name ?? mmsi,
        imo: record.imo ?? vessel.imo ?? null,
        shipType: record.shipType ?? record.type ?? vessel.shipType ?? null,
        lat: record.lat,
        lon: record.lon,
        speedKts: record.speedKts ?? null,
        zone,
        mode,
        lastMs: atMs,
      });
      vessel.hotel ??= hotelEstimate(vessel);
    }
    for (const [mmsi, vessel] of vessels) {
      if (atMs - vessel.lastMs > maxGapMs) {
        vessel.zone = null;
        vessel.mode = null;
        if (!Object.keys(vessel.hoursByMode).length) vessels.delete(mmsi);
      }
    }
  }

  function summary() {
    const current = [...vessels.values()].filter((v) => v.zone);
    const byMode = {};
    for (const v of current) byMode[v.mode] = (byMode[v.mode] ?? 0) + 1;
    let auxKwNow = zeroRange();
    let unestimated = 0;
    for (const v of current) {
      if (v.mode !== 'hotelling') continue;
      if (v.hotel) auxKwNow = addRange(auxKwNow, v.hotel.auxKw);
      else unestimated += 1;
    }
    let auxKwh = zeroRange();
    let boilerKwh = zeroRange();
    const grams = Object.fromEntries(TRACKED.map((p) => [p, zeroRange()]));
    let hotellingHours = 0;
    let propulsionHours = 0;
    for (const v of vessels.values()) {
      auxKwh = addRange(auxKwh, v.auxKwh);
      boilerKwh = addRange(boilerKwh, v.boilerKwh);
      for (const p of TRACKED) grams[p] = addRange(grams[p], v.grams[p]);
      hotellingHours += v.hoursByMode.hotelling ?? 0;
      propulsionHours +=
        (v.hoursByMode.transit ?? 0) + (v.hoursByMode.maneuvering ?? 0);
    }
    const warnings = [];
    if (propulsionHours > 0)
      warnings.push(
        `Propulsion left out for ${propulsionHours.toFixed(1)} vessel-hours of transit and maneuvering: installed power is not in AIS.`,
      );
    if (unestimated)
      warnings.push(
        `${unestimated} vessel(s) at berth have no AIS ship type, so no hotel load.`,
      );
    if (current.some((v) => v.hotel && !v.hotel.known))
      warnings.push(
        'Ship type, subtype and engine tier are not in AIS; at-berth figures are ranges over the candidates.',
      );
    return {
      port: profile.id,
      vessels: current.map((v) => ({
        mmsi: v.mmsi,
        name: v.name,
        lat: v.lat,
        lon: v.lon,
        zone: v.zone,
        mode: v.mode,
        speedKts: v.speedKts,
        hoursByMode: { ...v.hoursByMode },
        auxKw: v.mode === 'hotelling' ? (v.hotel?.auxKw ?? null) : null,
        known: v.hotel?.known ?? false,
      })),
      byMode,
      // Auxiliary demand of ships at berth now: the grid demand if every one
      // plugged into shore power (boilers stay on fuel either way).
      atBerthAuxKwNow: auxKwNow,
      hotellingHours,
      energyKwh: { auxiliary: auxKwh, boiler: boilerKwh },
      tonnes: Object.fromEntries(
        TRACKED.map((p) => [p, grams[p].map((g) => g / 1e6)]),
      ),
      warnings,
      method:
        'EPA-420-B-22-011: Table 3.11 modes, Appendix E hotel loads, Tables 3.5-3.9 factors on 0.1% sulfur distillate',
    };
  }

  return Object.freeze({
    observe,
    summary,
    reset: () => vessels.clear(),
  });
}
