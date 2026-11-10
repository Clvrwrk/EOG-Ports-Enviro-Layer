/**
 * The EV Planning section of the POH Twin panel: plan a battery-electric
 * drayage round trip from the port to a drop site and draw it on the globe,
 * coloured by battery charge, with the fleet's charging load where the trucks charge and
 * emissions against diesel.
 */
import {
  createEvForm,
  el,
  planFromSearch,
  planQuery,
  resultView,
} from './form.js';
import { runTrip } from './runTrip.js';
import { createEvView } from './view.js';

const STYLE_ID = 'ev-planning-style';
const CSS = `
.ev-planning summary{cursor:pointer;color:#20e7f2;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px}
.ev-planning select{max-width:180px}
.ev-planning .ev-result p{margin:6px 0}
.ev-planning .links{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.ev-planning .links a{color:#20e7f2}
`;

/**
 * @param {object} args
 * @param {Element} args.host where the section goes (the twin panel's slot)
 * @param {import('cesium').Viewer} args.viewer
 * @param {import('cesium').CustomDataSource} args.dataSource
 * @param {(reason: string) => void} [args.requestRender]
 * @param {() => void} [args.onBackToPort]
 */
export function createEvPlanningSection({
  host,
  viewer,
  dataSource,
  requestRender = () => {},
  onBackToPort = () => {},
}) {
  if (!document.getElementById(STYLE_ID))
    document.head.append(el('style', { id: STYLE_ID }, CSS));
  const view = createEvView(dataSource);
  const linked = planFromSearch(globalThis.location?.search);
  let last = null;
  let runId = 0;
  const output = el('div');
  const fit = el(
    'button',
    {
      type: 'button',
      disabled: true,
      onclick: () => {
        if (!last) return;
        viewer.camera.flyTo({
          destination: view.rectangle(last.routes.out.coordinates),
          duration: 2,
        });
      },
    },
    'See the whole route',
  );
  const back = el(
    'button',
    { type: 'button', onclick: () => onBackToPort() },
    'Back to the port',
  );
  const pageLink = el('a', { href: '/ev-planning' }, 'Full EV Planning page');
  const form = createEvForm(async (request) => {
    const mine = (runId += 1);
    form.setBusy(true, 'Routing and reading terrain…');
    try {
      const answer = await runTrip(request);
      if (mine !== runId) return;
      last = answer;
      view.show({
        trip: answer.trip,
        out: answer.routes.out,
        back: answer.routes.back,
        site: answer.site,
      });
      output.replaceChildren(resultView(answer));
      fit.disabled = false;
      pageLink.setAttribute('href', `/ev-planning?${planQuery(request)}`);
      form.setBusy(false);
      requestRender('ev-planning');
      fit.click();
    } catch (error) {
      if (mine === runId) form.showError(error);
    }
  }, linked ?? {});
  const root = el(
    'details',
    { class: 'ev-planning', open: Boolean(linked) },
    el('summary', {}, 'EV Planning: drayage trips'),
    el(
      'p',
      { class: 'sub' },
      'Battery-electric trucks from the fleet catalog, driven from POH to a drop site and back with FleetVolt physics.',
    ),
    form.root,
    output,
    el('div', { class: 'links' }, fit, back, pageLink),
  );
  host.replaceChildren(root);
  if (linked) form.root.requestSubmit();
  return {
    /** The last plan, for tests and the console. */
    getLast: () => last,
    destroy() {
      runId += 1;
      view.destroy();
      root.remove();
      requestRender('ev-planning-off');
    },
  };
}
