/**
 * Cesium entities for the twin: the reefer ship at its berth, four mobile
 * harbor cranes (stored or working beside the ship), the UTR fleet (driving
 * between the apron and the yard, on the charge ports or in the diesel
 * queues), the reach stackers and labelled landmarks. Colours show what each
 * machine is doing at the current step.
 *
 * Each machine type draws as a glTF model when `layout.models` names one,
 * and as simple boxes otherwise. Both sit relative to the ground, so they
 * work on Google's photorealistic tiles or on the plain globe alike.
 */
import * as Cesium from 'cesium';
import {
  berthPoint,
  offsetToLonLat,
  pointOnLoop,
  rowSlot,
  utrLoopFor,
} from './layout.js';

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
const UTR_HEIGHT = 1.6;
const CLAMP = Cesium.HeightReference.CLAMP_TO_GROUND;
// Models follow public/models/README.md: metres, glTF +Y up, front toward
// local -X, origin at the base. After Cesium's glTF axis correction, such a
// model faces compass bearing b at heading b + 180 deg (as for flights).
const modelHeading = (bearingDeg) => (bearingDeg + 180) * DEG;
const LOOP_SECONDS = 40;

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
  const models = layout.models ?? {};
  const boxGraphics = (dimensions, hex) => ({
    dimensions: new Cesium.Cartesian3(...dimensions),
    material: color(hex),
    heightReference: REL,
    outline: true,
    outlineColor: color('#0b0f17', 0.6),
  });
  // A model keeps its own colours; the state colour draws as an outline
  // (silhouette), plus an optional tint of the whole model.
  const modelGraphics = (spec, hex) => ({
    uri: spec.uri,
    scale: spec.scale ?? 1,
    minimumPixelSize: spec.minimumPixelSize ?? 16,
    heightReference: CLAMP,
    silhouetteColor: color(hex),
    silhouetteSize: spec.silhouette ?? 2,
    color: color(hex),
    colorBlendMode: Cesium.ColorBlendMode.MIX,
    colorBlendAmount: spec.tint ?? 0,
  });
  /** One entity: the `kind` model if configured, else a box. */
  const part = (id, dimensions, hex, kind) =>
    entities.add({
      id: `${TWIN_ENTITY_PREFIX}${id}`,
      ...(kind && models[kind]
        ? { model: modelGraphics(models[kind], hex) }
        : { box: boxGraphics(dimensions, hex) }),
    });
  const box = (id, dimensions, hex) => part(id, dimensions, hex);
  /** Orientation for a box, or a model (flipped to its front-at--X rule). */
  const orientFor = (entity, position, bearing, pitch = 0) =>
    entity.model
      ? Cesium.Transforms.headingPitchRollQuaternion(
          position,
          new Cesium.HeadingPitchRoll(modelHeading(bearing), 0, 0),
        )
      : orient(position, bearing, pitch);
  const move = (entity, offset, height, bearing = 90, pitch = 0) => {
    // Models stand on the ground; boxes are placed by their centre.
    const position = place(offset, entity.model ? 0 : height);
    entity.position = position;
    entity.orientation = orientFor(entity, position, bearing, pitch);
  };
  const paint = (entity, hex, alpha = 1) => {
    if (entity.model) {
      entity.model.silhouetteColor = color(hex, alpha);
      entity.model.color = color(hex, alpha);
    }
    else
      entity.box.material = new Cesium.ColorMaterialProperty(color(hex, alpha));
  };
  const label = (id, offset, text) =>
    entities.add({
      id: `${TWIN_ENTITY_PREFIX}label:${id}`,
      position: place(offset, 12),
      label: {
        text,
        font: '12px system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: REL,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

  // Landmarks and berth names.
  layout.landmarks.forEach((mark, i) =>
    label(`mark-${i}`, mark.at, mark.label),
  );
  for (const [id, point] of Object.entries(layout.berths))
    label(
      id,
      { east: point.east, north: point.north + 18 },
      id.replace('-', ' '),
    );

  // Ship: hull plus a bridge block at the stern. Hidden when no call.
  const s = layout.ship;
  const hull = part(
    'ship',
    [s.length, s.beam, s.height],
    TWIN_COLORS.hull,
    'ship',
  );
  const bridge = hull.model
    ? null
    : box('ship-bridge', [16, s.beam - 2, 16], TWIN_COLORS.deck);

  // Cranes: base, tower and a boom pitched up toward the water (north).
  const cranes = layout.cranes.map((spec, i) => {
    const key = `crane-${i}`;
    const base = part(`${key}:base`, [12, 12, 8], TWIN_COLORS.parked, 'crane');
    // A crane model is one piece; the box crane needs a tower and boom.
    const parts = base.model
      ? [base]
      : [
          base,
          box(`${key}:tower`, [4, 4, 26], TWIN_COLORS.parked),
          box(`${key}:boom`, [46, 2.5, 2.5], TWIN_COLORS.parked),
        ];
    return {
      spec,
      base,
      tower: parts[1],
      boom: parts[2],
      parts,
      smoke: entities.add({
        id: `${TWIN_ENTITY_PREFIX}${key}:smoke`,
        ellipsoid: {
          radii: new Cesium.Cartesian3(3, 3, 3),
          material: color(TWIN_COLORS.smoke, 0.45),
          heightReference: REL,
        },
        show: false,
      }),
    };
  });
  function placeCrane(crane, at, working) {
    crane.smoke.position = place(at, 14);
    if (crane.base.model) {
      move(crane.base, at, 0, 0);
      return;
    }
    move(crane.base, at, 4);
    move(crane.tower, at, 21);
    // Working booms reach out over the ship; stored booms rest lower.
    const pitch = working ? 22 : 10;
    const reach = 23 * Math.cos(pitch * DEG);
    move(
      crane.boom,
      { east: at.east, north: at.north + reach },
      34 + 23 * Math.sin(pitch * DEG),
      0,
      pitch,
    );
  }

  // Charge ports: the installed pair, plus extra posts when a scenario adds
  // more electric UTRs than ports.
  const chargers = [];
  const chargerSlot = (i) =>
    rowSlot(layout.chargers.at, i, {
      spacing: layout.chargers.spacing,
      perRow: 10,
    });
  function ensureChargers(count) {
    while (chargers.length < count) {
      const i = chargers.length;
      const post = part(
        `charger-${i}`,
        [1, 1, 2.4],
        TWIN_COLORS.charger,
        'charger',
      );
      const slot = chargerSlot(i);
      move(post, { east: slot.east, north: slot.north + 4 }, 1.2);
      chargers.push(post);
    }
    chargers.forEach((entity, i) => {
      entity.show = i < count;
    });
  }

  // Parking: diesel UTRs fill the berth 1 queue, then the shared queue;
  // electric UTRs wait in a row behind the charge ports.
  const dieselSlots = layout.dieselQueues.flatMap((queue) =>
    Array.from({ length: queue.slots }, (_, i) =>
      rowSlot(queue.at, i, { perRow: queue.perRow }),
    ),
  );
  const electricParking = (i) =>
    rowSlot(
      { east: layout.chargers.at.east, north: layout.chargers.at.north - 12 },
      i,
      { perRow: 10 },
    );
  const overflowParking = (i) =>
    rowSlot(
      {
        east: layout.dieselQueues[0].at.east + 40,
        north: layout.dieselQueues[0].at.north,
      },
      i,
      { perRow: 8 },
    );

  // UTRs: one entity per unit; working units drive the loop between frames.
  const utrs = new Map();
  let animSeconds = 0;
  let loop = utrLoopFor(layout, berthPoint(layout, 'berth-1'));
  function utrPose(target) {
    if (target.kind === 'loop') {
      const p = pointOnLoop(loop, target.phase + animSeconds / LOOP_SECONDS);
      return { at: p, bearing: p.bearing };
    }
    return { at: target.at, bearing: 0 };
  }
  function utrEntity(unit) {
    let entry = utrs.get(unit.id);
    if (entry) return entry;
    entry = { unit, target: { kind: 'parked', at: dieselSlots[0] } };
    const entity = part(
      `utr:${unit.id}`,
      [7, 2.6, 3.2],
      TWIN_COLORS.parked,
      'utr',
    );
    const height = entity.model ? 0 : UTR_HEIGHT;
    entity.position = new Cesium.CallbackPositionProperty(
      () => place(utrPose(entry.target).at, height),
      false,
    );
    entity.orientation = new Cesium.CallbackProperty(() => {
      const pose = utrPose(entry.target);
      return orientFor(entity, place(pose.at, height), pose.bearing);
    }, false);
    entry.entity = entity;
    utrs.set(unit.id, entry);
    return entry;
  }

  // Reach stackers: parked at their spot, or working at the yard end of the
  // UTR loop.
  const stackers = new Map();
  function stackerEntity(unit) {
    let entity = stackers.get(unit.id);
    if (!entity) {
      entity = part(
        `stacker:${unit.id}`,
        [9, 4, 4.5],
        TWIN_COLORS.parked,
        'reachStacker',
      );
      stackers.set(unit.id, entity);
    }
    return entity;
  }

  /** Repaint and reposition everything for one frame. */
  function showFrame(frame, { shorePower }) {
    const shipBerth = frame.ship
      ? berthPoint(layout, frame.ship.berthId)
      : null;
    hull.show = Boolean(shipBerth);
    if (bridge) bridge.show = Boolean(shipBerth);
    if (shipBerth) {
      move(hull, shipBerth, s.height / 2);
      if (bridge)
        move(
          bridge,
          { east: shipBerth.east - s.length / 2 + 14, north: shipBerth.north },
          s.height + 8,
        );
      paint(hull, shorePower ? '#1f6f78' : TWIN_COLORS.hull);
    }
    const workBerth = shipBerth ?? berthPoint(layout, 'berth-1');
    loop = utrLoopFor(layout, workBerth);

    // Working cranes line up beside the ship; the rest stay in storage.
    let spot = 0;
    frame.cranes.forEach((unit, i) => {
      const crane = cranes[i];
      if (!crane) return;
      const working = unit.state === 'working';
      const at = working
        ? {
            east:
              workBerth.east +
              layout.craneWorkEast[spot++ % layout.craneWorkEast.length],
            north: layout.apronNorth,
          }
        : crane.spec.park;
      placeCrane(crane, at, working);
      const hex = stateColor(unit);
      for (const piece of crane.parts) paint(piece, hex);
      crane.smoke.show = unit.powertrain === 'diesel' && working;
      crane.unit = unit;
    });

    const electric = frame.utrs.filter((u) => u.powertrain !== 'diesel').length;
    ensureChargers(Math.max(layout.chargers.installed, electric));
    const working = frame.utrs.filter((u) => u.state === 'working');
    let charging = 0;
    let dieselParked = 0;
    let electricParked = 0;
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
        entry.target = { kind: 'charging', at: chargerSlot(charging++) };
      else if (unit.powertrain === 'diesel') {
        const i = dieselParked++;
        entry.target = {
          kind: 'parked',
          at: dieselSlots[i] ?? overflowParking(i - dieselSlots.length),
        };
      } else
        entry.target = {
          kind: 'parked',
          at: electricParking(electricParked++),
        };
      paint(entry.entity, stateColor(unit));
    }
    for (const [id, entry] of utrs)
      if (!seen.has(id)) entry.entity.show = false;

    const yard = {
      east: workBerth.east,
      north: layout.utrLoop.northTop - layout.utrLoop.depth - 12,
    };
    let busy = 0;
    let idle = 0;
    const seenStackers = new Set();
    for (const unit of frame.reachStackers ?? []) {
      const entity = stackerEntity(unit);
      seenStackers.add(unit.id);
      entity.show = true;
      const at =
        unit.state === 'working'
          ? { east: yard.east - 20 + 20 * busy++, north: yard.north }
          : rowSlot(layout.reachStackers.at, idle++, {
              spacing: layout.reachStackers.spacing,
            });
      move(entity, at, 2.25, 0);
      paint(entity, stateColor(unit));
      entity.unit = unit;
    }
    for (const [id, entity] of stackers)
      if (!seenStackers.has(id)) entity.show = false;
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
    if (key.startsWith('stacker:'))
      return { kind: 'unit', unitId: key.slice(8), specId: 'reach_stacker' };
    const crane = key.match(/^crane-(\d+)/);
    if (crane) return { kind: 'crane', index: Number(crane[1]) };
    const charger = key.match(/^charger-(\d+)/);
    if (charger) return { kind: 'charger', index: Number(charger[1]) };
    if (key.startsWith('ship')) return { kind: 'ship' };
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
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, c.height - 35),
        orientation: {
          heading: c.headingDeg * DEG,
          pitch: c.pitchDeg * DEG,
          roll: 0,
        },
      };
    },
  };
}
