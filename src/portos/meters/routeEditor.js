/**
 * Draw the port's electrical routes by hand on the map.
 *
 * While editing: click a line to choose it, click the map to put a bend on
 * the nearest stretch of the chosen line, drag a bend to move it, and
 * right-click a bend to take it out. Incoming transformers and the utility
 * feed are dragged the same way. Every gesture becomes an edit of the grid
 * plan (gridPlan.js) handed to `onPlan`; the twin redraws the network from
 * it and calls `refresh` with the result.
 *
 * Positions only ever come from the map, never from typing.
 */
import * as Cesium from 'cesium';
import { gridPlanEdits } from './gridPlan.js';
import { GRID_ENTITY_PREFIX } from './networkView.js';

/** Inside the grid prefix so the twin clears these with the rest. */
const EDIT_PREFIX = `${GRID_ENTITY_PREFIX}edit:`;
const HANDLE = '#ffffff';
const HANDLE_ON = '#ff9f43';
const LINE = '#ffffff';

const flat = (points) => points.flatMap(([lat, lon]) => [lon, lat]);

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Cesium.CustomDataSource} options.dataSource
 * @param {(plan: object) => void} options.onPlan an edit was made
 * @param {(state: object) => void} options.onState selection changed
 * @param {(reason: string) => void} [options.requestRender]
 */
