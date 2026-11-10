import { createFreightFootprintLayer } from '../../layers/freightFootprint/index.js';
import { governorRequestRender } from '../../renderGovernor.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the freight footprint layer to the world-overlay cards and renderer. */
export function createApplicationFreightFootprint() {
  return createFreightFootprintLayer({
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      clearSource: overlays.clearOverlaySource,
    },
    requestRender: governorRequestRender,
  });
}
