/**
 * /scenarios: the Port of Hueneme scenario builder.
 *
 * Every input the engine takes is editable here. A scenario can be saved
 * under a name in this browser, set as the baseline, compared side by side
 * with others, shared as a link or a file, and opened on the 3D twin.
 */
import './scenarios.css';
import { lineChart, stackedBars } from './charts.js';
import { CHARGING_STRATEGIES } from '../fleetSim.js';
import { FACTORS } from '../hueneme.js';
import { rollup } from '../rollups.js';
import { runScenario } from '../scenario.js';
import {
  CALL_TYPES,
  SCENARIO_PARAM,
  TWIN_PATH,
  YEAR_RANGE,
  baselineScenario,
  billsCsv,
  compareRuns,
  encodeScenario,
  exportScenarioJson,
  importScenarioJson,
  loadCsv,
  normalizeScenario,
  paybackYears,
  planMix,
  readLibrary,
  removeFromLibrary,
  saveToLibrary,
  scenarioFromSearch,
  scenarioLink,
  uniqueName,
  writeLibrary,
} from '../scenarioStore.js';
import { TARIFFS } from '../tariffs.js';
import { STEPS_PER_DAY } from '../touCalendar.js';

const MAX_COMPARED = 4;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const moneyShort = (v) =>
  v >= 1e6
    ? `$${(v / 1e6).toFixed(2)}M`
    : v >= 1e3
      ? `$${(v / 1e3).toFixed(0)}k`
      : `$${Math.round(v)}`;
const num = (v, digits = 0) =>
  Number(v).toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const kw = (v) => `${num(v)} kW`;
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

