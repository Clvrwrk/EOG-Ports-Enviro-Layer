/**
 * Cesium drawing of the port asset registry: building and yard outlines as
 * tinted footprints, rail spurs as lines, and everything with a point as a
 * pin, coloured by inventory section. Each asset is clickable; `identify`
 * maps a picked entity back to its asset for the data card.
 *
 * Mobile equipment (UTRs, cranes, forklifts) is left to the scenario twin,
 * which animates it; this view draws the fixed port and the craft that tie
 * up there.
 */
import * as Cesium from 'cesium';
import { ASSET_CLASSES, assetPosition } from '../assetClasses.js';

export const ASSET_ENTITY_PREFIX = 'port-asset:';
const REL = Cesium.HeightReference.RELATIVE_TO_GROUND;

/** Colour per inventory section. */
export const GROUP_COLORS = Object.freeze({
  fixed: '#ffd166',
  landside: '#ff9f6b',
  che: '#20e7f2',
  harbor_craft: '#6aa8ff',
  rail: '#ff7ab6',
  trucks: '#c39bff',
  electrical: '#7cff8a',
});

/** Classes the twin already draws (and animates) itself. */
const DRAWN_BY_TWIN = new Set(
  Object.entries(ASSET_CLASSES)
    .filter(([, definition]) => definition.group === 'che')
    .map(([cls]) => cls),
);

/** Whether this view draws `asset` at all. */
export function drawsAsset(asset) {
  return !DRAWN_BY_TWIN.has(asset.class) && assetPosition(asset) !== null;
}

const flat = (points) => points.flatMap(([lat, lon]) => [lon, lat]);
const tint = (hex, alpha) =>
  Cesium.Color.fromCssColorString(hex).withAlpha(alpha);

/**
 * @param {Cesium.CustomDataSource} dataSource
 * @param {{ assets: object[] }} registry
 */
export function createAssetView(dataSource, registry) {
  const entities = dataSource.entities;
  const drawn = [];
  const byEntity = new Map();
  const labels = [];
  for (const asset of registry.assets) {
    if (!drawsAsset(asset)) continue;
    const group = ASSET_CLASSES[asset.class].group;
    const color = GROUP_COLORS[group] ?? '#ffffff';
    const key = `${ASSET_ENTITY_PREFIX}${asset.id}`;
    const graphics = { id: key, name: asset.label ?? asset.id };
    if (asset.outline) {
      graphics.polygon = {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(flat(asset.outline)),
        height: 0,
        heightReference: REL,
        // A thin slab over the site layer's grey block, so it reads as a tint.
        extrudedHeight: asset.class === 'building' ? 11 : 0.5,
        extrudedHeightReference: REL,
        material: tint(color, 0.35),
        outline: true,
        outlineColor: tint(color, 0.95),
      };
    } else if (asset.path) {
      graphics.polyline = {
        positions: Cesium.Cartesian3.fromDegreesArray(flat(asset.path)),
        width: 5,
        clampToGround: true,
        material: tint(color, 0.9),
      };
    } else {
      const { lat, lon } = assetPosition(asset);
      graphics.position = Cesium.Cartesian3.fromDegrees(lon, lat, 2);
      graphics.point = {
        pixelSize: 11,
        color: tint(color, 0.95),
        outlineColor: tint('#0b0f17', 0.9),
        outlineWidth: 2,
        heightReference: REL,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      };
    }
    const entity = entities.add(graphics);
    drawn.push(entity);
    byEntity.set(key, asset);
    const { lat, lon } = assetPosition(asset);
    labels.push({ id: asset.id, text: asset.label ?? asset.id, lat, lon });
  }
  return {
    /** How many assets are on the map. */
    count: drawn.length,
    setVisible(visible) {
      for (const entity of drawn) entity.show = visible;
    },
    /** The asset behind a picked entity id, or null. */
    identify(entityId) {
      return typeof entityId === 'string'
        ? (byEntity.get(entityId) ?? null)
        : null;
    },
    /** Name tags for the world overlay: { id, text, lat, lon }. */
    labels: () => labels,
    destroy() {
      for (const entity of drawn) entities.remove(entity);
      drawn.length = 0;
      byEntity.clear();
    },
  };
}