export function createRouteEditor({
  viewer,
  dataSource,
  onPlan,
  onState,
  requestRender = () => {},
}) {
  const entities = dataSource.entities;
  const scene = viewer.scene;
  let handler = null;
  let network = null;
  let plan = null;
  let edgeId = null;
  let bend = null; // index of the bend last touched on the chosen line
  let placing = false; // next map click places an incoming transformer
  let drag = null; // { kind: 'bend'|'source'|'feed', index?, id?, moved, at }
  let swallowClick = false;
  let drawn = [];

  const edge = () => network?.edges.find((e) => e.id === edgeId) ?? null;
  const state = () => ({ edgeId, bend, placing });

  /** [lat, lon] under a screen position, or null off the map. */
  function groundAt(position) {
    let point = null;
    if (scene.globe.show) {
      const ray = viewer.camera.getPickRay(position);
      if (ray) point = scene.globe.pick(ray, scene);
    }
    if (!Cesium.defined(point) && scene.pickPositionSupported)
      point = scene.pickPosition(position);
    if (!Cesium.defined(point))
      point = viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid);
    if (!Cesium.defined(point)) return null;
    const where = Cesium.Cartographic.fromCartesian(point);
    if (!where) return null;
    return [
      Cesium.Math.toDegrees(where.latitude),
      Cesium.Math.toDegrees(where.longitude),
    ];
  }

  function clear() {
    for (const entity of drawn) entities.remove(entity);
    drawn = [];
  }

  /** The chosen line picked out in white, with a handle on every bend. */
  function draw() {
    clear();
    const chosen = edge();
    if (!handler || !chosen) return requestRender('port-grid-edit');
    drawn.push(
      entities.add({
        id: `${EDIT_PREFIX}line`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat(chosen.path)),
          width: 5,
          clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(LINE),
            dashLength: 14,
          }),
        },
      }),
    );
    chosen.path.slice(1, -1).forEach(([lat, lon], i) => {
      drawn.push(
        entities.add({
          id: `${EDIT_PREFIX}bend:${i}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: i === bend ? 16 : 13,
            color: Cesium.Color.fromCssColorString(
              i === bend ? HANDLE_ON : HANDLE,
            ),
            outlineColor: Cesium.Color.fromCssColorString('#0b0f17'),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    });
    requestRender('port-grid-edit');
  }

  /** What a picked entity means to the editor. */
  function grab(picked) {
    const id = picked?.id?.id;
    if (typeof id !== 'string' || !id.startsWith(GRID_ENTITY_PREFIX))
      return null;
    const rest = id.slice(GRID_ENTITY_PREFIX.length);
    if (rest.startsWith('edit:bend:'))
      return { kind: 'bend', index: Number(rest.slice('edit:bend:'.length)) };
    if (rest === 'edit:line') return { kind: 'line', id: edgeId };
    if (rest === 'node:feed') return { kind: 'feed' };
    if (rest.startsWith('node:source:'))
      return { kind: 'source', id: rest.slice('node:source:'.length) };
    if (rest.startsWith('edge:'))
      return { kind: 'line', id: rest.slice('edge:'.length) };
    if (rest.startsWith('dot:'))
      return {
        kind: 'line',
        id: rest.slice('dot:'.length).split(':').slice(0, -1).join(':'),
      };
    return null;
  }

  const camera = (on) => {
    scene.screenSpaceCameraController.enableInputs = on;
  };

  function select(id) {
    const next = network?.edges.find((e) => e.id === id && !e.fixed);
    edgeId = next ? next.id : null;
    bend = null;
    draw();
    onState(state());
  }

  function commit(next) {
    if (next !== plan) onPlan(next);
  }

  function onDown(movement) {
    const hit = grab(scene.pick(movement.position));
    if (!hit || hit.kind === 'line') return;
    drag = { ...hit, moved: false, at: null };
    camera(false);
  }

  function onMove(movement) {
    if (!drag) return;
    const at = groundAt(movement.endPosition);
    if (!at) return;
    drag.moved = true;
    drag.at = at;
    const position = Cesium.Cartesian3.fromDegrees(at[1], at[0]);
    if (drag.kind === 'bend') {
      const chosen = edge();
      const path = chosen.path.map((p, i) => (i === drag.index + 1 ? at : p));
      entities.getById(`${EDIT_PREFIX}bend:${drag.index}`).position = position;
      entities.getById(`${EDIT_PREFIX}line`).polyline.positions =
        Cesium.Cartesian3.fromDegreesArray(flat(path));
    } else {
      const id = drag.kind === 'feed' ? 'node:feed' : `node:source:${drag.id}`;
      const box = entities.getById(`${GRID_ENTITY_PREFIX}${id}`);
      if (box) box.position = Cesium.Cartesian3.fromDegrees(at[1], at[0], 3);
    }
    requestRender('port-grid-edit');
  }

  function onUp() {
    if (!drag) return;
    const done = drag;
    drag = null;
    camera(true);
    swallowClick = true;
    if (done.kind === 'bend') {
      bend = done.index;
      if (done.moved && done.at)
        return commit(
          gridPlanEdits.moveBend(
            plan,
            edgeId,
            edge().path,
            done.index,
            done.at,
          ),
        );
      draw();
      return onState(state());
    }
    if (!done.moved || !done.at) return;
    commit(
      done.kind === 'feed'
        ? gridPlanEdits.moveFeed(plan, done.at)
        : gridPlanEdits.moveSource(plan, done.id, done.at),
    );
  }

  function onClick(movement) {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (placing) {
      const at = groundAt(movement.position);
      if (!at) return;
      placing = false;
      onState(state());
      return commit(gridPlanEdits.addSource(plan, at));
    }
    const hit = grab(scene.pick(movement.position));
    if (hit?.kind === 'line' && hit.id !== edgeId) return select(hit.id);
    if (hit && hit.kind !== 'line') return;
    const chosen = edge();
    if (!chosen) return;
    const at = groundAt(movement.position);
    if (!at) return;
    const next = gridPlanEdits.addBend(plan, edgeId, chosen.path, at);
    if (next !== plan) {
      // The new bend is the one a "remove" would take out.
      bend = next.routes[edgeId].findIndex(
        (p) =>
          p[0] === Number(at[0].toFixed(7)) &&
          p[1] === Number(at[1].toFixed(7)),
      );
      commit(next);
    }
  }

  function removeBend(index = bend) {
    const chosen = edge();
    if (!chosen || index == null) return;
    bend = null;
    commit(gridPlanEdits.removeBend(plan, edgeId, chosen.path, index));
  }

  function onRightClick(movement) {
    const hit = grab(scene.pick(movement.position));
    if (hit?.kind === 'bend') removeBend(hit.index);
  }

  return {
    active: () => Boolean(handler),
    start() {
      if (handler) return;
      handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
      const type = Cesium.ScreenSpaceEventType;
      handler.setInputAction(onDown, type.LEFT_DOWN);
      handler.setInputAction(onMove, type.MOUSE_MOVE);
      handler.setInputAction(onUp, type.LEFT_UP);
      handler.setInputAction(onClick, type.LEFT_CLICK);
      handler.setInputAction(onRightClick, type.RIGHT_CLICK);
      draw();
    },
    stop() {
      if (!handler) return;
      handler.destroy();
      handler = null;
      if (drag) camera(true);
      drag = null;
      placing = false;
      edgeId = null;
      bend = null;
      clear();
      requestRender('port-grid-edit');
    },
    /** The network was redrawn from a new plan. */
    refresh(nextNetwork, nextPlan) {
      network = nextNetwork;
      plan = nextPlan;
      if (edgeId && !edge()) edgeId = null;
      const bends = (edge()?.path.length ?? 2) - 2;
      if (bend != null && bend >= bends) bend = null;
      draw();
      onState(state());
    },
    select,
    removeBend,
    setPlacing(on) {
      placing = Boolean(on);
      onState(state());
    },
    state,
  };
}