const app = document.getElementById('app');
app.innerHTML = `
<div class="portos-wrap">
  <header>
    <div>
      <h1>Port of Hueneme scenario builder</h1>
      <p class="sub">Set the fleet, the rate, charging, a battery and shore power. Save scenarios, compare them, and play any of them on the 3D port.</p>
    </div>
    <a href="${TWIN_PATH}">Open the port on the globe</a>
  </header>
  <section class="card bar" aria-label="Scenario">
    <div class="bar-row">
      <label for="saved">Saved</label>
      <select id="saved"></select>
      <label for="name">Name</label>
      <input type="text" id="name" maxlength="80" />
      <button type="button" id="save" class="primary">Save</button>
      <button type="button" id="saveAs">Save as new</button>
      <button type="button" id="baseline">Set as baseline</button>
      <button type="button" id="remove">Delete</button>
    </div>
    <div class="bar-row">
      <a class="button primary" id="globe" href="${TWIN_PATH}">Run on the 3D port</a>
      <button type="button" id="share">Copy share link</button>
      <button type="button" id="exportJson">Export scenario</button>
      <button type="button" id="importJson">Import scenario</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden />
      <button type="button" id="csvBills">Monthly bills CSV</button>
      <button type="button" id="csvLoad">15-minute load CSV</button>
      <span class="status" id="status" role="status"></span>
    </div>
  </section>
  <div class="portos-layout">
    <form class="card controls" id="controls" autocomplete="off">
      <h2>Inputs</h2>
      <div class="row2">
        <div><label for="year">Year</label><select id="year"></select></div>
        <div><label for="seed" title="Changes which days the synthetic ship calls land on">Schedule variation</label><input type="number" id="seed" min="1" max="999999" step="1" /></div>
      </div>
      <label for="scale">Call volume <span class="value" id="scaleValue"></span></label>
      <input type="range" id="scale" min="0.25" max="3" step="0.05" />
      <fieldset>
        <legend>Equipment</legend>
        <p class="hint">Units on hand. Blank rows follow the fleet plan for the year.</p>
        <table class="fleet" id="fleetTable"></table>
        <label class="inline"><input type="checkbox" id="fillGap" /> Add diesel units when a crew cannot be staffed</label>
      </fieldset>
      <fieldset>
        <legend>Charging</legend>
        <label for="strategy">Rule</label>
        <select id="strategy"></select>
        <div class="row2">
          <div><label for="reserve">Reserve before work (%)</label><input type="number" id="reserve" min="0" max="90" step="5" /></div>
          <div><label for="efficiency">Charger efficiency (%)</label><input type="number" id="efficiency" min="50" max="100" step="1" /></div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Electricity</legend>
        <label for="tariff">Rate</label>
        <select id="tariff"></select>
        <label class="inline"><input type="checkbox" id="deferred" /> Bill TOU-EV demand charges (if the CPUC turns them on)</label>
        <label for="baseLoad">Buildings and other load, flat (kW)</label>
        <input type="number" id="baseLoad" min="0" max="100000" step="10" />
      </fieldset>
      <fieldset>
        <legend>Shore power</legend>
        <label class="inline"><input type="checkbox" id="shore" /> Ships plug in at berths 1-3</label>
        <div id="shoreTypes" class="checks"></div>
      </fieldset>
      <fieldset>
        <legend>Site battery</legend>
        <div class="row2">
          <div><label for="batKwh">Energy (kWh)</label><input type="number" id="batKwh" min="0" step="100" /></div>
          <div><label for="batKw">Power (kW)</label><input type="number" id="batKw" min="0" step="50" /></div>
        </div>
        <div class="row2">
          <div><label for="batRte">Round trip (%)</label><input type="number" id="batRte" min="50" max="100" step="1" /></div>
          <div><label for="batThreshold" title="The meter level the battery holds. Blank finds the lowest level it can hold all year.">Hold meter at (kW)</label><input type="number" id="batThreshold" min="0" step="10" placeholder="auto" /></div>
        </div>
      </fieldset>
      <button type="button" id="reset" class="wide">Reset to the fleet plan</button>
    </form>
    <div class="stack" id="results">
      <div class="kpis" id="kpis"></div>
      <section class="card" id="compare">
        <div class="chart-head">
          <h2>Compare</h2>
          <span class="sub" id="compareNote"></span>
        </div>
        <div class="checks" id="comparePick"></div>
        <div class="table-wrap"><table id="compareTable"></table></div>
        <div class="legend" id="compareLegend"></div>
        <div class="chart" id="compareChart"></div>
      </section>
      <section class="card">
        <div class="chart-head">
          <h2>Meter load, 15-minute</h2>
          <div class="inline-select">
            <label for="week">Week</label>
            <input type="number" id="week" min="1" max="52" step="1" />
            <button type="button" id="peakWeek">Peak week</button>
          </div>
        </div>
        <div class="legend" id="loadLegend"></div>
        <div class="chart" id="loadChart"></div>
      </section>
      <section class="card">
        <div class="chart-head">
          <h2>Monthly electricity bill</h2>
          <div class="legend">
            <span style="--swatch: var(--series-1)">Energy and customer charge</span>
            <span style="--swatch: var(--series-2)">Demand charges</span>
          </div>
        </div>
        <div class="chart" id="billChart"></div>
        <div class="table-wrap"><table id="billTable"></table></div>
      </section>
      <section class="card">
        <div class="chart-head">
          <h2>Profile by period</h2>
          <div class="inline-select">
            <label for="grain">Group by</label>
            <select id="grain">
              <option value="week">Week</option>
              <option value="month" selected>Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </div>
        </div>
        <div class="table-wrap"><table id="rollupTable"></table></div>
      </section>
      <section class="card">
        <h2>Equipment results</h2>
        <div class="table-wrap"><table id="fleetResults"></table></div>
      </section>
      <section class="card">
        <h2>Assumptions to replace</h2>
        <ul class="notes" id="notes"></ul>
      </section>
    </div>
  </div>
</div>`;

const $ = (id) => document.getElementById(id);
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const PLAN_NAME = 'New scenario';

let library = readLibrary(storage);
let draft =
  scenarioFromSearch(location.search) ?? normalizeScenario({ name: PLAN_NAME });
// The saved entry the draft was loaded from or last saved to, if any.
let activeId =
  library.items.find(
    (item) => encodeScenario(item.scenario) === encodeScenario(draft),
  )?.id ?? null;
