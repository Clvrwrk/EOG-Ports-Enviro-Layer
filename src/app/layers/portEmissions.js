import { createPortEmissionsLayer } from '../../layers/portEmissions/index.js';
import { PORT_OF_HUENEME } from '../../emissions/ports.js';
import { governorRequestRender } from '../../renderGovernor.js';
import * as overlays from '../../overlays/worldOverlay.js';

/** Wire the port emissions layer to the live AIS vessel layer it reads. */
export function createApplicationPortEmissions({
  vessels,
  profile = PORT_OF_HUENEME,
}) {
  return createPortEmissionsLayer({
    profile,
    readVessels: () => vessels.getAnalystRecords(5000),
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      clearSource: overlays.clearOverlaySource,
    },
    requestRender: governorRequestRender,
  });
}
