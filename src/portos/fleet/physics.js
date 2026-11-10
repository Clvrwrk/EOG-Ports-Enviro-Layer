/**
 * Battery-electric truck trip physics, ported from FleetVolt
 * (github.com/Clvrwrk/fleetvolt, apps/web/convex/physics, itself a port of
 * the FleetVolt Python simulator). Formulas and constants are kept exactly
 * so results match FleetVolt's parity fixtures.
 *
 * Pipeline, as in FleetVolt's orchestrator:
 *   route + elevation -> segments (10-mile cuts, split on grades over 6%)
 *   -> speeds -> weather -> port drayage penalty -> road-load forces
 *   -> state of charge, segment by segment, with regen caps
 *   -> totals -> greedy charging stops -> feasibility verdict.
 *
 * Differences from FleetVolt:
 *   - Synchronous and pure: chargers are passed in, not searched in a
 *     database, and the detour to a charger is estimated from straight-line
 *     distance (no Google Directions call).
 *   - The port drayage zone is a parameter (FleetVolt baked in Long Beach);
 *     POH_DRAYAGE_ZONE covers the Port of Hueneme.
 *
 * Pure: no Cesium, no DOM, no network.
 */

// ── Constants (FleetVolt constants.ts, exact) ──────────────────────────────

export const G = 9.80665; // m/s²
export const MPS_PER_MPH = 0.44704;
export const US_MILE_M = 1609.344;
export const RHO_SEA_LEVEL = 1.225; // kg/m³ at 15 °C
export const LBS_TO_KG = 0.45359237;

export const MAX_PHYSICS_SEGMENTS = 200;
export const BASE_SEGMENT_M = US_MILE_M * 10;
export const GRADE_SCAN_INTERVAL_M = 150;
export const GRADE_SPLIT_THRESHOLD_PCT = 6;
export const KPH_TO_MPH = 1 / 1.609344;
export const DEFAULT_TRUCK_TOP_SPEED_MPH = 120 * KPH_TO_MPH;
export const DEFAULT_POSTED_MPH = 55;
export const OVERLAY_MIN = 0.85;
export const OVERLAY_MAX = 1;

export const MAX_ROUTE_MI = 800;
export const MAX_ROUTE_M = MAX_ROUTE_MI * US_MILE_M;

/** Port drayage: stop-and-go cap inside the port zone. */
export const PORT_SPEED_CAP_MPH = 25;
export const PORT_AUX_KW = 18;

/** Charging planner (FleetVolt chargingPlanner.ts). */
export const SEARCH_RADIUS_M = 40_234; // ~25 miles
export const FALLBACK_RADIUS_M = 80_468; // ~50 miles
export const MAX_DETOUR_S = 600;
export const MIN_HD_POWER_KW = 350;
export const CRITICAL_SOC_FLOOR_PCT = 5;
export const MIN_DWELL_BUFFER_S = 1800;

/** Detour estimate: road distance over straight line, and detour speed. */
export const DETOUR_ROAD_FACTOR = 1.3;
export const DETOUR_SPEED_MPH = 30;

export const DISCLAIMER =
  'Planning and feasibility tool only, not real-time dispatch guidance. ' +
  'Results depend on OEM assumptions, terrain heights and assumed speeds. ' +
  'Check against manufacturer claims before stakeholder decisions.';

/**
 * Port of Hueneme drayage zone, [lon, lat] ring: the harbor, terminals and
 * the gate approach on Port Hueneme Rd / Hueneme Rd. Rough box, drawn for
 * this port; FleetVolt used a Long Beach box.
 */
export const POH_DRAYAGE_ZONE = Object.freeze([
  [-119.2185, 34.1395],
  [-119.1905, 34.1395],
  [-119.1905, 34.1625],
  [-119.2185, 34.1625],
  [-119.2185, 34.1395],
]);

/** Weather presets (FleetVolt weather.ts). */
export const WEATHER_PRESETS = Object.freeze({
  ideal: { temp_c: 20, headwind_mph: 0, thermal_factor: 1, aux_mult: 1 },
  hot: { temp_c: 35, headwind_mph: 0, thermal_factor: 0.94, aux_mult: 1.15 },
  cold: { temp_c: 0, headwind_mph: 0, thermal_factor: 0.92, aux_mult: 1.5 },
  headwind: { temp_c: 20, headwind_mph: 15, thermal_factor: 1, aux_mult: 1 },
});

