import { createPortEmissionsLayer } from '../../layers/portEmissions/index.js';
import { PORT_OF_HUENEME } from '../../emissions/ports.js';
import { createPortTwin } from '../../portos/twin/index.js';
import { governorRequestRender } from '../../renderGovernor.js';
import * as overlays from '../../overlays/worldOverlay.js';

/**
 * Wire the port layer to the live AIS vessel layer it reads and to the
 * scenario twin it draws while on.
 */
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
    twin: createPortTwin({ requestRender: governorRequestRender }),
  });
}
