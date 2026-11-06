// Pure presentation model for the port emissions layer: what to draw and
// what to say, from a port profile and an activity summary. No Cesium.

const round = (value, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** "400-800" for a range, or one number when both ends match. */
export function formatRange([low, high], digits = 0) {
  const a = round(low, digits);
  const b = round(high, digits);
  return a === b ? `${a}` : `${a}-${b}`;
}

/** Closed [lon, lat] rings the layer outlines, with their role. */
export function geofenceShapes(profile) {
  const g = profile.geofences;
  return [
    { id: 'harbor', role: 'harbor', ring: g.harbor },
    ...g.berths.map((ring, i) => ({ id: `berth-${i}`, role: 'berth', ring })),
    ...g.anchorages.map((ring, i) => ({
      id: `anchorage-${i}`,
      role: 'anchorage',
      ring,
    })),
  ];
}

/** Headline lines for the port label. */
export function portHeadline(profile, summary) {
  const lines = [profile.name.toUpperCase()];
  if (!summary) {
    lines.push('Waiting for live AIS vessels');
    return lines;
  }
  const at = summary.byMode.hotelling ?? 0;
  const moving =
    (summary.byMode.maneuvering ?? 0) + (summary.byMode.transit ?? 0);
  lines.push(`${at} at berth · ${moving} under way in the inventory area`);
  if (at)
    lines.push(
      `At-berth auxiliary load ${formatRange(summary.atBerthAuxKwNow)} kW (modeled)`,
    );
  if (summary.hotellingHours > 0)
    lines.push(
      `Since opened: ${round(summary.hotellingHours, 1)} berth-hours, NOx ${formatRange(summary.tonnes.nox, 3)} t, CO2 ${formatRange(summary.tonnes.co2, 1)} t`,
    );
  return lines;
}

/** One label per vessel at berth, saying what is modeled. */
export function vesselLabel(vessel) {
  if (vessel.mode !== 'hotelling') return null;
  const load = vessel.auxKw ? `${formatRange(vessel.auxKw)} kW aux` : 'no type';
  return `${vessel.name} · ${load}${vessel.known ? '' : ' (range)'}`;
}

/** Layer stats in the shape the layer panel reads. */
export function portStats(profile, summary, enabled) {
  if (!enabled)
    return { count: 0, status: 'idle', source: 'EPA method + live AIS' };
  return {
    count: summary?.vessels.length ?? 0,
    status: summary ? 'nominal' : 'degraded',
    source: 'EPA method + live AIS',
    coverage: summary
      ? `${profile.name} · ${summary.byMode.hotelling ?? 0} at berth`
      : `${profile.name} · needs Live Vessels`,
  };
}