// ── Truck parameters ───────────────────────────────────────────────────────

/**
 * Physics parameters for a catalog truck (FleetVolt's truck JSON shape:
 * usable_kwh, curb_weight_lbs, C_rr, drag_coefficient, frontal_area_m2,
 * regen_efficiency, aux_kw_base, drivetrain_efficiency) plus payload.
 */
export function truckParams(physics, { payloadLbs = 0 } = {}) {
  return {
    usable_kwh: Number(physics.usable_kwh),
    curb_weight_lbs: Number(physics.curb_weight_lbs),
    payload_lbs: Number(payloadLbs),
    C_rr: Number(physics.C_rr),
    drag_coefficient: Number(physics.drag_coefficient),
    frontal_area_m2: Number(physics.frontal_area_m2),
    regen_efficiency: Number(physics.regen_efficiency),
    regen_power_cap_kw: Number(physics.regen_power_cap_kw ?? 350),
    regen_soc_cutoff: Number(physics.regen_soc_cutoff ?? 90),
    aux_kw_base: Number(physics.aux_kw_base),
    drivetrain_efficiency: Number(physics.drivetrain_efficiency),
  };
}

export function massKg(truck) {
  return (truck.curb_weight_lbs + truck.payload_lbs) * LBS_TO_KG;
}

// ── Geometry ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

export function haversineM(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Cumulative distance (m) at each vertex of a [lon, lat] polyline. */
export function cumulativeDistances(coordinates) {
  const cum = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    const [lon0, lat0] = coordinates[i - 1];
    const [lon1, lat1] = coordinates[i];
    cum.push(cum[i - 1] + haversineM(lat0, lon0, lat1, lon1));
  }
  return cum;
}

export function interpolateElev(profile, distM) {
  if (profile.length === 0) return 0;
  if (distM <= profile[0].dist_m) return profile[0].elev_m;
  const last = profile[profile.length - 1];
  if (distM >= last.dist_m) return last.elev_m;
  for (let i = 1; i < profile.length; i += 1) {
    const d1 = profile[i - 1].dist_m;
    const d2 = profile[i].dist_m;
    if (d1 <= distM && distM <= d2) {
      const e1 = profile[i - 1].elev_m;
      const span = d2 - d1;
      if (span <= 0) return e1;
      return e1 + ((distM - d1) / span) * (profile[i].elev_m - e1);
    }
  }
  return last.elev_m;
}

export function gradeBetween(profile, startM, endM) {
  const dist = endM - startM;
  if (dist <= 0) return 0;
  return (
    ((interpolateElev(profile, endM) - interpolateElev(profile, startM)) /
      dist) *
    100
  );
}

/** [lon, lat] at a distance along a [lon, lat] polyline. */
export function interpolatePointAtDist(coordinates, distM, cum = null) {
  if (coordinates.length === 0) return [0, 0];
  if (coordinates.length === 1) return [coordinates[0][0], coordinates[0][1]];
  const c = cum ?? cumulativeDistances(coordinates);
  const lastPoint = coordinates[coordinates.length - 1];
  if (distM <= 0) return [coordinates[0][0], coordinates[0][1]];
  if (distM >= c[c.length - 1]) return [lastPoint[0], lastPoint[1]];
  for (let i = 1; i < c.length; i += 1) {
    if (c[i] >= distM) {
      const segLen = c[i] - c[i - 1];
      const frac = segLen > 0 ? (distM - c[i - 1]) / segLen : 0;
      const [lon0, lat0] = coordinates[i - 1];
      const [lon1, lat1] = coordinates[i];
      return [lon0 + frac * (lon1 - lon0), lat0 + frac * (lat1 - lat0)];
    }
  }
  return [lastPoint[0], lastPoint[1]];
}

