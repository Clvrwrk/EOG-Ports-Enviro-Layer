/**
 * Where the twin draws Hueneme's reefer berths and their equipment.
 *
 * Points marked `surveyed` were placed by port staff on Google Maps
 * (Chris, 2026-11-09). Everything else is laid out in metres around them:
 * the cranes' working spots on the apron, the UTR drive loop, and the rows
 * inside each parking queue. `{ east, north }` offsets are metres from
 * `origin` (berth 1); heights are metres above the ground or water.
 *
 * Pure: no Cesium.
 */

const M_PER_DEG_LAT = 111_320;

/** Surveyed points, [lat, lon] as copied from Google Maps. */
export const SURVEYED = Object.freeze({
  berth1: [34.147893, -119.206976],
  berth2: [34.14785, -119.204461],
  crane1Storage: [34.147132, -119.206956],
  crane2: [34.147589, -119.206595],
  crane3Storage: [34.147176, -119.205893],
  crane4Storage: [34.14717, -119.205715],
  // Tug 1 berth and Del Monte building 1 shared one link; the building
  // itself is from its plus code 4QWW+WJ.
  tug1Berth: [34.147757, -119.203017],
  delMonteBuilding1: [34.1473125, -119.2034375],
  eutrChargers: [34.146535, -119.20739],
  dieselQueueBerth1: [34.146904, -119.207153],
  dieselQueueShared: [34.146893, -119.205775],
  reachStackerParking: [34.146913, -119.206134],
  yaraTerminal: [34.146052, -119.207876],
});

const ORIGIN = Object.freeze({
  lat: SURVEYED.berth1[0],
  lon: SURVEYED.berth1[1],
});

/** { east, north } metres from `origin` for a [lat, lon] point. */
export function lonLatToOffset(origin, [lat, lon]) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    east: (lon - origin.lon) * mPerDegLon,
    north: (lat - origin.lat) * M_PER_DEG_LAT,
  };
}

/** [lon, lat] for an offset in metres from the layout origin. */
export function offsetToLonLat(origin, { east = 0, north = 0 }) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return [origin.lon + east / mPerDegLon, origin.lat + north / M_PER_DEG_LAT];
}

const at = (key) => Object.freeze(lonLatToOffset(ORIGIN, SURVEYED[key]));

const BERTH1 = at('berth1');
const BERTH2 = at('berth2');
// Crane 2's surveyed spot is a working position on the apron; its distance
// south of berth 1 sets the apron line for every crane at work.
const APRON_NORTH = at('crane2').north;

export const TWIN_LAYOUT = Object.freeze({
  berthLabel: 'Reefer berths 1 and 2 (South Terminal)',
  approximate: false,
  origin: ORIGIN,
  // Ship drawn at its berth point, bow east.
  ship: Object.freeze({ length: 150, beam: 24, height: 12 }),
  berths: Object.freeze({
    'berth-1': BERTH1,
    'berth-2': BERTH2,
  }),
  // berth-3 has no surveyed point yet; its calls draw at berth 2.
  berthFallback: 'berth-2',
  // Cranes 1-2 serve berth 1, cranes 3-4 berth 2. Each has a storage spot;
  // working cranes move to the apron beside the ship.
  cranes: Object.freeze([
    { label: 'Crane 1', home: 'berth-1', park: at('crane1Storage') },
    { label: 'Crane 2', home: 'berth-1', park: at('crane2') },
    { label: 'Crane 3', home: 'berth-2', park: at('crane3Storage') },
    { label: 'Crane 4', home: 'berth-2', park: at('crane4Storage') },
  ]),
  apronNorth: APRON_NORTH,
  // Working spots along the apron, metres east of the ship's berth point.
  craneWorkEast: Object.freeze([-30, 0, 30, 60]),
  // UTRs drive a loop from the apron beside the ship down to the yard.
  utrLoop: Object.freeze({
    halfWidth: 55,
    northTop: APRON_NORTH - 8,
    depth: 70,
  }),
  chargers: Object.freeze({ at: at('eutrChargers'), installed: 2, spacing: 4 }),
  dieselQueues: Object.freeze([
    {
      label: 'Diesel UTR queue, berth 1',
      at: at('dieselQueueBerth1'),
      slots: 8,
      perRow: 8,
    },
    {
      label: 'Diesel UTR queue, berths 1 and 2',
      at: at('dieselQueueShared'),
      slots: 16,
      perRow: 8,
    },
  ]),
  reachStackers: Object.freeze({ at: at('reachStackerParking'), spacing: 8 }),
  landmarks: Object.freeze([
    {
      label: 'Del Monte Fresh Produce, building 1',
      at: at('delMonteBuilding1'),
    },
    { label: 'POH tug 1 berth', at: at('tug1Berth') },
    { label: 'eUTR charge ports 1 and 2', at: at('eutrChargers') },
    { label: 'Reach stacker parking', at: at('reachStackerParking') },
    { label: 'YARA liquid fertilizer terminal', at: at('yaraTerminal') },
  ]),
  // Optional glTF model per machine type: { uri, scale?, tint?,
  // minimumPixelSize? }, keyed ship, crane, utr, reachStacker or charger.
  // Files follow public/models/README.md (metres, +Y up, front toward -X,
  // origin at the base). A type with no entry draws as boxes.
  models: Object.freeze({}),
  // Street-level viewpoint for "walk to the berth": south of the yard,
  // looking north-east over the queues to berth 1.
  camera: Object.freeze({
    east: 60,
    north: -420,
    height: 190,
    headingDeg: 5,
    pitchDeg: -28,
  }),
});

/** Offset of a berth's ship point; unknown berths use the fallback. */
export function berthPoint(layout, berthId) {
  return layout.berths[berthId] ?? layout.berths[layout.berthFallback];
}

/** The closed UTR loop for a ship at `berth`, as {east, north} corners. */
export function utrLoopFor(layout, berth) {
  const { halfWidth, northTop, depth } = layout.utrLoop;
  return [
    { east: berth.east - halfWidth, north: northTop },
    { east: berth.east + halfWidth, north: northTop },
    { east: berth.east + halfWidth, north: northTop - depth },
    { east: berth.east - halfWidth, north: northTop - depth },
  ];
}

/** Slot `index` in a parking row starting at `start`, `perRow` wide. */
export function rowSlot(
  start,
  index,
  { spacing = 3.5, perRow = 8, rowGap = 9 } = {},
) {
  return {
    east: start.east + (index % perRow) * spacing,
    north: start.north - Math.floor(index / perRow) * rowGap,
  };
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
