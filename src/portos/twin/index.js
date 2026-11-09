/**
 * The Port of Hueneme scenario twin: the workbook's scenario engine played
 * hour by hour on 3D equipment at the reefer berth, with decision toggles,
 * a year scoreboard and click-through data cards.
 *
 * The port layer mounts it while it is on; it adds its entities to the
 * layer's data source and its panel to the page.
 */
import * as Cesium from 'cesium';
import { runScenario } from '../scenario.js';
import { STEPS_PER_HOUR } from '../touCalendar.js';
import {
  DEFAULT_DECISIONS,
  chargerCard,
  nextCallStart,
  scenarioFromDecisions,
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

export function createPortTwin({
  requestRender = () => {},
  layout = TWIN_LAYOUT,
} = {}) {
  let viewer = null;
  let view = null;
  let panel = null;
  let handler = null;
  let raf = null;
  let lastTime = 0;
  let playing = false;
  let decisions = { ...DEFAULT_DECISIONS };
  let baseline = null;
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

  function run() {
    result = runScenario(scenarioFromDecisions(decisions));
    if (!baseline) baseline = result;
    panel.showScoreboard(scoreboard(result, baseline));
    render('port-twin-scenario');
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
      panel = createTwinPanel(
        {
          onDecision(patch) {
            decisions = { ...decisions, ...patch };
            run();
          },
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
        decisions,
        layout,
      );
      result = runScenario(scenarioFromDecisions(decisions));
      baseline = result;
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
      panel?.destroy();
      panel = null;
      view = null;
      viewer = null;
      playing = false;
      selected = null;
    },
    /** Current scenario result, for tests and the console. */
    getResult: () => result,
    getDecisions: () => ({ ...decisions }),
  };
}