/** Split a base cut where |grade| crosses 6% at 150 m scan resolution. */
export function subdivideBaseSegment(profile, baseStart, baseEnd) {
  if (baseEnd - baseStart <= GRADE_SCAN_INTERVAL_M)
    return [[baseStart, baseEnd]];
  const scan = [baseStart];
  for (
    let d = baseStart + GRADE_SCAN_INTERVAL_M;
    d < baseEnd;
    d += GRADE_SCAN_INTERVAL_M
  )
    scan.push(d);
  if (scan[scan.length - 1] !== baseEnd) scan.push(baseEnd);
  const intervals = [];
  for (let i = 0; i < scan.length - 1; i += 1) {
    const g = gradeBetween(profile, scan[i], scan[i + 1]);
    intervals.push([
      scan[i],
      scan[i + 1],
      Math.abs(g) > GRADE_SPLIT_THRESHOLD_PCT,
    ]);
  }
  if (!intervals.some(([, , steep]) => steep)) return [[baseStart, baseEnd]];
  const merged = [];
  let segStart = intervals[0][0];
  let segSteep = intervals[0][2];
  for (const [s, , steep] of intervals) {
    if (steep !== segSteep && s > segStart) {
      merged.push([segStart, s]);
      segStart = s;
      segSteep = steep;
    }
  }
  merged.push([segStart, baseEnd]);
  return merged;
}

/**
 * Physics segments: 10-mile cuts, split on 6% grades. Each segment has
 * dist_m, grade_pct, start_m, end_m, mid_lon, mid_lat.
 */
export function buildSegments(distanceM, coordinates, profile, extraCuts = []) {
  if (distanceM <= 0) return [];
  const cuts = [0];
  for (let d = BASE_SEGMENT_M; d < distanceM; d += BASE_SEGMENT_M) cuts.push(d);
  cuts.push(distanceM);
  // Extra cuts (e.g. where the route leaves the port) split a base cut.
  for (const d of extraCuts)
    if (d > 1 && d < distanceM - 1 && !cuts.includes(d)) cuts.push(d);
  cuts.sort((a, b) => a - b);
  const raw = [];
  for (let i = 0; i < cuts.length - 1; i += 1)
    raw.push(...subdivideBaseSegment(profile, cuts[i], cuts[i + 1]));
  if (raw.length > MAX_PHYSICS_SEGMENTS)
    throw new Error(
      `Segment count ${raw.length} exceeds cap ${MAX_PHYSICS_SEGMENTS}`,
    );
  const cum = cumulativeDistances(coordinates);
  return raw.map(([startM, endM]) => {
    const [midLon, midLat] = interpolatePointAtDist(
      coordinates,
      (startM + endM) / 2,
      cum,
    );
    return {
      dist_m: Math.round((endM - startM) * 100) / 100,
      grade_pct:
        Math.round(gradeBetween(profile, startM, endM) * 10000) / 10000,
      start_m: Math.round(startM * 100) / 100,
      end_m: Math.round(endM * 100) / 100,
      mid_lon: Math.round(midLon * 1e6) / 1e6,
      mid_lat: Math.round(midLat * 1e6) / 1e6,
    };
  });
}

// ── Speeds ─────────────────────────────────────────────────────────────────

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Distance-weighted posted speed over a span; edges are {start_m, edge_length_m, speed_limit_mph}. */
export function postedSpeedForSegment(
  startM,
  endM,
  edgeSpeeds,
  defaultMph = DEFAULT_POSTED_MPH,
) {
  if (endM <= startM || edgeSpeeds.length === 0) return defaultMph;
  let total = 0;
  let weighted = 0;
  for (const edge of edgeSpeeds) {
    const overlap =
      Math.min(endM, edge.start_m + edge.edge_length_m) -
      Math.max(startM, edge.start_m);
    if (overlap <= 0) continue;
    total += overlap;
    weighted += overlap * edge.speed_limit_mph;
  }
  return total > 0 ? weighted / total : defaultMph;
}

