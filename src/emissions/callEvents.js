// Rebuild the timeline of one ship call from AIS tracks: when the pilot
// boarded, when the first tug made fast, when the ship was all fast at its
// berth, when it let go, and when the last tug and the pilot left it.
//
// No feed reports these events; they are inferred from where the ship, the
// tugs and the pilot boat were relative to each other. Every milestone carries
// how it was found ('observed' from craft contact, or 'assumed' from a
// geofence fallback) so the UI can show which numbers are measured.
//
// Port of Hueneme needs no pilot (confirmed with port staff, 2026-11-10), so
// pilot milestones stay empty there: they are filled only when a pilot boat
// is actually seen on AIS, never inferred from a tug.
//
// Records are { mmsi, t (ms), lon, lat, sog (kn) }, as from
// parseMarineCadastreRow in aisCalls.js.

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const M_PER_DEG_LAT = 111_320;

/** AIS ship-type codes for harbor craft (ITU-R M.1371 Table 53). */
export const CRAFT_AIS_TYPES = Object.freeze({
  31: 'tug', // towing
  32: 'tug', // towing, long or wide tow
  52: 'tug',
  50: 'pilot',
});

/** Role of a vessel from its AIS type or name, or null for other vessels. */
export function craftRoleFor({ aisVesselType, name } = {}) {
  const byType = CRAFT_AIS_TYPES[aisVesselType];
  if (byType) return byType;
  const n = String(name ?? '').toUpperCase();
  if (/\bPILOT\b/.test(n)) return 'pilot';
  return null;
}

