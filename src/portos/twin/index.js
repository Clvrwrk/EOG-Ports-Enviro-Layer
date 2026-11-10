/**
 * The Port of Hueneme scenario twin: the workbook's scenario engine played
 * hour by hour on 3D equipment at the reefer berth, with decision toggles,
 * a year scoreboard and click-through data cards.
 *
 * The port layer mounts it while it is on; it adds its entities to the
 * layer's data source and its panel to the page.
 */
import * as Cesium from 'cesium';
import { fetchAdminRegistry } from '../admin/registrySource.js';
import { runScenario } from '../scenario.js';
import {
  baselineScenario,
  normalizeScenario,
  readLibrary,
  scenarioFromSearch,
  scenarioLink,
} from '../scenarioStore.js';
import { STEPS_PER_HOUR } from '../touCalendar.js';
import {
  applyDecisions,
  chargerCard,
  decisionsFromScenario,
  nextCallStart,
  scoreboard,
  shipCard,
  twinFrame,
  unitCard,
} from './frame.js';
import { TWIN_LAYOUT } from './layout.js';
import { createTwinPanel } from './panel.js';
import { createTwinView } from './view.js';

/** Simulated hours per real second while playing. */
const PLAY_HOURS_PER_SECOND = 1;
const PLAN_ID = 'plan';
const LINK_ID = 'link';
const EDITED_ID = 'edited';
const PLAN_NAME = 'Fleet plan, as today';
const OVERLAY_SOURCE_ID = 'port-twin';
const NAME_MAX_DISTANCE_M = 2500;
const NO_OVERLAY = { setEntries() {}, clearSource() {} };

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function createPortTwin({
  requestRender = () => {},
  overlayHost = NO_OVERLAY,
  layout = TWIN_LAYOUT,
} = {}) {
  let viewer = null;
  let view = null;
  let panel = null;
  let handler = null;
  let raf = null;
  let lastTime = 0;
  let playing = false;
  let scenario = normalizeScenario({ name: PLAN_NAME });
  let activeId = PLAN_ID;
  let library = { items: [], baselineId: null };
  let linked = null; // scenario that arrived in the page link
  let baseline = null;
  // Run options: { registry } once a signed-in admin registry arrives.
  let runContext = {};
  let result = null;
  let step = 0;
  let stepFloat = 0;
  let selected = null; // { target, x, y }
  let frame = null;

  function cardFor(target) {
    if (!frame || !target) return null;
    if (target.kind === 'ship') return shipCard(frame, result);
    if (target.kind === 'charger')
      return chargerCard(frame, target.index, result);
    if (target.kind === 'crane') {
      const unit = frame.cranes[target.index];
      return unit ? unitCard(frame, unit, result) : null;
    }
    if (target.kind === 'unit') {
      const unit = frame.utrs.find((u) => u.id === target.unitId);
      return unit
        ? unitCard(frame, unit, result)
        : { title: `${target.unitId} is not in this scenario`, rows: [] };
    }
    return null;
  }

  function render(reason) {
    frame = twinFrame(result, step);
    view.showFrame(frame, { shorePower: result.scenario.shorePower });
    panel.showFrame(frame);
    if (selected)
      panel.showCard(cardFor(selected.target), selected.x, selected.y);
    requestRender(reason);
  }

  function scenarioOptions() {
    const options = [[PLAN_ID, PLAN_NAME]];
    if (linked) options.push([LINK_ID, `${linked.name} (from link)`]);
    for (const item of library.items)
      options.push([item.id, item.scenario.name]);
    if (activeId === EDITED_ID)
      options.push([EDITED_ID, `${scenario.name} (edited here)`]);
    return options;
  }

  function showScenario() {
    const baselineItem = library.items.find(
      (item) => item.id === library.baselineId,
    );
    panel.showScenario({
      options: scenarioOptions(),
      activeId,
      decisions: decisionsFromScenario(scenario),
      builderHref: scenarioLink(scenario, '/scenarios'),
      baselineName: baselineItem ? baselineItem.scenario.name : 'today',
      note:
        activeId === EDITED_ID
          ? 'Changed here. Open the builder to save it.'
          : '',
    });
  }

  function run() {
    result = runScenario(scenario, runContext);
    if (!baseline)
      baseline = runScenario(baselineScenario(library), runContext);
    step = Math.min(step, result.siteKw.length - 1);
    stepFloat = Math.min(stepFloat, result.siteKw.length - 1);
    showScenario();
    panel.showScoreboard(scoreboard(result, baseline));
    render('port-twin-scenario');
  }

  function pick(id) {
    library = readLibrary(browserStorage());
    const saved = library.items.find((item) => item.id === id);
    if (saved) scenario = saved.scenario;
    else if (id === LINK_ID && linked) scenario = linked;
    else if (id === PLAN_ID) scenario = normalizeScenario({ name: PLAN_NAME });
    else return;
    activeId = id;
    baseline = null;
    run();
  }

  function seek(next) {
    const last = result.siteKw.length - 1;
    stepFloat = Math.max(0, Math.min(last, next));
    const whole = Math.floor(stepFloat);
    if (whole === step) return;
    step = whole;
    render('port-twin-seek');
  }

  function loop(time) {
    raf = requestAnimationFrame(loop);
    const seconds = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0;
    lastTime = time;
    if (playing)
      seek(stepFloat + seconds * PLAY_HOURS_PER_SECOND * STEPS_PER_HOUR);
    if (view.tick(seconds) || playing) requestRender('port-twin-anim');
  }

  function onClick(movement) {
    const picked = viewer.scene.pick(movement.position);
    const target = view.identify(picked?.id?.id);
    if (!target) return;
    selected = { target, x: movement.position.x, y: movement.position.y };
    const rect = viewer.canvas.getBoundingClientRect();
    selected.x += rect.left;
    selected.y += rect.top;
    panel.showCard(cardFor(target), selected.x, selected.y);
  }

  return {
    /** Mount on a viewer, drawing into the given data source. */
    enable(nextViewer, dataSource) {
      viewer = nextViewer;
      view = createTwinView(dataSource, layout);
      overlayHost.setEntries(
        OVERLAY_SOURCE_ID,
        view.names().map((name) => ({
          id: `name:${name.id}`,
          source: OVERLAY_SOURCE_ID,
          position: name.position,
          variant: 'card',
          title: name.text,
          details: [],
          accent: '#ffffff',
          priority: 100,
          collisionGroup: 'ambient-card',
          zIndex: 30,
          interactive: false,
          minDistance: 0,
          maxDistance: NAME_MAX_DISTANCE_M,
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
          gapPx: 8,
          placement: 'above',
        })),
      );
      panel = createTwinPanel(
        {
          onDecision(patch) {
            scenario = applyDecisions(scenario, patch);
            activeId = EDITED_ID;
            run();
          },
          onScenario: pick,
          onSeek: seek,
          onCallDay(direction) {
            // An hour into the call, when the cranes and UTRs are working.
            const from = direction > 0 ? step : step - STEPS_PER_HOUR;
            seek(nextCallStart(result, from, direction) + STEPS_PER_HOUR);
          },
          onPlayToggle() {
            playing = !playing;
            panel.setPlaying(playing);
          },
          onWalk() {
            viewer.camera.flyTo({ ...view.cameraView(), duration: 3 });
          },
          onCardClose() {
            selected = null;
            panel.showCard(null);
          },
        },
        decisionsFromScenario(scenario),
        layout,
      );
      library = readLibrary(browserStorage());
      linked = scenarioFromSearch(globalThis.location?.search ?? '');
      if (linked) {
        scenario = linked;
        activeId = LINK_ID;
      }
      result = runScenario(scenario, runContext);
      baseline = runScenario(baselineScenario(library), runContext);
      showScenario();
      // Staff signed in to /admin see the twin run on the registry they
      // edited; everyone else keeps the built-in seed.
      fetchAdminRegistry().then((registry) => {
        if (!registry || !panel) return;
        runContext = { registry };
        baseline = null;
        run();
      });
      // Open an hour into the first reefer call of the year.
      step = nextCallStart(result, -1, 1) + STEPS_PER_HOUR;
      stepFloat = step;
      panel.showScoreboard(scoreboard(result, baseline));
      render('port-twin-enable');
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      lastTime = 0;
      raf = requestAnimationFrame(loop);
    },
    disable() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      handler?.destroy();
      handler = null;
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      panel?.destroy();
      panel = null;
      view = null;
      viewer = null;
      playing = false;
      selected = null;
    },
    /** Current scenario result, for tests and the console. */
    getResult: () => result,
    getScenario: () => scenario,
    getDecisions: () => decisionsFromScenario(scenario),
    /** Play a scenario from outside (the builder, tests, the console). */
    setScenario(next) {
      linked = normalizeScenario(next);
      if (panel) pick(LINK_ID);
      else {
        scenario = linked;
        activeId = LINK_ID;
      }
    },
  };
}