const view = { week: null, compared: new Set() };
let result = null;

for (let y = YEAR_RANGE[0]; y <= YEAR_RANGE[1]; y += 1)
  $('year').add(new Option(String(y), String(y)));
for (const [key, rule] of Object.entries(CHARGING_STRATEGIES))
  $('strategy').add(new Option(rule.label, key));
for (const tariff of Object.values(TARIFFS))
  $('tariff').add(new Option(tariff.name, tariff.id));
$('shoreTypes').innerHTML = CALL_TYPES.map(
  (type) =>
    `<label class="inline"><input type="checkbox" data-shore-type="${esc(type)}" /> ${esc(type)}</label>`,
).join('');

// ---- runs, cached so comparing does not re-run unchanged scenarios ---------

const cache = new Map();
function runCached(scenario) {
  const key = encodeScenario({ ...scenario, name: '' });
  let hit = cache.get(key);
  if (!hit) {
    hit = runScenario(scenario);
    cache.set(key, hit);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
  }
  return hit;
}

const isDirty = () => {
  const saved = library.items.find((item) => item.id === activeId);
  return !saved || encodeScenario(saved.scenario) !== encodeScenario(draft);
};

function say(text, tone = '') {
  $('status').textContent = text;
  $('status').className = `status ${tone}`;
}

const volume = $('scale');
function showVolume(fraction) {
  const percent = Math.round(fraction * 100);
  $('scaleValue').textContent = `${percent}% of the 2021-23 average`;
}

// ---- form ------------------------------------------------------------------

function syncBar() {
  const saved = $('saved');
  saved.replaceChildren(
    new Option(activeId ? 'New from the fleet plan' : 'Unsaved scenario', ''),
    ...library.items.map(
      (item) =>
        new Option(
          `${item.scenario.name}${item.id === library.baselineId ? ' (baseline)' : ''}`,
          item.id,
        ),
    ),
  );
  saved.value = activeId ?? '';
  if (document.activeElement !== $('name')) $('name').value = draft.name;
  const dirty = isDirty();
  $('save').textContent = activeId && dirty ? 'Save changes' : 'Save';
  $('save').disabled = Boolean(activeId) && !dirty;
  $('remove').disabled = !activeId;
  $('baseline').disabled = !activeId;
  $('baseline').textContent =
    activeId && activeId === library.baselineId
      ? 'Clear baseline'
      : 'Set as baseline';
  $('globe').href = scenarioLink(draft, TWIN_PATH);
  const url = new URL(location.href);
  url.searchParams.set(SCENARIO_PARAM, encodeScenario(draft));
  history.replaceState(null, '', url.href);
}

function syncForm() {
  $('year').value = String(draft.year);
  $('seed').value = String(draft.seed);
  volume.value = String(draft.callScale);
  showVolume(draft.callScale);
  $('fillGap').checked = draft.fillGapWithDiesel;
  $('strategy').value = draft.strategy;
  $('reserve').value = String(Math.round(draft.reserve * 100));
  $('efficiency').value = String(Math.round(draft.chargerEfficiency * 100));
  $('tariff').value = draft.tariffId;
  $('deferred').checked = draft.includeDeferredDemand;
  $('deferred').disabled = TARIFFS[draft.tariffId].demand.billed;
  $('baseLoad').value = String(draft.baseLoadKw);
  $('shore').checked = draft.shorePower;
  for (const box of $('shoreTypes').querySelectorAll('input')) {
    box.checked = draft.shorePowerTypes.includes(box.dataset.shoreType);
    box.disabled = !draft.shorePower;
  }
  const b = draft.battery;
  // Energy and power are typed one after the other; until both are set
  // there is no battery, and the half-typed value has to stay in its box.
  if (b) {
    $('batKwh').value = String(b.kwh);
    $('batKw').value = String(b.kw);
  }
  $('batRte').value = String(
    Math.round((b?.roundTripEfficiency ?? 0.88) * 100),
  );
  $('batThreshold').value =
    b && b.thresholdKw !== 'auto' ? String(b.thresholdKw) : '';
}