/** Flat-earth distance in metres, good to well under 1% at harbor scale. */
export function distanceM(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * M_PER_DEG_LAT;
  const dLon =
    (lon2 - lon1) *
    M_PER_DEG_LAT *
    Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Position of a sorted track at time t, linearly interpolated between the two
 * fixes around it. Null if t is outside the track or the gap is too long.
 */
export function positionAt(track, t, { maxGapMs = 10 * MIN_MS } = {}) {
  if (!track.length || t < track[0].t || t > track.at(-1).t) return null;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  if (a.t === t) return a;
  if (b.t === t) return b;
  if (b.t - a.t > maxGapMs) return null;
  const f = (t - a.t) / (b.t - a.t);
  return {
    t,
    lon: a.lon + (b.lon - a.lon) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    sog: a.sog ?? b.sog ?? null,
  };
}

/**
 * Copy of a sorted track with missing speeds filled from position change.
 * Some transponders send no speed (AIS 102.3, parsed as null); still/moving
 * tests need one. Uses the fixes either side, at least `minSpanMs` apart.
 */
export function fillSpeeds(track, { minSpanMs = 50_000 } = {}) {
  return track.map((r, i) => {
    if (r.sog !== null && r.sog !== undefined) return r;
    let a = i;
    let b = i;
    while (a > 0 && track[i].t - track[a].t < minSpanMs / 2) a--;
    while (b < track.length - 1 && track[b].t - track[i].t < minSpanMs / 2) b++;
    const dt = (track[b].t - track[a].t) / HOUR_MS;
    if (!(dt > 0) || dt > 0.25) return { ...r, sog: null };
    const nm =
      distanceM(track[a].lon, track[a].lat, track[b].lon, track[b].lat) / 1852;
    return { ...r, sog: nm / dt, sogDerived: true };
  });
}

/**
 * Time windows when a craft was alongside a ship: within `maxDistanceM` for at
 * least `minMinutes`, with gaps up to `mergeGapMinutes` bridged. Distances are
 * taken at every fix of either vessel.
 */
export function contactWindows(
  shipTrack,
  craftTrack,
  {
    maxDistanceM = 150,
    minMinutes = 3,
    mergeGapMinutes = 5,
    shipMovingKn = 0.5,
    craftMovingKn = 1,
  } = {},
) {
  if (!shipTrack.length || !craftTrack.length) return [];
  const start = Math.max(shipTrack[0].t, craftTrack[0].t);
  const end = Math.min(shipTrack.at(-1).t, craftTrack.at(-1).t);
  if (!(end > start)) return [];
  const times = [
    ...new Set(
      [...shipTrack, ...craftTrack]
        .map((r) => r.t)
        .filter((t) => t >= start && t <= end),
    ),
  ].sort((a, b) => a - b);
  const hits = [];
  for (const t of times) {
    const s = positionAt(shipTrack, t);
    const c = positionAt(craftTrack, t);
    if (!s || !c) continue;
    // Two vessels moored side by side are not working together: at least one
    // of them has to be under way. Unknown speed counts as under way.
    const shipStill = s.sog !== null && s.sog <= shipMovingKn;
    const craftStill = c.sog !== null && c.sog <= craftMovingKn;
    if (shipStill && craftStill) continue;
    if (distanceM(s.lon, s.lat, c.lon, c.lat) <= maxDistanceM) hits.push(t);
  }
  const windows = [];
  for (const t of hits) {
    const last = windows.at(-1);
    if (last && t - last.endMs <= mergeGapMinutes * MIN_MS) last.endMs = t;
    else windows.push({ startMs: t, endMs: t });
  }
  return windows.filter((w) => w.endMs - w.startMs >= minMinutes * MIN_MS);
}

/**
 * The berth stay inside one call. Still runs are fixes in the berth zone at or
 * below `maxSpeedKn` lasting at least `minMinutes`. allFast is the start of the
 * first run and letGo the end of the last; more than one run means the ship
 * shifted along the quay. The berth point is the middle of the longest run.
 */
export function berthStay(
  records,
  { maxSpeedKn = 0.5, minMinutes = 20, maxGapMs = 6 * HOUR_MS } = {},
) {
  const runs = [];
  let run = null;
  const close = () => {
    if (run && run.at(-1).t - run[0].t >= minMinutes * MIN_MS) runs.push(run);
    run = null;
  };
  for (const r of records) {
    const still = r.zone === 'berth' && r.sog !== null && r.sog <= maxSpeedKn;
    if (!still) {
      close();
      continue;
    }
    if (run && r.t - run.at(-1).t > maxGapMs) close();
    (run ??= []).push(r);
  }
  close();
  if (!runs.length) return null;
  const longest = runs.reduce((a, b) =>
    b.at(-1).t - b[0].t > a.at(-1).t - a[0].t ? b : a,
  );
  const mid = longest[longest.length >> 1];
  return {
    allFastMs: runs[0][0].t,
    letGoMs: runs.at(-1).at(-1).t,
    shifts: runs.length - 1,
    lon: mid.lon,
    lat: mid.lat,
  };
}

/** Metres from a point to the segment [[lon, lat], [lon, lat]]. */
export function distanceToSegmentM(lon, lat, [[lon1, lat1], [lon2, lat2]]) {
  // Local flat frame in metres around the point.
  const k = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const ax = (lon1 - lon) * k;
  const ay = (lat1 - lat) * M_PER_DEG_LAT;
  const bx = (lon2 - lon) * k;
  const by = (lat2 - lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const f = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + f * dx, ay + f * dy);
}

/**
 * Nearest berth to a point, from [{ id, lon, lat, segment?, approximate? }],
 * within `maxM`. A berth with a `segment` (its stretch of wharf face) is
 * measured to that line, since a ship lies along the wharf, not at one point.
 * Returns { id, distanceM, approximate } or null.
 */
export function nearestBerth(lon, lat, berthPoints = [], { maxM = 100 } = {}) {
  let best = null;
  for (const b of berthPoints) {
    const d = b.segment
      ? distanceToSegmentM(lon, lat, b.segment)
      : distanceM(lon, lat, b.lon, b.lat);
    if (d <= maxM && (!best || d < best.distanceM))
      best = {
        id: b.id,
        distanceM: Math.round(d),
        approximate: !!b.approximate,
      };
  }
  return best;
}

/**
 * Widen a contact window to the craft's whole job: back to when it last sat
 * still before the contact, and on to when it next sat still after, each at
 * most `maxLegMs` away. Craft emit on the run out and back, not only alongside.
 */
export function craftJobWindow(
  craftTrack,
  { startMs, endMs },
  { stillKn = 0.5, maxLegMs = 2 * HOUR_MS } = {},
) {
  let jobStart = startMs;
  for (let i = craftTrack.length - 1; i >= 0; i--) {
    const r = craftTrack[i];
    if (r.t >= startMs) continue;
    if (startMs - r.t > maxLegMs) break;
    jobStart = r.t;
    if (r.sog !== null && r.sog <= stillKn) break;
  }
  let jobEnd = endMs;
  for (const r of craftTrack) {
    if (r.t <= endMs) continue;
    if (r.t - endMs > maxLegMs) break;
    jobEnd = r.t;
    if (r.sog !== null && r.sog <= stillKn) break;
  }
  return { jobStartMs: jobStart, jobEndMs: jobEnd };
}

const hours = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / HOUR_MS : null;

/**
 * Rebuild one port call.
 *
 * call: a 'port-call' from splitCalls (records carry `zone`).
 * craft: [{ mmsi, name, role: 'tug'|'pilot', records }] seen in the same days.
 * Options: berthPoints for berth ids, shipLengthM to size the contact radius.
 */
export function reconstructCall(
  call,
  craft = [],
  {
    berthPoints = [],
    shipLengthM = null,
    dataStartMs = null,
    dataEndMs = null,
  } = {},
) {
  const flags = [];
  const ship = fillSpeeds(call.records);
  const stay = berthStay(ship);
  if (!stay)
    flags.push('no berth stay found: ship never sat still in the berth zone');
  if (stay?.shifts)
    flags.push(`shifted along the quay ${stay.shifts} time(s) while alongside`);
  const EDGE_MS = HOUR_MS;
  if (Number.isFinite(dataStartMs) && call.startMs - dataStartMs < EDGE_MS)
    flags.push('call starts at the edge of the data; arrival may be cut off');
  if (Number.isFinite(dataEndMs) && dataEndMs - call.endMs < EDGE_MS)
    flags.push('call ends at the edge of the data; departure may be cut off');
  const berth = stay ? nearestBerth(stay.lon, stay.lat, berthPoints) : null;
  if (stay && !berth) flags.push('berth not matched to a known berth point');

  // A ship's AIS antenna sits on the bridge, up to most of a hull length from
  // the bow, so a tug on the bow line can be well over 100 m away.
  const tugRadius = Math.max(150, (shipLengthM ?? 0) * 0.6 + 40);
  const pilotRadius = Math.max(120, (shipLengthM ?? 0) * 0.5 + 40);

  const jobs = [];
  for (const c of craft) {
    if (c.mmsi === call.mmsi || !c.records?.length) continue;
    const isPilot = c.role === 'pilot';
    const craftTrack = fillSpeeds(c.records);
    const windows = contactWindows(ship, craftTrack, {
      maxDistanceM: isPilot ? pilotRadius : tugRadius,
      minMinutes: isPilot ? 1 : 4,
      mergeGapMinutes: isPilot ? 3 : 8,
    });
    for (const w of windows) {
      // A craft moored next to the ship's berth is not working it.
      if (
        stay &&
        w.startMs >= stay.allFastMs + 30 * MIN_MS &&
        w.endMs <= stay.letGoMs - 30 * MIN_MS
      )
        continue;
      const leg =
        stay && w.startMs >= stay.allFastMs + 30 * MIN_MS
          ? 'outbound'
          : 'inbound';
      const shipAtStart = positionAt(ship, w.startMs);
      const shipAtEnd = positionAt(ship, w.endMs);
      const zoneNear = (p) =>
        p
          ? ship.reduce((a, b) =>
              Math.abs(b.t - p.t) < Math.abs(a.t - p.t) ? b : a,
            ).zone
          : null;
      jobs.push({
        mmsi: c.mmsi,
        // Where the ship was when contact began and ended: 'approach' means
        // outside the breakwater, where pilots board and leave.
        shipZoneAtStart: zoneNear(shipAtStart),
        shipZoneAtEnd: zoneNear(shipAtEnd),
        name: c.name ?? null,
        role: c.role,
        leg,
        contactStartMs: w.startMs,
        contactEndMs: w.endMs,
        contactHours: hours(w.startMs, w.endMs),
        ...craftJobWindow(craftTrack, w),
      });
    }
  }
  for (const j of jobs) j.jobHours = hours(j.jobStartMs, j.jobEndMs);
  jobs.sort((a, b) => a.contactStartMs - b.contactStartMs);

  const pick = (leg, role, fn) => {
    const xs = jobs.filter((j) => j.leg === leg && j.role === role);
    return xs.length ? fn(xs) : null;
  };
  const firstStart = (xs) => Math.min(...xs.map((j) => j.contactStartMs));
  const lastEnd = (xs) => Math.max(...xs.map((j) => j.contactEndMs));

  // Pilot transfers are a few minutes alongside; take the midpoint.
  const transfer = (xs, which) => {
    const j = which === 'first' ? xs[0] : xs.at(-1);
    return Math.round((j.contactStartMs + j.contactEndMs) / 2);
  };
  const harborFixes = ship.filter(
    (r) => r.zone === 'harbor' || r.zone === 'berth',
  );

  const milestones = {
    pilotOnMs: pick('inbound', 'pilot', (xs) => transfer(xs, 'first')),
    tugFirstFastMs: pick('inbound', 'tug', firstStart),
    tugInboundReleaseMs: pick('inbound', 'tug', lastEnd),
    allFastMs: stay?.allFastMs ?? null,
    letGoMs: stay?.letGoMs ?? null,
    tugOutboundFastMs: pick('outbound', 'tug', firstStart),
    tugLastReleaseMs: pick('outbound', 'tug', lastEnd),
    pilotOffMs: pick('outbound', 'pilot', (xs) => transfer(xs, 'last')),
  };
  const sources = {};
  for (const [k, v] of Object.entries(milestones))
    sources[k] =
      v === null
        ? null
        : k === 'allFastMs' || k === 'letGoMs'
          ? 'berth-stay'
          : 'observed';
  // Window start: first of pilot on / first tug fast. Fall back to entering
  // the harbor zone, flagged, when no craft was seen.
  const inboundCandidates = [
    milestones.pilotOnMs,
    milestones.tugFirstFastMs,
  ].filter(Number.isFinite);
  let inboundStartMs = inboundCandidates.length
    ? Math.min(...inboundCandidates)
    : null;
  if (inboundStartMs === null && harborFixes.length) {
    inboundStartMs = harborFixes[0].t;
    sources.inboundStartMs = 'assumed: entered harbor zone';
    flags.push(
      'no tug or pilot contact inbound; window starts at harbor entry',
    );
  }
  const outboundCandidates = [
    milestones.pilotOffMs,
    milestones.tugLastReleaseMs,
  ].filter(Number.isFinite);
  let outboundEndMs = outboundCandidates.length
    ? Math.max(...outboundCandidates)
    : null;
  if (outboundEndMs === null && harborFixes.length) {
    outboundEndMs = harborFixes.at(-1).t;
    sources.outboundEndMs = 'assumed: left harbor zone';
    flags.push('no tug or pilot contact outbound; window ends at harbor exit');
  }

  return {
    mmsi: call.mmsi,
    berthId: berth?.id ?? null,
    berthMatch: berth,
    milestones,
    sources,
    window: { startMs: inboundStartMs, endMs: outboundEndMs },
    phases: {
      inbound: {
        startMs: inboundStartMs,
        endMs: milestones.allFastMs,
        hours: hours(inboundStartMs, milestones.allFastMs),
      },
      atBerth: {
        startMs: milestones.allFastMs,
        endMs: milestones.letGoMs,
        hours: hours(milestones.allFastMs, milestones.letGoMs),
      },
      outbound: {
        startMs: milestones.letGoMs,
        endMs: outboundEndMs,
        hours: hours(milestones.letGoMs, outboundEndMs),
      },
    },
    craftJobs: jobs,
    flags,
  };
}