/** Posted limits with FleetVolt's route-history overlay (D-08). */
export function resolveSpeeds(
  segments,
  edgeSpeeds = [],
  topSpeedMph = DEFAULT_TRUCK_TOP_SPEED_MPH,
) {
  const out = [];
  let realizedDist = 0;
  let realizedSum = 0;
  let postedDist = 0;
  let postedSum = 0;
  for (const seg of segments) {
    const posted = postedSpeedForSegment(seg.start_m, seg.end_m, edgeSpeeds);
    let overlay = OVERLAY_MAX;
    if (realizedDist > 0 && postedDist > 0) {
      const avgPosted = postedSum / postedDist;
      if (avgPosted > 0)
        overlay = clamp(
          realizedSum / realizedDist / avgPosted,
          OVERLAY_MIN,
          OVERLAY_MAX,
        );
    }
    const effective = Math.min(posted * overlay, topSpeedMph);
    out.push(effective);
    realizedDist += seg.dist_m;
    realizedSum += effective * seg.dist_m;
    postedDist += seg.dist_m;
    postedSum += posted * seg.dist_m;
  }
  return out;
}

/**
 * Speed edges from a route's average speed: one edge for the whole route,
 * so every segment runs at distance / duration (capped by the truck).
 */
export function edgeSpeedsFromRoute(distanceM, durationS) {
  if (!(distanceM > 0) || !(durationS > 0)) return [];
  return [
    {
      start_m: 0,
      edge_length_m: distanceM,
      speed_limit_mph: distanceM / durationS / MPS_PER_MPH,
    },
  ];
}

// ── Weather and port drayage ───────────────────────────────────────────────

export function airDensity(tempC = 20) {
  return RHO_SEA_LEVEL * (288.15 / (tempC + 273.15));
}

export function applyWeather(presetName = 'ideal') {
  const preset = WEATHER_PRESETS[presetName] ?? WEATHER_PRESETS.ideal;
  return {
    rho: airDensity(preset.temp_c),
    thermal_factor: preset.thermal_factor,
    aux_mult: preset.aux_mult,
    headwind_mph: preset.headwind_mph,
    temp_c: preset.temp_c,
  };
}

/** Ray-casting point-in-polygon for a [lon, lat] ring. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat) {
      const xCross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lon < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * Distances (m) along a [lon, lat] route where it enters or leaves a zone,
 * so the in-port stretch becomes its own segment and gets the port penalty.
 */
export function zoneCrossings(coordinates, zone) {
  const cum = cumulativeDistances(coordinates);
  const out = [];
  let inside = coordinates.length
    ? pointInRing(coordinates[0][0], coordinates[0][1], zone)
    : false;
  for (let i = 1; i < coordinates.length; i += 1) {
    const now = pointInRing(coordinates[i][0], coordinates[i][1], zone);
    if (now !== inside) out.push(Math.round((cum[i - 1] + cum[i]) / 2));
    inside = now;
  }
  return out;
}

/** Speed cap and stop-go aux bump on segments whose midpoint is in the zone. */
export function applyPortDrayage(segments, speedMph, auxKw, zone) {
  const speedOut = [...speedMph];
  const auxOut = [...auxKw];
  if (!zone) return { speedMph: speedOut, auxKw: auxOut };
  segments.forEach((seg, i) => {
    if (pointInRing(seg.mid_lon, seg.mid_lat, zone)) {
      speedOut[i] = Math.min(speedOut[i], PORT_SPEED_CAP_MPH);
      auxOut[i] = Math.max(auxOut[i], PORT_AUX_KW);
    }
  });
  return { speedMph: speedOut, auxKw: auxOut };
}

// ── Forces, state of charge, totals ────────────────────────────────────────

/** Traction and aux power (W) per segment (FleetVolt physicsEngine.ts). */
export function segmentForces(distM, gradePct, speedMph, truck, opts = {}) {
  const n = gradePct.length;
  const rho = opts.rho ?? airDensity(opts.tempC ?? 20);
  const headwind = opts.headwindMph ?? 0;
  const thermal = opts.thermalFactor ?? 1;
  const mass = massKg(truck);
  const pTraction = new Array(n);
  const auxW = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const theta = Math.atan(gradePct[i] / 100);
    const fRoll = truck.C_rr * mass * G * Math.cos(theta);
    const fGrade = mass * G * Math.sin(theta);
    const vEff = (speedMph[i] + headwind) * MPS_PER_MPH;
    const fAero =
      0.5 * rho * truck.drag_coefficient * truck.frontal_area_m2 * vEff ** 2;
    let p = (fRoll + fAero + fGrade) * speedMph[i] * MPS_PER_MPH;
    if (thermal > 0 && thermal !== 1 && p > 0) p /= thermal;
    pTraction[i] = p;
    const aux = Array.isArray(opts.auxKw)
      ? opts.auxKw[i]
      : (opts.auxKw ?? truck.aux_kw_base);
    auxW[i] = aux * 1000;
  }
  return { pTraction, auxW };
}

