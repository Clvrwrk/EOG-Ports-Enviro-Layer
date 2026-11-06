/**
 * /scenarios: the Port Environmental OS scenario simulator page.
 *
 * Phase 1 is a standalone page so it can ship without touching the globe.
 * Phase 2 adds the scenario builder's "Run in globe" hand-off to the GEV
 * simulation clock.
 */
import './scenarios.css';
import { lineChart, stackedBars } from './charts.js';
import { CHARGING_STRATEGIES } from '../fleetSim.js';
import { FACTORS, FLEET_PLAN } from '../hueneme.js';
import { rollup } from '../rollups.js';
import { DEFAULT_SCENARIO, runScenario } from '../scenario.js';
import { TARIFFS } from '../tariffs.js';
import { STEPS_PER_DAY } from '../touCalendar.js';

const UTR_FLEET = 27;
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

const app = document.getElementById('app');
app.innerHTML = `
<div class="portos-wrap">
  <header>
    <div>
      <h1>Port of Hueneme scenarios</h1>
      <p class="sub">Simulate UTRs as battery-electric or diesel, price the load on an SCE rate, and test a mobile battery against demand charges.</p>
    </div>
    <a href="/ports/california/port-of-hueneme">Open the port on the globe</a>
  </header>
  <div class="portos-layout">
    <form class="card controls" id="controls" autocomplete="off">
      <h2>Scenario</h2>
      <label for="year">Year</label>
      <select id="year" name="year"></select>
      <fieldset>
        <legend>UTR fleet</legend>
        <label for="bev">Battery-electric UTRs <span class="value" id="bevValue"></span></label>
        <input type="range" id="bev" name="bev" min="0" max="${UTR_FLEET}" step="1" />
        <label for="chargers">50 kW charger ports</label>
        <input type="number" id="chargers" name="chargers" min="0" max="60" step="1" />
        <label for="strategy">Charging</label>
        <select id="strategy" name="strategy"></select>
      </fieldset>
      <fieldset>
        <legend>Electricity</legend>
        <label for="tariff">Rate</label>
        <select id="tariff" name="tariff"></select>
        <label class="inline"><input type="checkbox" id="deferred" name="deferred" /> Bill TOU-EV demand charges (if the CPUC turns them on)</label>
        <label class="inline"><input type="checkbox" id="shore" name="shore" /> Shore power for reefer calls at berths 1-3</label>
      </fieldset>
      <fieldset>
        <legend>Mobile battery</legend>
        <div class="row2">
          <div><label for="batKwh">Energy (kWh)</label><input type="number" id="batKwh" name="batKwh" min="0" step="100" /></div>
          <div><label for="batKw">Power (kW)</label><input type="number" id="batKw" name="batKw" min="0" step="50" /></div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Vessel calls</legend>
        <label for="scale">Call volume <span class="value" id="scaleValue"></span></label>
        <input type="range" id="scale" name="scale" min="0.5" max="1.5" step="0.05" />
      </fieldset>
    </form>
    <div class="stack" id="results">
      <div class="kpis" id="kpis"></div>
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
        <h2>Equipment</h2>
        <div class="table-wrap"><table id="fleetTable"></table></div>
      </section>
      <section class="card">
        <h2>Assumptions to replace</h2>
        <ul class="notes" id="notes"></ul>
      </section>
    </div>
  </div>
</div>`;

const $ = (id) => document.getElementById(id);
const state = {
  year: DEFAULT_SCENARIO.year,
  bev: FLEET_PLAN[2026].utr[1],
  chargers: null,
  strategy: DEFAULT_SCENARIO.strategy,
  tariff: DEFAULT_SCENARIO.tariffId,
  deferred: false,
  shore: false,
  batKwh: 0,
  batKw: 0,
  scale: 1,
  week: null,
};

for (let y = 2023; y <= 2032; y += 1)
  $('year').add(new Option(String(y), String(y)));
for (const [key, rule] of Object.entries(CHARGING_STRATEGIES))
  $('strategy').add(new Option(rule.label, key));
for (const tariff of Object.values(TARIFFS))
  $('tariff').add(new Option(tariff.name, tariff.id));

function syncForm() {
  $('year').value = String(state.year);
  $('bev').value = String(state.bev);
  $('bevValue').textContent =
    `${state.bev} of ${UTR_FLEET} (${UTR_FLEET - state.bev} diesel)`;
  $('chargers').value = String(state.chargers ?? state.bev);
  $('strategy').value = state.strategy;
  $('tariff').value = state.tariff;
  $('deferred').checked = state.deferred;
  $('deferred').disabled = TARIFFS[state.tariff].demand.billed;
  $('shore').checked = state.shore;
  $('batKwh').value = String(state.batKwh);
  $('batKw').value = String(state.batKw);
  $('scale').value = String(state.scale);
  $('scaleValue').textContent =
    `${Math.round(state.scale * 100)}% of the 2021-23 average`;
}

let result = null;

