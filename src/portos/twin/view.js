/**
 * Cesium entities for the twin: the reefer ship, four mobile harbor cranes,
 * the UTR fleet on its apron-yard loop, the charger row and the shore-power
 * vault. Colours show what each machine is doing at the current step.
 *
 * Shapes are simple boxes placed relative to the ground, so they sit on
 * Google's photorealistic tiles or on the plain globe alike.
 */
import * as Cesium from 'cesium';
import { offsetToLonLat, pointOnLoop } from './layout.js';

export const TWIN_ENTITY_PREFIX = 'port-twin:';

export const TWIN_COLORS = Object.freeze({
  grid: '#20e7f2',
  diesel: '#ff8c3a',
  charging: '#7cff8a',
  parked: '#8a94a6',
  hull: '#33415c',
  deck: '#e8ecf2',
  charger: '#c7d2e0',
  smoke: '#5b5f66',
});

const DEG = Math.PI / 180;
const REL = Cesium.HeightReference.RELATIVE_TO_GROUND;
const color = (hex, alpha = 1) =>
  Cesium.Color.fromCssColorString(hex).withAlpha(alpha);

/** Cesium heading (radians) that points a box's long (x) axis at a bearing. */
const headingFor = (bearingDeg) => (bearingDeg - 90) * DEG;

function stateColor(unit) {
  if (unit.state === 'charging') return TWIN_COLORS.charging;
  if (unit.state !== 'working') return TWIN_COLORS.parked;
  return unit.powertrain === 'diesel' ? TWIN_COLORS.diesel : TWIN_COLORS.grid;
}

/**
 * @param {Cesium.CustomDataSource} dataSource
 * @param {typeof import('./layout.js').TWIN_LAYOUT} layout
 */