/** Sequential SoC integration with SoC-dependent regen (soc_integrator.py). */
export function integrateSoc(
  pTractionW,
  pAuxW,
  distM,
  speedMph,
  truck,
  initialSocPct = 100,
) {
  const n = distM.length;
  const socPct = new Array(n).fill(0);
  const energyKwh = new Array(n).fill(0);
  const regenKwh = new Array(n).fill(0);
  let soc = initialSocPct;
  const regenCapW = truck.regen_power_cap_kw * 1000;
  for (let i = 0; i < n; i += 1) {
    const v = speedMph[i] * MPS_PER_MPH;
    const dtS = v > 0 ? distM[i] / v : 0;
    let net = 0;
    let regen = 0;
    if (pTractionW[i] >= 0) {
      net =
        ((pTractionW[i] / truck.drivetrain_efficiency + pAuxW[i]) * dtS) /
        3_600_000;
    } else {
      const aux = (pAuxW[i] * dtS) / 3_600_000;
      if (soc <= truck.regen_soc_cutoff) {
        const regenW =
          Math.min(Math.abs(pTractionW[i]), regenCapW) * truck.regen_efficiency;
        regen = (regenW * dtS) / 3_600_000;
        net = aux - regen;
      } else {
        net = aux;
      }
    }
    soc -= (net / truck.usable_kwh) * 100;
    socPct[i] = soc;
    energyKwh[i] = net;
    regenKwh[i] = regen;
  }
  return { socPct, energyKwh, regenKwh };
}

export function aggregateKpis(energyKwh, regenKwh, distM, speedMph) {
  let totalKwh = 0;
  let regen = 0;
  let dist = 0;
  let time = 0;
  for (let i = 0; i < energyKwh.length; i += 1) {
    totalKwh += energyKwh[i];
    regen += regenKwh[i];
    dist += distM[i];
    const v = speedMph[i] * MPS_PER_MPH;
    time += v > 0 ? distM[i] / v : 0;
  }
  const miles = dist > 0 ? dist / US_MILE_M : 0;
  return {
    total_kwh: totalKwh,
    wh_per_mi: miles > 0 ? (totalKwh / miles) * 1000 : 0,
    regen_kwh: regen,
    total_time_s: time,
    distance_mi: miles,
  };
}

// ── Charging ───────────────────────────────────────────────────────────────

/** Dwell along a piecewise OEM charge curve (charge_curve.py). */
export function integrateChargeCurve(
  curve,
  arrivalSoc,
  targetSoc,
  stationKw,
  usableKwh,
) {
  if (targetSoc <= arrivalSoc)
    return { dwellS: 0, energyKwh: 0, departureSoc: arrivalSoc };
  const sorted = [...curve].sort((a, b) => a.soc_pct - b.soc_pct);
  const breaks = [...sorted.map((bp) => bp.soc_pct), 100];
  let dwellS = 0;
  let energyKwh = 0;
  let current = arrivalSoc;
  for (let i = 0; i < sorted.length; i += 1) {
    const lo = sorted[i].soc_pct;
    const hi = breaks[i + 1] ?? 100;
    if (current >= targetSoc) break;
    if (targetSoc <= lo || current >= hi) continue;
    const start = Math.max(current, lo);
    const end = Math.min(targetSoc, hi);
    if (end <= start) continue;
    const kwh = ((end - start) / 100) * usableKwh;
    const kw = Math.min(sorted[i].max_kw, stationKw);
    if (kw <= 0)
      throw new Error(`Non-positive charge power at SOC band ${lo}%`);
    dwellS += (kwh / kw) * 3600;
    energyKwh += kwh;
    current = end;
  }
  return {
    dwellS,
    energyKwh,
    departureSoc: arrivalSoc + (energyKwh / usableKwh) * 100,
  };
}