function scenarioFromState() {
  return {
    year: state.year,
    tariffId: state.tariff,
    includeDeferredDemand: state.deferred,
    strategy: state.strategy,
    shorePower: state.shore,
    callScale: state.scale,
    fleet: {
      utr: {
        electric: state.bev,
        diesel: UTR_FLEET - state.bev,
        chargers: state.chargers ?? state.bev,
      },
    },
    battery:
      state.batKwh > 0 && state.batKw > 0
        ? { kwh: state.batKwh, kw: state.batKw, thresholdKw: 'auto' }
        : null,
  };
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
  const week = state.week ?? peakWeek();
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
          : String(state.year);
  $('rollupTable').innerHTML =
    `<thead><tr><th>${grain[0].toUpperCase()}${grain.slice(1)}</th><th>kWh</th><th>Peak kW</th><th>Diesel gal</th><th>Diesel CO2 t</th></tr></thead><tbody>${rows
      .map(
        (row) =>
          `<tr><td>${name(row)}</td><td>${num(row.kwh)}</td><td>${num(row.peakKw)}</td><td>${num(row.dieselGallons)}</td><td>${num((row.dieselGallons * FACTORS.dieselKgCo2PerGallon) / 1000, 1)}</td></tr>`,
      )
      .join('')}</tbody>`;
}

function renderFleet() {
  const rows = Object.values(result.fleets)
    .map(
      (f) =>
        `<tr><td>${f.label}</td><td>${f.electric}</td><td>${f.diesel}${f.gapUnits ? ` <span class="warn" title="Added to cover crew templates the workbook fleet cannot staff">(+${f.gapUnits} gap)</span>` : ''}</td><td>${f.peakDemand}</td><td>${num(f.electricHours)}</td><td>${num(f.dieselHours)}</td><td>${num(f.kwh)}</td><td>${num(f.dieselGallons)}</td><td class="${f.unmetHours ? 'warn' : ''}">${num(f.unmetHours)}</td></tr>`,
    )
    .join('');
  $('fleetTable').innerHTML =
    `<thead><tr><th>Equipment</th><th>Electric</th><th>Diesel</th><th>Peak needed</th><th>BEV hours</th><th>Diesel hours</th><th>Grid kWh</th><th>Diesel gal</th><th>Uncovered hours</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderNotes() {
  const tariff = result.tariff;
  const notes = [
    `${result.totals.calls} vessel calls are synthesized from the 2021-23 workbook averages by vessel type (no real schedule is shown). Recorded calls from the live event log will replace them.`,
    `Rate: ${tariff.name}. ${tariff.status}. Source: ${tariff.source}.`,
    'Winter super-off-peak is modeled as 8 a.m. to 4 p.m.; the start hour still needs confirming in the SCE tariff book.',
    'Equipment specs, crew templates, fleet plan and capex come from the POH Utilization Model (V23MFE), except the harbor cranes.',
    'The port has four Liebherr mobile harbor cranes. Each draws 322.5 kWh per working hour: the LHM 420 Litronic 750 kW rating times a 0.43 crane load factor. Plug-in hybrids draw from the meter while working. The 2023 inventory has three plug-in hybrids and one diesel crane; the fleet plan replaces the diesel crane in 2024.',
    'Light-duty vehicles and Class IV forklifts are not in the registry yet, so they appear as diesel units sized to demand.',
    `Charger efficiency 92%; a unit that runs flat charges back to ${Math.round(DEFAULT_SCENARIO.reserve * 100)}% before returning to work. Diesel CO2 uses ${FACTORS.dieselKgCo2PerGallon} kg per gallon (EPA).`,
    'Building loads are zero until utility bills are entered; the meter here is a single placeholder service for CHE charging.',
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
  renderLoad();
  renderBills();
  renderRollup();
  renderFleet();
  renderNotes();
}

let pending = 0;
function run() {
  syncForm();
  $('results').classList.add('busy');
  const ticket = ++pending;
  // Let the busy state paint before the synchronous year-long run.
  setTimeout(() => {
    if (ticket !== pending) return;
    result = runScenario(scenarioFromState());
    render();
    $('results').classList.remove('busy');
  }, 16);
}

$('controls').addEventListener('input', (event) => {
  const { id } = event.target;
  if (id === 'year') {
    state.year = Number($('year').value);
    state.bev = FLEET_PLAN[Math.min(2032, state.year)]?.utr[1] ?? state.bev;
    state.chargers = null;
  } else if (id === 'bev') {
    state.bev = Number($('bev').value);
    state.chargers = null;
  } else if (id === 'chargers')
    state.chargers = Math.max(0, Number($('chargers').value) || 0);
  else if (id === 'strategy') state.strategy = $('strategy').value;
  else if (id === 'tariff') {
    state.tariff = $('tariff').value;
    if (TARIFFS[state.tariff].demand.billed) state.deferred = false;
  } else if (id === 'deferred') state.deferred = $('deferred').checked;
  else if (id === 'shore') state.shore = $('shore').checked;
  else if (id === 'batKwh')
    state.batKwh = Math.max(0, Number($('batKwh').value) || 0);
  else if (id === 'batKw')
    state.batKw = Math.max(0, Number($('batKw').value) || 0);
  else if (id === 'scale') state.scale = Number($('scale').value);
  state.week = null;
  run();
});
$('controls').addEventListener('submit', (event) => event.preventDefault());
$('week').addEventListener('change', () => {
  state.week = Math.min(52, Math.max(1, Number($('week').value) || 1));
  if (result) renderLoad();
});
$('peakWeek').addEventListener('click', () => {
  state.week = null;
  if (result) renderLoad();
});
$('grain').addEventListener('change', () => result && renderRollup());

run();