export function createTwinView(dataSource, layout) {
  const entities = dataSource.entities;
  const place = (offset, height = 0) => {
    const [lon, lat] = offsetToLonLat(layout.origin, offset);
    return Cesium.Cartesian3.fromDegrees(lon, lat, height);
  };
  const orient = (position, bearingDeg, pitchDeg = 0) =>
    Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(headingFor(bearingDeg), pitchDeg * DEG, 0),
    );
  const box = (
    id,
    offset,
    height,
    dimensions,
    hex,
    bearing = 90,
    pitch = 0,
  ) => {
    const position = place(offset, height);
    return entities.add({
      id: `${TWIN_ENTITY_PREFIX}${id}`,
      position,
      orientation: orient(position, bearing, pitch),
      box: {
        dimensions: new Cesium.Cartesian3(...dimensions),
        material: color(hex),
        heightReference: REL,
        outline: true,
        outlineColor: color('#0b0f17', 0.6),
      },
    });
  };
  const paint = (entity, hex, alpha = 1) => {
    entity.box.material = new Cesium.ColorMaterialProperty(color(hex, alpha));
  };

  // Ship: hull plus a bridge block at the stern. Hidden when no call.
  const s = layout.ship;
  const hull = box(
    'ship',
    { east: s.east, north: s.north },
    s.height / 2,
    [s.length, s.beam, s.height],
    TWIN_COLORS.hull,
  );
  const bridge = box(
    'ship-bridge',
    { east: s.east - s.length / 2 + 14, north: s.north },
    s.height + 8,
    [16, s.beam - 2, 16],
    TWIN_COLORS.deck,
  );
  const vault = box(
    'shore-power',
    layout.shorePowerVault,
    1.5,
    [4, 4, 3],
    TWIN_COLORS.parked,
  );

  // Cranes: base, tower and a boom pitched up over the ship.
  const cranes = layout.cranes.map((at, i) => {
    const key = `crane-${i}`;
    const parts = [
      box(`${key}:base`, at, 4, [12, 12, 8], TWIN_COLORS.parked),
      box(`${key}:tower`, at, 21, [4, 4, 26], TWIN_COLORS.parked),
      box(
        `${key}:boom`,
        { east: at.east, north: at.north + 21.3 },
        42.6,
        [46, 2.5, 2.5],
        TWIN_COLORS.parked,
        0,
        22,
      ),
    ];
    const smoke = entities.add({
      id: `${TWIN_ENTITY_PREFIX}${key}:smoke`,
      position: place(at, 14),
      ellipsoid: {
        radii: new Cesium.Cartesian3(3, 3, 3),
        material: color(TWIN_COLORS.smoke, 0.45),
        heightReference: REL,
      },
      show: false,
    });
    return { parts, smoke, at };
  });

  // Charger posts along the yard.
  const chargers = [];
  const chargerOffset = (i) => ({
    east: layout.chargerRow.east + i * layout.chargerRow.spacing,
    north: layout.chargerRow.north,
  });
  const parkingOffset = (i) => ({
    east: layout.parkingRow.east + (i % 28) * layout.parkingRow.spacing,
    north: layout.parkingRow.north - Math.floor(i / 28) * 10,
  });
  function ensureChargers(count) {
    while (chargers.length < count) {
      const i = chargers.length;
      chargers.push(
        box(
          `charger-${i}`,
          { ...chargerOffset(i), north: chargerOffset(i).north - 5 },
          1.2,
          [1, 1, 2.4],
          TWIN_COLORS.charger,
        ),
      );
    }
    chargers.forEach((entity, i) => {
      entity.show = i < count;
    });
  }

  // UTRs: one entity per unit; position comes from a callback so working
  // units drive the loop between frames.
  const utrs = new Map();
  let animSeconds = 0;
  const LOOP_SECONDS = 40;
  function utrEntity(unit) {
    let entry = utrs.get(unit.id);
    if (entry) return entry;
    entry = { unit, target: { kind: 'parked', index: 0 } };
    const position = new Cesium.CallbackPositionProperty(() => {
      const t = entry.target;
      if (t.kind === 'loop') {
        const p = pointOnLoop(
          layout.utrLoop,
          t.phase + animSeconds / LOOP_SECONDS,
        );
        entry.bearing = p.bearing;
        return place(p, 1.6);
      }
      entry.bearing = 0;
      return place(
        t.kind === 'charging' ? chargerOffset(t.index) : parkingOffset(t.index),
        1.6,
      );
    }, false);
    const orientation = new Cesium.CallbackProperty(() => {
      const t = entry.target;
      const p =
        t.kind === 'loop'
          ? pointOnLoop(layout.utrLoop, t.phase + animSeconds / LOOP_SECONDS)
          : t.kind === 'charging'
            ? chargerOffset(t.index)
            : parkingOffset(t.index);
      return orient(place(p, 1.6), t.kind === 'loop' ? p.bearing : 0);
    }, false);
    entry.entity = entities.add({
      id: `${TWIN_ENTITY_PREFIX}utr:${unit.id}`,
      position,
      orientation,
      box: {
        dimensions: new Cesium.Cartesian3(7, 2.6, 3.2),
        material: color(TWIN_COLORS.parked),
        heightReference: REL,
        outline: true,
        outlineColor: color('#0b0f17', 0.6),
      },
    });
    utrs.set(unit.id, entry);
    return entry;
  }

  /** Repaint and reposition everything for one frame. */
  function showFrame(frame, { shorePower }) {
    hull.show = Boolean(frame.ship);
    bridge.show = Boolean(frame.ship);
    paint(
      vault,
      frame.ship && shorePower ? TWIN_COLORS.grid : TWIN_COLORS.parked,
    );

    frame.cranes.forEach((unit, i) => {
      const crane = cranes[i];
      if (!crane) return;
      const hex = stateColor(unit);
      crane.parts.forEach((part) => paint(part, hex));
      crane.smoke.show =
        unit.powertrain === 'diesel' && unit.state === 'working';
      crane.unit = unit;
    });

    const electric = frame.utrs.filter((u) => u.powertrain !== 'diesel').length;
    ensureChargers(electric);
    const working = frame.utrs.filter((u) => u.state === 'working');
    let charging = 0;
    let parked = 0;
    const seen = new Set();
    for (const unit of frame.utrs) {
      const entry = utrEntity(unit);
      entry.unit = unit;
      seen.add(unit.id);
      entry.entity.show = true;
      if (unit.state === 'working')
        entry.target = {
          kind: 'loop',
          phase: working.indexOf(unit) / Math.max(1, working.length),
        };
      else if (unit.state === 'charging')
        entry.target = { kind: 'charging', index: charging++ };
      else entry.target = { kind: 'parked', index: parked++ };
      entry.entity.box.material = new Cesium.ColorMaterialProperty(
        color(stateColor(unit)),
      );
    }
    for (const [id, entry] of utrs)
      if (!seen.has(id)) entry.entity.show = false;
  }

  /** Which twin object an entity id belongs to, for click cards. */
  function identify(entityId) {
    if (
      typeof entityId !== 'string' ||
      !entityId.startsWith(TWIN_ENTITY_PREFIX)
    )
      return null;
    const key = entityId.slice(TWIN_ENTITY_PREFIX.length);
    if (key.startsWith('utr:')) {
      const entry = utrs.get(key.slice(4));
      return entry
        ? { kind: 'unit', unitId: entry.unit.id, specId: 'utr' }
        : null;
    }
    const crane = key.match(/^crane-(\d+)/);
    if (crane) return { kind: 'crane', index: Number(crane[1]) };
    const charger = key.match(/^charger-(\d+)/);
    if (charger) return { kind: 'charger', index: Number(charger[1]) };
    if (key.startsWith('ship') || key === 'shore-power')
      return { kind: 'ship' };
    return null;
  }

  return {
    showFrame,
    identify,
    /** Advance the drive animation; returns true while anything moves. */
    tick(seconds) {
      animSeconds += seconds;
      for (const entry of utrs.values())
        if (entry.entity.show && entry.target.kind === 'loop') return true;
      return false;
    },
    cameraView() {
      const c = layout.camera;
      const [lon, lat] = offsetToLonLat(layout.origin, c);
      return {
        // Ellipsoid height: Hueneme's geoid sits about 35 m below the ellipsoid.
        destination: Cesium.Cartesian3.fromDegrees(
          lon,
          lat,
          c.height - 35 + 60,
        ),
        orientation: {
          heading: c.headingDeg * DEG,
          pitch: c.pitchDeg * DEG,
          roll: 0,
        },
      };
    },
  };
}