/** Raise SoC from `startIndex` on by the charged energy (D-16). */
export function injectSocFromIndex(socPct, startIndex, energyKwh, usableKwh) {
  const boost = (energyKwh / usableKwh) * 100;
  for (let i = startIndex; i < socPct.length; i += 1)
    socPct[i] = clamp(socPct[i] + boost, 0, 100);
}

export function socDeficitKwh(soc, truck, minArrivalPct) {
  const final = soc[soc.length - 1];
  return final >= minArrivalPct
    ? 0
    : ((minArrivalPct - final) / 100) * truck.usable_kwh;
}

/**
 * Detour time (s) to a charger and back to the route, estimated from
 * straight-line legs x DETOUR_ROAD_FACTOR at DETOUR_SPEED_MPH, minus the
 * direct leg. FleetVolt asked Google Directions instead.
 */
export function estimateDetourS(origin, charger, rejoin) {
  const leg = (a, b) =>
    haversineM(a.lat, a.lon, b.lat, b.lon) * DETOUR_ROAD_FACTOR;
  const extra =
    leg(origin, charger) + leg(charger, rejoin) - leg(origin, rejoin);
  return Math.max(0, extra) / (DETOUR_SPEED_MPH * MPS_PER_MPH);
}

/** Heavy-duty chargers within `radiusM` of a point, nearest first. */
export function chargersNear(
  chargers,
  lat,
  lon,
  radiusM,
  minKw = MIN_HD_POWER_KW,
) {
  return chargers
    .filter((c) => (c.power_kw ?? 0) >= minKw && c.hd_capable !== false)
    .map((c) => ({ ...c, distance_m: haversineM(lat, lon, c.lat, c.lon) }))
    .filter((c) => c.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m);
}

function chargeTarget(soc, arrivalSoc, conditions) {
  const target = conditions.target_soc_pct ?? 80;
  const minArrival = conditions.min_arrival_soc_pct ?? 10;
  const final = soc[soc.length - 1];
  if (final >= minArrival) return target;
  return Math.min(100, Math.max(target, arrivalSoc + (minArrival - final)));
}

/**
 * Greedy first-feasible charging stops (charging_planner.py, D-06): when SoC
 * crosses the trigger, take the in-radius heavy-duty charger with the
 * shortest detour (ties: highest power) and charge along the OEM curve.
 */
