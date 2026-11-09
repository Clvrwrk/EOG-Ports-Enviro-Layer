/**
 * Where the twin draws Hueneme's reefer berth and its equipment.
 *
 * APPROXIMATE. No public source gives berth, crane-park or charger
 * positions, so this first slice anchors the berth on the straight south
 * wharf face of the berth geofence (lat 34.14768, from the OpenStreetMap
 * coastline in src/emissions/ports.js) and lays the equipment out in local
 * metres from there. Port staff should correct `origin` and the offsets.
 *
 * Offsets are { east, north } metres from `origin`; heights are metres above
 * the ground or water. Pure: no Cesium.
 */

const M_PER_DEG_LAT = 111_320;

export const TWIN_LAYOUT = Object.freeze({
  berthLabel: 'Reefer berth (South Terminal, berths 1-3)',
  approximate: true,
  // Midpoint of the berth's wharf face; the basin (water) is to the north.
  origin: Object.freeze({ lon: -119.2058, lat: 34.14768 }),
  ship: Object.freeze({
    east: 0,
    north: 16,
    length: 150,
    beam: 24,
    height: 12,
  }),
  // Mobile harbor cranes park along the apron, booms out over the ship.
  cranes: Object.freeze(
    [-54, -18, 18, 54].map((east) => ({ east, north: -12 })),
  ),
  // UTRs shuttle on a loop between the apron and the reefer yard.
  utrLoop: Object.freeze([
    { east: -70, north: -24 },
    { east: 70, north: -24 },
    { east: 70, north: -110 },
    { east: -70, north: -110 },
  ]),
  // Charger row along the yard's south edge; idle UTRs park behind it.
  chargerRow: Object.freeze({ east: -66, north: -128, spacing: 5 }),
  parkingRow: Object.freeze({ east: -66, north: -146, spacing: 5 }),
  shorePowerVault: Object.freeze({ east: -40, north: -4 }),
  // Street-level viewpoint for "walk to the berth".
  camera: Object.freeze({
    east: 40,
    north: -190,
    height: 45,
    headingDeg: 340,
    pitchDeg: -18,
  }),
});

/** [lon, lat] for an offset in metres from the layout origin. */
export function offsetToLonLat(origin, { east = 0, north = 0 }) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return [origin.lon + east / mPerDegLon, origin.lat + north / M_PER_DEG_LAT];
}

/** Total length of a closed loop of {east, north} points, in metres. */
export function loopLength(points) {
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.east - a.east, b.north - a.north);
  }
  return total;
}

/**
 * Position and compass bearing at a fraction (0-1) of the way round a closed
 * loop. Bearing is degrees clockwise from north.
 */
export function pointOnLoop(points, fraction) {
  const total = loopLength(points);
  let distance = (((fraction % 1) + 1) % 1) * total;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const leg = Math.hypot(b.east - a.east, b.north - a.north);
    if (distance <= leg || i === points.length - 1) {
      const t = leg ? Math.min(1, distance / leg) : 0;
      const bearing =
        ((Math.atan2(b.east - a.east, b.north - a.north) * 180) / Math.PI +
          360) %
        360;
      return {
        east: a.east + (b.east - a.east) * t,
        north: a.north + (b.north - a.north) * t,
        bearing,
      };
    }
    distance -= leg;
  }
  return { ...points[0], bearing: 0 };
}
