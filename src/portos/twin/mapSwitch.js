/**
 * Turn the map picture off and on under the twin: imagery and photoreal 3D
 * tiles are hidden and the ground is drawn as a plain dark surface, so the
 * twin's own layers and motion read clearly. Turning it back on restores
 * exactly what was showing before.
 */
import * as Cesium from 'cesium';

const GROUND = '#0b1220';

export function createMapSwitch(viewer) {
  let saved = null;
  return {
    /** @param {boolean} on whether the map picture shows */
    set(on) {
      const { scene } = viewer;
      if (on) {
        if (!saved) return;
        scene.globe.show = saved.globeShow;
        scene.globe.baseColor = saved.baseColor;
        for (const [item, show] of saved.items)
          if (!item.isDestroyed?.()) item.show = show;
        saved = null;
        return;
      }
      if (saved) return;
      const items = [];
      for (let i = 0; i < viewer.imageryLayers.length; i += 1)
        items.push(viewer.imageryLayers.get(i));
      for (let i = 0; i < scene.primitives.length; i += 1) {
        const primitive = scene.primitives.get(i);
        if (primitive instanceof Cesium.Cesium3DTileset) items.push(primitive);
      }
      saved = {
        globeShow: scene.globe.show,
        baseColor: scene.globe.baseColor,
        items: items.map((item) => [item, item.show]),
      };
      for (const item of items) item.show = false;
      scene.globe.baseColor = Cesium.Color.fromCssColorString(GROUND);
      scene.globe.show = true;
    },
    isOff: () => saved !== null,
  };
}