export function planGreedyStops({
  segments,
  socPct,
  coordinates,
  truck,
  chargeCurve,
  conditions = {},
  chargers = [],
  stationKw = 350,
}) {
  const trigger = conditions.soc_trigger_pct ?? 18;
  const floor = conditions.soc_floor_pct ?? 10;
  const minArrival = conditions.min_arrival_soc_pct ?? 10;
  const soc = [...socPct];
  const stops = [];
  const cum = cumulativeDistances(coordinates);
  const at = (distM) => {
    const [lon, lat] = interpolatePointAtDist(coordinates, distM, cum);
    return { lat, lon };
  };
  for (let i = 1; i < soc.length; i += 1) {
    if (soc[i] < floor)
      return {
        stops,
        soc,
        status: {
          complete: false,
          blocking_reason: 'cannot_reach_destination',
          soc_deficit_kwh: socDeficitKwh(soc, truck, minArrival),
          at_segment: i,
        },
      };
    if (!(soc[i - 1] > trigger && soc[i] <= trigger)) continue;
    const origin = at(segments[i]?.start_m ?? 0);
    const rejoin = at(segments[Math.min(i + 1, segments.length - 1)].start_m);
    let candidates = chargersNear(
      chargers,
      origin.lat,
      origin.lon,
      SEARCH_RADIUS_M,
    );
    if (candidates.length === 0)
      candidates = chargersNear(
        chargers,
        origin.lat,
        origin.lon,
        FALLBACK_RADIUS_M,
      );
    const feasible = candidates
      .map((candidate) => ({
        candidate,
        detourS: estimateDetourS(origin, candidate, rejoin),
      }))
      .filter((x) => x.detourS <= MAX_DETOUR_S)
      .sort(
        (a, b) =>
          a.detourS - b.detourS || b.candidate.power_kw - a.candidate.power_kw,
      );
    if (feasible.length === 0)
      return {
        stops,
        soc,
        status: {
          complete: false,
          blocking_reason: 'no_charger_in_radius',
          soc_deficit_kwh: socDeficitKwh(soc, truck, minArrival),
          at_segment: i,
        },
      };
    const { candidate, detourS } = feasible[0];
    const arrival = soc[i];
    const charge = integrateChargeCurve(
      chargeCurve,
      arrival,
      chargeTarget(soc, arrival, conditions),
      Math.min(stationKw, candidate.power_kw),
      truck.usable_kwh,
    );
    injectSocFromIndex(soc, i, charge.energyKwh, truck.usable_kwh);
    stops.push({
      station_id: candidate.station_id,
      name: candidate.name ?? null,
      lat: candidate.lat,
      lon: candidate.lon,
      power_kw: candidate.power_kw,
      segment_index: i,
      arrival_soc_pct: Math.round(arrival * 100) / 100,
      departure_soc_pct: Math.round(charge.departureSoc * 100) / 100,
      dwell_s: Math.round(charge.dwellS * 10) / 10,
      energy_added_kwh: Math.round(charge.energyKwh * 10000) / 10000,
      detour_s: Math.round(detourS * 10) / 10,
    });
  }
  return { stops, soc, status: { complete: true } };
}

/**
 * Feasibility verdict (feasibility.py): feasible, critical (arrives under
 * the floor but above 5%, or one short stop) or infeasible; tier says what
 * charging the trip needs: public heavy-duty chargers, a depot charge at the
 * origin, or chargers that do not exist yet.
 */
export function classifyFeasibility(stops, finalSocPct, conditions, outcome) {
  const tier = outcome.public_complete
    ? 'public_hd'
    : outcome.shadow_depot_complete
      ? 'depot_required'
      : 'infrastructure_gap';
  if (!outcome.public_complete && outcome.shadow_depot_complete !== true)
    return {
      verdict: 'infeasible',
      tier,
      soc_deficit_kwh: outcome.soc_deficit_kwh ?? null,
      blocking_reason: outcome.blocking_reason ?? null,
      stop_count: stops.length,
    };
  const minArrival = conditions.min_arrival_soc_pct ?? 10;
  const critical =
    (CRITICAL_SOC_FLOOR_PCT <= finalSocPct && finalSocPct < minArrival) ||
    (stops.length === 1 && stops[0].dwell_s < MIN_DWELL_BUFFER_S);
  return {
    verdict: critical ? 'critical' : 'feasible',
    tier,
    stop_count: stops.length,
  };
}

// ── The whole trip ─────────────────────────────────────────────────────────

/**
 * Simulate one truck trip.
 *
 * @param {object} args
 * @param {object} args.physics catalog truck physics (see truckParams)
 * @param {Array<{soc_pct:number,max_kw:number}>} [args.chargeCurve]
 * @param {number[][]} args.coordinates route as [lon, lat]
 * @param {Array<{dist_m:number,elev_m:number}>} args.profile elevation profile
 * @param {number} [args.distanceM] route length; defaults to the polyline's
 * @param {Array} [args.edgeSpeeds] posted speeds; see edgeSpeedsFromRoute
 * @param {object} [args.conditions] { weather_preset, payload_lbs,
 *   initial_soc_pct, charging: { soc_trigger_pct, soc_floor_pct,
 *   target_soc_pct, min_arrival_soc_pct } }
 * @param {number[][]|null} [args.drayageZone] [lon, lat] ring, or null
 * @param {Array} [args.chargers] { station_id, name, lat, lon, power_kw }
 * @param {boolean} [args.includeCharging]
 */
