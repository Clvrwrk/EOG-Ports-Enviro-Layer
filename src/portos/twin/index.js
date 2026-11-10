/**
 * The Port of Hueneme scenario twin: the workbook's scenario engine played
 * hour by hour on 3D equipment at the reefer berth, with decision toggles,
 * a year scoreboard and click-through data cards.
 *
 * The port layer mounts it while it is on. Its controls sit in the app's
 * "POH Twin" menu panel; the twin itself (models, site layers, the power
 * network, reefer plugs and the usage graph) starts when that panel is
 * opened or its switch is turned on, and is removed when it is turned off.
 */
import * as Cesium from 'cesium';
import { demandDriver } from '../demandDriver.js';
import { HUENEME_REGISTRY } from '../hueneme.js';
import { allocateScenario, meterScenarioAt } from '../meters/allocate.js';
import { loadMeterRegistry } from '../meters/load.js';
import { buildNetwork, networkCard, networkFlows } from '../meters/network.js';
import {
  GRID_ENTITY_PREFIX,
  createNetworkView,
} from '../meters/networkView.js';
import {
  plugCard,
  plugKwhToday,
  plugLayout,
  plugTelemetry,
} from '../meters/plugs.js';
import { dayProfile, meterKwAt } from '../meters/profile.js';
import { meterCard, portCard } from '../meters/registry.js';
import { createUsageChart } from '../meters/usageChart.js';
import { METER_ENTITY_PREFIX, createMeterView } from '../meters/view.js';
import {
  SITE_ENTITY_PREFIX,
  createSiteView,
  loadSite,
  structureCard,
} from '../site/view.js';
import { assetCard } from '../assets/card.js';
import { loadAssetRegistry } from '../assets/load.js';
import { ASSET_ENTITY_PREFIX, createAssetView } from '../assets/view.js';
import { runScenario } from '../scenario.js';
import {
  baselineScenario,
  normalizeScenario,
  readLibrary,
  scenarioFromSearch,
  scenarioLink,
} from '../scenarioStore.js';
import { STEPS_PER_DAY, STEPS_PER_HOUR } from '../touCalendar.js';
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
import { createMapSwitch } from './mapSwitch.js';
import { TWIN_LAYERS, createTwinPanel } from './panel.js';
import { TWIN_ENTITY_PREFIX, createTwinView } from './view.js';
import { loadVesselInventory } from '../vessels/load.js';