/** Editable units on hand, one row per equipment type the crews use. */
function renderFleetInputs() {
  const rows = Object.entries(result.fleets)
    .map(([specId, f]) => {
      const custom = Boolean(draft.fleet[specId]);
      const source = custom
        ? `<button type="button" class="link" data-reset="${specId}" title="Follow the fleet plan again">reset</button>`
        : `<span class="tag">${planMix(draft.year, specId) ? 'plan' : 'auto'}</span>`;
      const cell = (field, value, max) =>
        `<td><input type="number" min="0" max="${max}" step="1" value="${value}" data-spec="${specId}" data-field="${field}" aria-label="${esc(f.label)} ${field}" /></td>`;
      return `<tr><th scope="row">${esc(f.label.replace(/ \(.*\)$/, ''))}<br />${source}${f.gapUnits ? ` <span class="warn" title="Diesel units added because the crews need more than the fleet has">+${f.gapUnits} gap</span>` : ''}</th>${cell('electric', f.electric, 200)}${cell('diesel', f.diesel - f.gapUnits, 200)}${cell('chargers', f.chargers, 400)}</tr>`;
    })
    .join('');
  $('fleetTable').innerHTML =
    `<thead><tr><th></th><th>Electric</th><th>Diesel</th><th>Chargers</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderFleetResults() {
  const rows = Object.values(result.fleets)
    .map(
      (f) =>
        `<tr><td>${esc(f.label)}</td><td>${f.peakDemand}</td><td>${num(f.electricHours)}</td><td>${num(f.dieselHours)}</td><td>${num(f.kwh)}</td><td>${kw(f.peakKw)}</td><td>${num(f.dieselGallons)}</td><td>${num(f.co2Tonnes)}</td><td class="${f.unmetHours ? 'warn' : ''}">${num(f.unmetHours)}</td></tr>`,
    )
    .join('');
  $('fleetResults').innerHTML =
    `<thead><tr><th>Equipment</th><th>Most needed at once</th><th>Electric hours</th><th>Diesel hours</th><th>Grid kWh</th><th>Peak kW</th><th>Diesel gal</th><th>CO2 t</th><th>Uncovered hours</th></tr></thead><tbody>${rows}</tbody>`;
}

// ---- compare ---------------------------------------------------------------

function renderCompare() {
  const base = baselineScenario(library);
  const baseRun = runCached(base);
  const others = library.items.filter((item) => item.id !== library.baselineId);
  const picked = others.filter((item) => view.compared.has(item.id));
  const columns = [
    { name: isDirty() ? `${draft.name} (editing)` : draft.name, run: result },
    ...picked
      .filter((item) => item.id !== activeId || isDirty())
      .map((item) => ({
        name: item.scenario.name,
        run: runCached(item.scenario),
      })),
  ];
  $('compareNote').textContent = `Against the baseline: ${base.name}`;
  $('comparePick').innerHTML = others.length
    ? others
        .map(
          (item) =>
            `<label class="inline"><input type="checkbox" data-compare="${item.id}" ${view.compared.has(item.id) ? 'checked' : ''} ${!view.compared.has(item.id) && view.compared.size >= MAX_COMPARED ? 'disabled' : ''} /> ${esc(item.scenario.name)}</label>`,
        )
        .join('')
    : '<span class="hint">Save scenarios to line them up here. The one you are editing is always shown.</span>';
  const table = compareRuns(
    baseRun,
    columns.map((column) => column.run),
  );
  const show = (metric, value) =>
    metric.unit === '$' ? money(value) : `${num(value)} ${metric.unit}`;
  const delta = (metric, cell) =>
    Math.abs(cell.delta) < 0.5
      ? ''
      : `<small class="${cell.tone}">${cell.delta > 0 ? '+' : '−'}${show(metric, Math.abs(cell.delta))}</small>`;
  const payback = columns.map((column) => {
    const years = paybackYears(baseRun, column.run);
    return `<td>${years == null ? '—' : `${num(years, 1)} yr`}</td>`;
  });
  $('compareTable').innerHTML =
    `<thead><tr><th></th><th>${esc(base.name)}<br /><small>baseline</small></th>${columns.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${table
      .map(
        (row) =>
          `<tr><td>${row.label}</td><td>${show(row, row.base)}</td>${row.cells.map((cell) => `<td>${show(row, cell.value)}${delta(row, cell)}</td>`).join('')}</tr>`,
      )
      .join(
        '',
      )}<tr><td title="Extra ZE equipment cost divided by yearly energy savings, against the baseline">Simple payback</td><td>—</td>${payback.join('')}</tr></tbody>`;
  const series = [
    { name: `${base.name} (baseline)`, run: baseRun },
    ...columns,
  ].map((column, i) => ({
    label: column.name,
    color: SERIES[i % SERIES.length],
    values: column.run.bills.map((bill) => bill.total),
  }));
  $('compareLegend').innerHTML = series
    .map((s) => `<span style="--swatch: ${s.color}">${esc(s.label)}</span>`)
    .join('');
  lineChart($('compareChart'), {
    series,
    labels: MONTHS.map((month) => `${month} electricity bill`),
    tickEvery: 1,
    format: moneyShort,
  });
}

function kpi(label, value, note = '') {
  return `<div class="card kpi"><div class="label">${label}</div><div class="num">${value}</div><div class="note">${note}</div></div>`;
}

function renderKpis() {
  const t = result.totals;
  const utr = result.fleets.utr;
  $('kpis').innerHTML = [
    kpi(
      'Electricity per year',
      moneyShort(t.electricityCost),
      `${moneyShort(t.demandCost)} of it demand charges`,
    ),
    kpi(
      'Meter peak',
      kw(t.peakKw),
      result.battery
        ? `${kw(t.peakKwWithoutBattery)} without the battery`
        : 'highest 15-minute demand',
    ),
    kpi(
      'UTR charging energy',
      `${num(utr.kwh / 1000)} MWh`,
      `${num(utr.electricHours)} BEV hours worked`,
    ),
    kpi(
      'Diesel, all equipment',
      `${num(t.dieselGallons / 1000, 1)}k gal`,
      `${moneyShort(t.dieselCost)} at $${FACTORS.dieselDollarsPerGallon}/gal`,
    ),
    kpi(
      'Diesel CO2',
      `${num(t.co2Tonnes)} t`,
      `${num(utr.co2Tonnes)} t from UTRs`,
    ),
    result.battery
      ? kpi(
          'Battery savings',
          moneyShort(t.batterySavings),
          `holds the meter at ${kw(result.battery.thresholdKw)}`,
        )
      : kpi(
          'UTR hours uncovered',
          num(utr.unmetHours),
          utr.unmetHours
            ? 'fleet too small or flat batteries'
            : 'every crew fully staffed',
        ),
  ].join('');
}

function peakWeek() {
  let peak = -1;
  let at = 0;
  for (let i = 0; i < result.meterKw.length; i += 1)
    if (result.meterKw[i] > peak) {
      peak = result.meterKw[i];
      at = i;
    }
  return Math.min(52, Math.floor(result.calendar[at].dayIndex / 7) + 1);
}

function renderLoad() {
  const week = view.week ?? peakWeek();
  $('week').value = String(week);
  const start = (week - 1) * 7 * STEPS_PER_DAY;
  const end = Math.min(result.meterKw.length, start + 7 * STEPS_PER_DAY);
  const labels = [];
  for (let i = start; i < end; i += 1) {
    const s = result.calendar[i];
    labels.push(
      `${DAYS[s.dow]} ${MONTHS[s.month - 1]} ${s.day}, ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} (${result.periods[i].replace('_', '-')}-peak)`,
    );
  }
  const series = [
    {
      label: 'Site load',
      color: 'var(--series-1)',
      values: result.siteKw.subarray(start, end),
    },
  ];
  if (result.battery)
    series.push({
      label: 'At the meter, with battery',
      color: 'var(--series-2)',
      values: result.meterKw.subarray(start, end),
    });
  $('loadLegend').innerHTML =
    series.length > 1
      ? series
          .map((s) => `<span style="--swatch: ${s.color}">${s.label}</span>`)
          .join('')
      : '';
  lineChart($('loadChart'), {
    series,
    labels,
    tickEvery: STEPS_PER_DAY,
    format: kw,
  });
}

function renderBills() {
  const bills = result.bills;
  stackedBars($('billChart'), {
    categories: MONTHS,
    stacks: [
      {
        label: 'Energy and customer charge',
        color: 'var(--series-1)',
        values: bills.map((b) => b.total - b.demandCost),
      },
      {
        label: 'Demand charges',
        color: 'var(--series-2)',
        values: bills.map((b) => b.demandCost),
      },
    ],
    format: moneyShort,
  });
  const rows = bills
    .map(
      (b) =>
        `<tr><td>${MONTHS[b.month - 1]}</td><td>${num(b.kwh)}</td><td>${kw(b.maxKw)}</td><td>${money(b.energyCost)}</td><td>${money(b.demandCost)}</td><td>${money(b.total)}</td></tr>`,
    )
    .join('');
  const t = result.totals;
  $('billTable').innerHTML =
    `<thead><tr><th>Month</th><th>kWh</th><th>Max demand</th><th>Energy</th><th>Demand</th><th>Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Year</th><th>${num(t.kwh)}</th><th>${kw(t.peakKw)}</th><th>${money(t.energyCost)}</th><th>${money(t.demandCost)}</th><th>${money(t.electricityCost)}</th></tr></tfoot>`;
}

function renderRollup() {
  const grain = $('grain').value;
  const rows = rollup(
    result.calendar,
    { kw: result.meterKw, dieselGallons: result.dieselGallons },
    grain,
  );
  const name = (row) =>
    grain === 'month'
      ? MONTHS[row.index]
      : grain === 'quarter'
        ? `Q${row.index + 1}`
        : grain === 'week'
          ? `Week ${row.index + 1}`
          : String(draft.year);
  $('rollupTable').innerHTML =
    `<thead><tr><th>${grain[0].toUpperCase()}${grain.slice(1)}</th><th>kWh</th><th>Peak kW</th><th>Diesel gal</th><th>Diesel CO2 t</th></tr></thead><tbody>${rows
      .map(
        (row) =>
          `<tr><td>${name(row)}</td><td>${num(row.kwh)}</td><td>${num(row.peakKw)}</td><td>${num(row.dieselGallons)}</td><td>${num((row.dieselGallons * FACTORS.dieselKgCo2PerGallon) / 1000, 1)}</td></tr>`,
      )
      .join('')}</tbody>`;
}

function renderNotes() {
  const tariff = result.tariff;
  const notes = [
    `${result.totals.calls} vessel calls are synthesized from the 2021-23 workbook averages by vessel type (no real schedule is shown). Recorded calls from the live event log will replace them.`,
    `Rate: ${tariff.name}. ${tariff.status}. Source: ${tariff.source}.`,
    'Winter super-off-peak is modeled as 8 a.m. to 4 p.m.; the start hour still needs confirming in the SCE tariff book.',
    'Equipment specs, crew templates, fleet plan and capex come from the POH Utilization Model (V23MFE), except the harbor cranes.',
    'The port has four Liebherr mobile harbor cranes. Each draws 322.5 kWh per working hour: the LHM 420 Litronic 750 kW rating times a 0.43 crane load factor. Plug-in hybrids draw from the meter while working. The 2023 inventory has three plug-in hybrids and one diesel crane; the fleet plan replaces the diesel crane in 2024.',
    'Light-duty vehicles and Class IV forklifts are not in the fleet plan, so they default to diesel units sized to demand until you set a count.',
    'ZE equipment cost in the comparison is the electric units beyond the 2023 fleet at workbook unit costs (capital less CORE voucher, plus charging infrastructure). The site battery has no cost in the workbook and is not priced.',
    `Charger efficiency ${Math.round(draft.chargerEfficiency * 100)}%; a unit that runs flat charges back to ${Math.round(draft.reserve * 100)}% before returning to work. Diesel CO2 uses ${FACTORS.dieselKgCo2PerGallon} kg per gallon (EPA).`,
    draft.baseLoadKw
      ? `Buildings are a flat ${num(draft.baseLoadKw)} kW around the clock until utility bills are entered; the meter is a single placeholder service.`
      : 'Building loads are zero until utility bills are entered; the meter here is a single placeholder service for CHE charging.',
  ];
  $('notes').replaceChildren(
    ...notes.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function render() {
  renderKpis();
  renderFleetInputs();
  renderCompare();
  renderLoad();
  renderBills();
  renderRollup();
  renderFleetResults();
  renderNotes();
}

let pending = 0;
function run() {
  draft = normalizeScenario(draft);
  syncBar();
  syncForm();
  $('results').classList.add('busy');
  const ticket = ++pending;
  // Let the busy state paint before the synchronous year-long run.
  setTimeout(() => {
    if (ticket !== pending) return;
    result = runCached(draft);
    render();
    $('results').classList.remove('busy');
  }, 16);
}

function clearBatteryBoxes() {
  $('batKwh').value = '0';
  $('batKw').value = '0';
}

function load(scenario, id = null) {
  draft = normalizeScenario(scenario);
  clearBatteryBoxes();
  activeId = id;
  view.week = null;
  run();
}

function persist(message) {
  if (writeLibrary(storage, library)) say(message, 'ok');
  else
    say(
      'This browser would not store it. Use Copy share link or Export instead.',
      'bad',
    );
}

const numberOf = (id, fallback = 0) => {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
};

function readBattery() {
  const kwh = Math.max(0, numberOf('batKwh'));
  const power = Math.max(0, numberOf('batKw'));
  if (!(kwh > 0 && power > 0)) return null;
  const hold = $('batThreshold').value.trim();
  return {
    kwh,
    kw: power,
    roundTripEfficiency: numberOf('batRte', 88) / 100,
    thresholdKw: hold === '' ? 'auto' : Math.max(0, Number(hold) || 0),
  };
}

$('controls').addEventListener('change', (event) => {
  const target = event.target;
  const { id } = target;
  say('');
  if (target.dataset.spec) {
    const specId = target.dataset.spec;
    const read = (field) =>
      Math.max(
        0,
        Math.round(
          Number(
            $('fleetTable').querySelector(
              `[data-spec="${specId}"][data-field="${field}"]`,
            ).value,
          ) || 0,
        ),
      );
    const before = result.fleets[specId];
    const electric = read('electric');
    // Chargers follow the electric count until they are set on their own.
    const chargers =
      target.dataset.field === 'electric' && before.chargers === before.electric
        ? electric
        : read('chargers');
    draft.fleet = {
      ...draft.fleet,
      [specId]: { electric, diesel: read('diesel'), chargers },
    };
  } else if (target.dataset.shoreType) {
    draft.shorePowerTypes = [...$('shoreTypes').querySelectorAll('input')]
      .filter((box) => box.checked)
      .map((box) => box.dataset.shoreType);
  } else if (id === 'year') draft.year = numberOf('year', draft.year);
  else if (id === 'seed') draft.seed = numberOf('seed', 1);
  else if (id === 'scale') draft.callScale = numberOf('scale', 1);
  else if (id === 'fillGap') draft.fillGapWithDiesel = $('fillGap').checked;
  else if (id === 'strategy') draft.strategy = $('strategy').value;
  else if (id === 'reserve') draft.reserve = numberOf('reserve', 30) / 100;
  else if (id === 'efficiency')
    draft.chargerEfficiency = numberOf('efficiency', 92) / 100;
  else if (id === 'tariff') {
    draft.tariffId = $('tariff').value;
    if (TARIFFS[draft.tariffId].demand.billed)
      draft.includeDeferredDemand = false;
  } else if (id === 'deferred')
    draft.includeDeferredDemand = $('deferred').checked;
  else if (id === 'baseLoad') draft.baseLoadKw = numberOf('baseLoad');
  else if (id === 'shore') draft.shorePower = $('shore').checked;
  else if (id.startsWith('bat')) draft.battery = readBattery();
  view.week = null;
  run();
});
volume.addEventListener('input', () => showVolume(Number(volume.value)));
$('controls').addEventListener('submit', (event) => event.preventDefault());
$('fleetTable').addEventListener('click', (event) => {
  const specId = event.target.dataset?.reset;
  if (!specId) return;
  const { [specId]: _dropped, ...rest } = draft.fleet;
  draft.fleet = rest;
  run();
});
$('reset').addEventListener('click', () => {
  load({ name: draft.name }, activeId);
  say('Inputs reset to the fleet plan.');
});

$('name').addEventListener('change', () => {
  draft.name = $('name').value.trim() || PLAN_NAME;
  run();
});
$('saved').addEventListener('change', () => {
  const item = library.items.find((entry) => entry.id === $('saved').value);
  if (item) load(item.scenario, item.id);
  else load({ name: PLAN_NAME });
  say('');
});
$('save').addEventListener('click', () => {
  if (!activeId) draft.name = uniqueName(library, draft.name);
  const saved = saveToLibrary(library, draft, activeId ?? undefined);
  library = saved.library;
  activeId = saved.id;
  persist(`Saved "${draft.name}" in this browser.`);
  run();
});
$('saveAs').addEventListener('click', () => {
  const name = uniqueName(
    library,
    activeId ? `Copy of ${draft.name}` : draft.name,
  );
  draft = { ...draft, name };
  const saved = saveToLibrary(library, draft);
  library = saved.library;
  activeId = saved.id;
  $('name').value = name;
  persist(`Saved as "${name}".`);
  run();
});
$('remove').addEventListener('click', () => {
  if (!activeId || !window.confirm(`Delete "${draft.name}" from this browser?`))
    return;
  view.compared.delete(activeId);
  library = removeFromLibrary(library, activeId);
  activeId = null;
  persist('Deleted. The inputs are still here if you want to save them again.');
  run();
});
$('baseline').addEventListener('click', () => {
  if (!activeId) return;
  library = {
    ...library,
    baselineId: library.baselineId === activeId ? null : activeId,
  };
  persist(
    library.baselineId
      ? `"${draft.name}" is now the baseline, here and on the 3D port.`
      : 'Baseline cleared. Comparisons use the fleet plan as it is today.',
  );
  run();
});
$('comparePick').addEventListener('change', (event) => {
  const id = event.target.dataset?.compare;
  if (!id) return;
  if (event.target.checked) view.compared.add(id);
  else view.compared.delete(id);
  if (result) renderCompare();
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileStem = () =>
  draft.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'scenario';

$('share').addEventListener('click', async () => {
  const link = scenarioLink(draft, TWIN_PATH, location.origin);
  try {
    await navigator.clipboard.writeText(link);
    say('Link copied. It opens this scenario on the 3D port.', 'ok');
  } catch {
    window.prompt('Copy this link', link);
  }
});
$('exportJson').addEventListener('click', () =>
  download(`${fileStem()}.json`, exportScenarioJson(draft), 'application/json'),
);
$('importJson').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  const scenario = importScenarioJson(await file.text());
  if (!scenario) {
    say('That file is not a scenario exported from this page.', 'bad');
    return;
  }
  load(scenario);
  say(`Loaded "${scenario.name}". Save it to keep it in this browser.`, 'ok');
});
$('csvBills').addEventListener(
  'click',
  () =>
    result && download(`${fileStem()}-bills.csv`, billsCsv(result), 'text/csv'),
);
$('csvLoad').addEventListener(
  'click',
  () =>
    result && download(`${fileStem()}-load.csv`, loadCsv(result), 'text/csv'),
);

$('week').addEventListener('change', () => {
  view.week = Math.min(52, Math.max(1, Number($('week').value) || 1));
  if (result) renderLoad();
});
$('peakWeek').addEventListener('click', () => {
  view.week = null;
  if (result) renderLoad();
});
$('grain').addEventListener('change', () => result && renderRollup());

clearBatteryBoxes();
run();