export function simulateTrip({
  physics,
  chargeCurve = physics?.charge_curve ?? [],
  coordinates,
  profile,
  distanceM = null,
  edgeSpeeds = [],
  conditions = {},
  drayageZone = POH_DRAYAGE_ZONE,
  chargers = [],
  includeCharging = true,
}) {
  const truck = truckParams(physics, {
    payloadLbs: conditions.payload_lbs ?? 0,
  });
  const length = distanceM ?? cumulativeDistances(coordinates).at(-1) ?? 0;
  if (length > MAX_ROUTE_M)
    throw new Error(
      `Route of ${Math.round(length / US_MILE_M)} mi is over the ${MAX_ROUTE_MI} mi cap`,
    );
  const weather = applyWeather(conditions.weather_preset);
  const raw = buildSegments(
    length,
    coordinates,
    profile,
    drayageZone ? zoneCrossings(coordinates, drayageZone) : [],
  );
  const speeds = resolveSpeeds(raw, edgeSpeeds);
  const distM = raw.map((s) => s.dist_m);
  const grade = raw.map((s) => s.grade_pct);
  const port = applyPortDrayage(
    raw,
    speeds,
    raw.map(() => truck.aux_kw_base * weather.aux_mult),
    drayageZone,
  );
  const { pTraction, auxW } = segmentForces(
    distM,
    grade,
    port.speedMph,
    truck,
    {
      rho: weather.rho,
      headwindMph: weather.headwind_mph,
      thermalFactor: weather.thermal_factor,
      auxKw: port.auxKw,
    },
  );
  const soc = integrateSoc(
    pTraction,
    auxW,
    distM,
    port.speedMph,
    truck,
    conditions.initial_soc_pct ?? 100,
  );
  const kpis = aggregateKpis(soc.energyKwh, soc.regenKwh, distM, port.speedMph);

  let socOut = soc.socPct;
  let stops = [];
  let feasibility = null;
  if (includeCharging && raw.length > 0) {
    const charging = conditions.charging ?? {};
    const planArgs = {
      segments: raw,
      coordinates,
      truck,
      chargeCurve,
      conditions: charging,
      chargers,
    };
    const plan = planGreedyStops({ ...planArgs, socPct: soc.socPct });
    stops = plan.stops;
    let shadow = null;
    if (!plan.status.complete) {
      // Shadow pass: full depot charge at the origin, then public chargers.
      const topped = [...soc.socPct];
      injectSocFromIndex(
        topped,
        0,
        ((100 - (conditions.initial_soc_pct ?? 100)) / 100) * truck.usable_kwh,
        truck.usable_kwh,
      );
      shadow = planGreedyStops({ ...planArgs, socPct: topped }).status.complete;
    }
    socOut = plan.soc;
    feasibility = classifyFeasibility(
      stops,
      socOut[socOut.length - 1],
      charging,
      plan.status.complete
        ? { public_complete: true }
        : {
            public_complete: false,
            shadow_depot_complete: shadow,
            blocking_reason: plan.status.blocking_reason ?? null,
            soc_deficit_kwh: plan.status.soc_deficit_kwh ?? null,
          },
    );
  }
  const stopBySegment = new Map(stops.map((s, k) => [s.segment_index, k + 1]));
  const segments = raw.map((seg, i) => ({
    start_m: seg.start_m,
    end_m: seg.end_m,
    dist_m: seg.dist_m,
    mid_lon: seg.mid_lon,
    mid_lat: seg.mid_lat,
    grade: seg.grade_pct,
    speed: Math.round(port.speedMph[i] * 100) / 100,
    energy_kwh: Math.round(soc.energyKwh[i] * 10000) / 10000,
    soc_pct: Math.round(socOut[i] * 100) / 100,
    charging_event: stopBySegment.has(i),
    stop_sequence: stopBySegment.get(i) ?? null,
  }));
  return {
    segments,
    kpis,
    charging_stops: stops,
    feasibility,
    final_soc_pct: segments.length
      ? segments[segments.length - 1].soc_pct
      : 100,
    disclaimer: DISCLAIMER,
    conditions: {
      weather_preset: conditions.weather_preset ?? 'ideal',
      payload_lbs: truck.payload_lbs,
      port_drayage: Boolean(drayageZone),
    },
  };
}