/** Simulated hours per real second while playing. */
const PLAY_HOURS_PER_SECOND = 1;
/** World-overlay source the twin's names are published under. */
export const TWIN_OVERLAY_SOURCE_ID = 'port-twin-names';
/** Names show from this close, in metres. */
const NAME_MAX_DISTANCE_M = 2200;
const OWN_PREFIXES = [
  TWIN_ENTITY_PREFIX,
  METER_ENTITY_PREFIX,
  GRID_ENTITY_PREFIX,
  SITE_ENTITY_PREFIX,
  ASSET_ENTITY_PREFIX,
];
const PLAN_ID = 'plan';
const LINK_ID = 'link';
const EDITED_ID = 'edited';
const PLAN_NAME = 'Fleet plan, as today';

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function createPortTwin({
  requestRender = () => {},
  layout = TWIN_LAYOUT,
  loadMeters = loadMeterRegistry,
  loadSiteMap = loadSite,
  loadAssets = loadAssetRegistry,
  overlayHost = null,
} = {}) {
  let viewer = null;
  let dataSource = null;
  let view = null;
  let panel = null;
  let handler = null;
  let raf = null;
  let lastTime = 0;
  let playing = false;
  let active = false;
  let session = 0;
  let scenario = normalizeScenario({ name: PLAN_NAME });
  let activeId = PLAN_ID;
  let library = { items: [], baselineId: null };
  let linked = null; // scenario that arrived in the page link
  let baseline = null;
  let result = null;
  let driver = null;
  let step = 0;
  let stepFloat = 0;
  let selected = null; // { target, x, y }
  let frame = null;
  let vessels = null; // ship inventory, loaded once in the background
  let meters = null; // registry, once loaded
  let meterView = null;
  let allocation = null;
  let plugMap = null;
  let network = null;
  let gridView = null;
  let flows = null;
  let readings = new Map();
  let siteView = null;
  let assets = null; // port asset registry, once loaded
  let assetView = null;
  let mapSwitch = null;
  let usage = null;
  let runCount = 0;
  const layers = Object.fromEntries(TWIN_LAYERS.map((l) => [l.id, l.on]));

  /** Send the scenario's loads to their meters and flag overloaded ones. */
  function allocate() {
    if (!meters || !result) return;
    allocation = allocateScenario(result, meters, HUENEME_REGISTRY.specs);
    const over = new Set();
    for (const [id, entry] of allocation.byMeter)
      if (entry.headroomKw != null && entry.headroomKw < 0) over.add(id);
    meterView?.showOver(over);
    runCount += 1;
  }

  const meterById = (id) => meters?.meters.find((m) => m.id === id);
  const plugsOf = (meterId) =>
    plugMap.plugs.filter((plug) => plug.meterId === meterId);

  /** Work out the power on every line and plug at the current step. */
  function energize() {
    if (!meters || !network || !gridView) return;
    const meterKw = new Map(
      meters.meters.map((m) => [m.id, meterKwAt(m, allocation, result, step)]),
    );
    readings = new Map();
    const rackKw = new Map();
    for (const meter of meters.meters) {
      const plugs = plugsOf(meter.id);
      if (!plugs.length) continue;
      for (const [id, reading] of plugTelemetry(
        plugs,
        step,
        meterKw.get(meter.id),
      )) {
        readings.set(id, reading);
        const rack = reading.plug.gangId;
        rackKw.set(rack, (rackKw.get(rack) ?? 0) + reading.kw);
      }
    }
    flows = networkFlows(network, { meterKw, frame, rackKw });
    gridView.showFlows(flows);
    gridView.showPlugs(readings);
  }

  function cardFor(target) {
    if (!frame || !target) return null;
    if (target.kind === 'port') return meters ? portCard(meters) : null;
    if (target.kind === 'meter') {
      const meter = meterById(target.meterId);
      return meter
        ? meterCard(meter, {
            scenario: meterScenarioAt(allocation, meter.id, step),
            sample: meters.sample,
          })
        : null;
    }
    if (target.kind === 'plug') {
      const reading = readings.get(target.id);
      if (!reading) return null;
      const meter = meterById(reading.plug.meterId);
      const rack = [...readings.values()].filter(
        (r) => r.plug.gangId === reading.plug.gangId,
      );
      return plugCard(reading, {
        meterLabel: meter.label,
        kwhToday: plugKwhToday(plugsOf(meter.id), target.id, step, (at) =>
          meterKwAt(meter, allocation, result, at),
        ),
        rackKw: rack.reduce((acc, r) => acc + r.kw, 0),
      });
    }
    if (target.kind === 'edge' || target.kind === 'node')
      return network ? networkCard(network, flows, meters, target) : null;
    if (target.kind === 'asset') return assetCard(target.asset, assets);
    if (target.kind === 'structure') return structureCard(target.item);
    if (target.kind === 'ship') return shipCard(frame, result, vessels);
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

  /** Hand the names of what is showing to the app's world overlay. */
  function publishNames() {
    if (!overlayHost) return;
    const name = (id, item, accent, priority) => ({
      id,
      source: TWIN_OVERLAY_SOURCE_ID,
      position: Cesium.Cartesian3.fromDegrees(
        item.lon,
        item.lat,
        (item.height ?? 10) + 4,
      ),
      variant: 'card',
      title: item.text,
      details: [],
      accent,
      priority,
      collisionGroup: 'ambient-card',
      zIndex: 30,
      interactive: false,
      minDistance: 0,
      maxDistance: NAME_MAX_DISTANCE_M,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 10,
      placement: 'above',
    });
    const entries = [];
    if (layers.equipment)
      for (const item of view?.labels() ?? [])
        entries.push(name(`mark:${item.id}`, item, '#20e7f2', 200));
    if (layers.assets)
      for (const item of assetView?.labels() ?? [])
        entries.push(name(`asset:${item.id}`, item, '#ffd166', 60));
    if (layers.meters)
      for (const item of meterView?.labels() ?? [])
        entries.push(name(`meter:${item.id}`, item, '#ffd166', 100));
    overlayHost.setEntries(TWIN_OVERLAY_SOURCE_ID, entries);
  }

  /** Show or hide the ship, cranes and trucks as one layer. */
  function showEquipment() {
    if (layers.equipment) return;
    for (const entity of dataSource.entities.values)
      if (entity.id.startsWith(TWIN_ENTITY_PREFIX)) entity.show = false;
  }

  function drawUsage() {
    if (!meters || !layers.graph) {
      usage?.destroy();
      usage = null;
      return;
    }
    usage ??= createUsageChart();
    const profile = dayProfile(meters, allocation, result, step);
    const peak = driver?.months[result.calendar[step].month - 1];
    const onThisDay =
      driver?.billed &&
      peak &&
      peak.step >= profile.dayStart &&
      peak.step < profile.dayStart + STEPS_PER_DAY;
    usage.show(profile, runCount, {
      demandStepOfDay: onThisDay ? peak.step - profile.dayStart : null,
    });
  }

  function render(reason) {
    frame = twinFrame(result, step);
    view.showFrame(frame, { shorePower: result.scenario.shorePower });
    showEquipment();
    panel.showFrame(frame);
    energize();
    if (selected)
      panel.showCard(cardFor(selected.target), selected.x, selected.y);
    drawUsage();
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
    result = runScenario(scenario);
    if (!baseline) baseline = runScenario(baselineScenario(library));
    step = Math.min(step, result.siteKw.length - 1);
    stepFloat = Math.min(stepFloat, result.siteKw.length - 1);
    driver = demandDriver(result, HUENEME_REGISTRY.specs);
    allocate();
    showScenario();
    panel.showScoreboard(scoreboard(result, baseline));
    panel.showDriver(driver);
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
    const driving = view.tick(seconds);
    const flowing = gridView?.tick(seconds) ?? false;
    if (driving || flowing || playing) requestRender('port-twin-anim');
  }

  function identify(entityId) {
    const meterId = meterView?.identify(entityId);
    if (meterId) return { kind: 'meter', meterId };
    const grid = gridView?.identify(entityId);
    if (grid) return grid;
    const unit = view.identify(entityId);
    if (unit) return unit;
    const asset = assetView?.identify(entityId);
    if (asset) return { kind: 'asset', asset };
    const item = siteView?.identify(entityId);
    return item ? { kind: 'structure', item } : null;
  }

  function onClick(movement) {
    const picked = viewer.scene.pick(movement.position);
    const target = identify(picked?.id?.id);
    if (!target) return;
    selected = { target, x: movement.position.x, y: movement.position.y };
    const rect = viewer.canvas.getBoundingClientRect();
    selected.x += rect.left;
    selected.y += rect.top;
    panel.showCard(cardFor(target), selected.x, selected.y);
  }

  function setLayer(id, on) {
    if (!(id in layers)) return;
    layers[id] = on;
    if (!active) return;
    if (id === 'equipment') {
      if (on)
        for (const entity of dataSource.entities.values)
          if (entity.id.startsWith(TWIN_ENTITY_PREFIX)) entity.show = true;
      publishNames();
      render('port-twin-layer');
      return;
    }
    if (id === 'structures' || id === 'roads') siteView?.setVisible(id, on);
    if (id === 'assets') {
      assetView?.setVisible(on);
      publishNames();
    }
    if (id === 'grid') gridView?.setLinesVisible(on);
    if (id === 'plugs') gridView?.setPlugsVisible(on);
    if (id === 'meters') {
      meterView?.setVisible(on);
      publishNames();
    }
    if (id === 'map') mapSwitch?.set(on);
    if (id === 'graph') drawUsage();
    requestRender('port-twin-layer');
  }

  function activate() {
    if (active || !viewer) return;
    active = true;
    session += 1;
    const mine = session;
    const stillMine = () => active && session === mine;
    panel.setActive(true);
    view = createTwinView(dataSource, layout);
    mapSwitch = createMapSwitch(viewer);
    if (!layers.map) mapSwitch.set(false);
    library = readLibrary(browserStorage());
    result = runScenario(scenario);
    baseline ??= runScenario(baselineScenario(library));
    driver = demandDriver(result, HUENEME_REGISTRY.specs);
    showScenario();
    // Open an hour into the first reefer call of the year.
    step = nextCallStart(result, -1, 1) + STEPS_PER_HOUR;
    stepFloat = step;
    panel.showScoreboard(scoreboard(result, baseline));
    panel.showDriver(driver);
    render('port-twin-enable');
    publishNames();
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    lastTime = 0;
    raf = requestAnimationFrame(loop);
    // Meters and the site map arrive after the twin is up; skip them if it
    // was switched off meanwhile.
    Promise.resolve(loadMeters())
      .then((registry) => {
        if (!stillMine() || !registry) return;
        meters = registry;
        meterView = createMeterView(dataSource, registry);
        meterView.setVisible(layers.meters);
        plugMap = plugLayout(registry);
        network = buildNetwork(registry, layout, plugMap);
        gridView = createNetworkView(dataSource, network, plugMap);
        gridView.setLinesVisible(layers.grid);
        gridView.setPlugsVisible(layers.plugs);
        panel.showMeters(registry);
        publishNames();
        allocate();
        render('port-twin-meters');
        // Port assets: the public seed plus any private overlay, whose meter
        // links are checked against the meters just loaded.
        return loadAssets({ meterIds: registry.meters.map((m) => m.id) });
      })
      .then((registry) => {
        if (!stillMine() || !registry) return;
        assets = registry;
        assetView = createAssetView(dataSource, registry);
        assetView.setVisible(layers.assets);
        publishNames();
        requestRender('port-twin-assets');
      });
    Promise.resolve(loadSiteMap()).then((site) => {
      if (!stillMine() || !site) return;
      siteView = createSiteView(dataSource, site);
      siteView.setVisible('structures', layers.structures);
      siteView.setVisible('roads', layers.roads);
      requestRender('port-twin-site');
    });
  }

  function deactivate() {
    if (!active) return;
    active = false;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    handler?.destroy();
    handler = null;
    usage?.destroy();
    usage = null;
    mapSwitch?.set(true);
    mapSwitch = null;
    overlayHost?.clearSource(TWIN_OVERLAY_SOURCE_ID);
    // Everything the twin drew, whichever view drew it.
    const entities = dataSource?.entities;
    if (entities)
      for (const entity of [...entities.values])
        if (OWN_PREFIXES.some((prefix) => entity.id.startsWith(prefix)))
          entities.remove(entity);
    view = null;
    meterView = null;
    gridView = null;
    siteView = null;
    assetView = null;
    assets = null;
    meters = null;
    allocation = null;
    network = null;
    plugMap = null;
    flows = null;
    readings = new Map();
    playing = false;
    selected = null;
    panel?.showCard(null);
    panel?.setPlaying(false);
    panel?.setActive(false);
    requestRender('port-twin-off');
  }

  return {
    /** Mount on a viewer, drawing into the given data source. */
    enable(nextViewer, nextDataSource) {
      viewer = nextViewer;
      dataSource = nextDataSource;
      if (!vessels)
        loadVesselInventory().then((inventory) => {
          vessels = inventory;
        });
      panel = createTwinPanel(
        {
          onActive(on) {
            if (on) activate();
            else deactivate();
          },
          onOpen: activate,
          onLayer: setLayer,
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
          onPortCard(x, y) {
            selected = { target: { kind: 'port' }, x, y };
            panel.showCard(cardFor(selected.target), x, y);
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
      showScenario();
      // With the controls already in view the twin starts straight away;
      // tucked in the menu, it waits to be opened. A scenario that came in
      // the page link is what the visitor asked to see, so it starts too.
      if (panel.isOpen() || linked) activate();
    },
    disable() {
      deactivate();
      panel?.destroy();
      panel = null;
      dataSource = null;
      viewer = null;
    },
    activate,
    deactivate,
    setLayer,
    isActive: () => active,
    /** Current scenario result, for tests and the console. */
    getResult: () => result,
    getScenario: () => scenario,
    getDecisions: () => decisionsFromScenario(scenario),
    /** Play a scenario from outside (the builder, tests, the console). */
    setScenario(next) {
      linked = normalizeScenario(next);
      if (panel && active) pick(LINK_ID);
      else {
        scenario = linked;
        activeId = LINK_ID;
        baseline = null;
        if (panel) showScenario();
      }
    },
    getMeters: () => meters,
    getAllocation: () => allocation,
    getNetwork: () => network,
    getDriver: () => driver,
  };
}
