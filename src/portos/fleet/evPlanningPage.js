/**
 * /ev-planning: battery-electric drayage from the Port of Hueneme. Plan one
 * truck's round trip to a drop site with FleetVolt physics, see the fleet's
 * charging load where the trucks charge and emissions against diesel, and browse the
 * fleet catalog behind the port inventory (trucks, cargo-handling
 * equipment, locomotives, harbor craft and ships).
 */
import '../page/scenarios.css';
import { lineChart } from '../page/charts.js';
import { followNavRequest, mountSiteNav } from '../nav/siteNav.js';
import { TWIN_PATH } from '../scenarioStore.js';
import { loadVesselInventory } from '../vessels/load.js';
import {
  FLEET_CATEGORIES,
  buildFleetCatalog,
  emissionsPerTonMile,
  emissionsPerUnit,
  energyPerUnit,
} from './catalog.js';
import {
  createEvForm,
  el,
  planFromSearch,
  planQuery,
  resultView,
} from './form.js';
import { createGateLogSection } from './gateLogSection.js';
import { runTrip } from './runTrip.js';

const PAGE_CSS = `
.ev-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px 14px;align-items:end}
.ev-form label{display:flex;flex-direction:column;gap:3px;font-size:12px}
.ev-form .row,.ev-form .ev-status{grid-column:1/-1;margin:0}
.ev-result table{margin:6px 0 12px}
.ev-result p.down{color:var(--good,#1d7a3a)}
.ev-result p.up{color:var(--bad,#b3261e)}
.legend span{display:inline-flex;align-items:center;gap:4px;margin-right:12px}
.legend i{display:inline-block;width:12px;height:12px;border-radius:2px}
.cat-filter{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.cat-filter button[aria-pressed=true]{border-color:var(--accent,#2a78d6);font-weight:600}
table.catalog td.src{font-size:11px;max-width:340px;color:var(--text-secondary,#52514e)}
`;

const fmt = (n, digits = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '-';

const BASIS_LABEL = {
  mile: 'mile',
  hour: 'working hour',
  'ton-mile': 'ton-mile',
};

const app = document.getElementById('app');
app.innerHTML = `
<div class="portos-wrap">
  <header>
    <div>
      <h1>EV Planning: Port of Hueneme drayage</h1>
      <p class="sub">Drive a battery-electric truck from the port to a drop site and back with FleetVolt physics (terrain, payload, weather, regen). See the charge it arrives with, what a fleet doing it every day needs from the chargers where it charges (the carrier's home yard, a third-party station or a CaaS site, never the port), and what it saves against diesel.</p>
    </div>
    <a id="twinLink" href="${TWIN_PATH}?panel=twin">Open the twin</a>
  </header>
  <section class="card">
    <h2>Plan a round trip</h2>
    <div id="formHost"></div>
  </section>
  <section class="card" id="resultCard" hidden>
    <h2>Result</h2>
    <p><a class="button primary" id="showOnTwin" href="${TWIN_PATH}">Show this trip on the 3D twin</a></p>
    <div id="result"></div>
    <div class="chart-head"><h3>Battery charge along the trip (%)</h3></div>
    <div class="chart" id="socChart"></div>
    <div class="chart-head"><h3>Elevation along the trip (m)</h3></div>
    <div class="chart" id="elevChart"></div>
  </section>
  <div id="gateHost"></div>
  <section class="card">
    <h2>Fleet catalog</h2>
    <p class="sub">Every model the port inventory, the scenario tools and this planner draw on. Electric trucks carry FleetVolt's physics; port equipment comes from the POH utilization workbook; ships are grouped from the POH ship inventory. Figures marked estimated are planning placeholders.</p>
    <div class="cat-filter" id="catFilter"></div>
    <div class="table-wrap"><table class="catalog" id="catalog"></table></div>
  </section>
</div>`;
document.head.append(el('style', {}, PAGE_CSS));
mountSiteNav({ host: app.querySelector('.portos-wrap') });
followNavRequest();

const $ = (id) => document.getElementById(id);

// ── Planner ────────────────────────────────────────────────────────────────

const linked = planFromSearch(location.search);
let runId = 0;
const form = createEvForm(async (request) => {
  const mine = (runId += 1);
  form.setBusy(true, 'Routing and reading terrain…');
  try {
    const answer = await runTrip(request);
    if (mine !== runId) return;
    showResult(request, answer);
    form.setBusy(false);
  } catch (error) {
    if (mine === runId) form.showError(error);
  }
}, linked ?? {});
$('formHost').append(form.root);
$('gateHost').replaceWith(createGateLogSection());
if (linked) form.root.requestSubmit();

/** Evenly thin a list to at most `max` items, keeping the last. */
function thin(list, max) {
  if (list.length <= max) return list;
  const step = list.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i += 1) out.push(list[Math.floor(i * step)]);
  out.push(list[list.length - 1]);
  return out;
}

function showResult(request, answer) {
  const query = planQuery(request);
  history.replaceState(null, '', `?${query}`);
  $('showOnTwin').href = `${TWIN_PATH}?panel=twin&${query}`;
  $('twinLink').href = `${TWIN_PATH}?panel=twin&${query}`;
  $('result').replaceChildren(resultView(answer));
  $('resultCard').hidden = false;

  const { trip, routes } = answer;
  const outMi = trip.outbound.kpis.distance_mi;
  const soc = thin(
    [
      ...trip.outbound.segments.map((s) => [s.end_m / 1609.344, s.soc_pct]),
      ...trip.inbound.segments.map((s) => [
        outMi + s.end_m / 1609.344,
        s.soc_pct,
      ]),
    ],
    240,
  );
  lineChart($('socChart'), {
    series: [
      { label: 'Charge', color: '#2a78d6', values: soc.map(([, v]) => v) },
    ],
    labels: soc.map(([mi]) => `${fmt(mi)} mi`),
    tickEvery: Math.max(1, Math.round(soc.length / 8)),
    format: (v) => `${fmt(v)}%`,
  });
  const elev = thin(
    [
      ...routes.outProfile.map((p) => [p.dist_m / 1609.344, p.elev_m]),
      ...routes.backProfile.map((p) => [outMi + p.dist_m / 1609.344, p.elev_m]),
    ].filter(([, v]) => Number.isFinite(v)),
    240,
  );
  lineChart($('elevChart'), {
    series: [
      {
        label: 'Elevation',
        color: '#8a6d3b',
        values: elev.map(([, v]) => Math.max(0, v)),
      },
    ],
    labels: elev.map(([mi]) => `${fmt(mi)} mi`),
    tickEvery: Math.max(1, Math.round(elev.length / 8)),
    format: (v) => `${fmt(v)} m`,
  });
}

// ── Catalog ────────────────────────────────────────────────────────────────

let catalog = buildFleetCatalog();
let category = 'drayage_truck';

const basisLabel = (model) =>
  model.category === 'ogv'
    ? 'hour at berth'
    : (BASIS_LABEL[model.basis] ?? model.basis);

function energyText(model) {
  const { dieselGal, kwh } = energyPerUnit(model);
  const parts = [];
  if (kwh) parts.push(`${fmt(kwh, kwh < 10 ? 2 : 1)} kWh`);
  if (dieselGal)
    parts.push(`${fmt(dieselGal, dieselGal < 1 ? 3 : 2)} gal diesel`);
  return parts.length ? `${parts.join(' + ')} per ${basisLabel(model)}` : '-';
}

function emissionsText(model) {
  const e = emissionsPerUnit(model);
  const per = basisLabel(model);
  const text = `${fmt(e.co2eKg, 2)} kg CO2e, ${fmt(e.noxG, 1)} g NOx per ${per}`;
  const tm = model.basis === 'mile' ? emissionsPerTonMile(model) : null;
  return tm ? `${text} (${fmt(tm.co2eKg * 1000)} g CO2e per ton-mile)` : text;
}

function detailText(model) {
  if (model.category === 'ogv')
    return `${model.ships.length} ships; hotelling ${fmt(model.hotellingAuxKw)} kW aux${model.hotellingBoilerKw ? ` + ${fmt(model.hotellingBoilerKw)} kW boiler` : ''}; ${model.shorePowerShips} shore-power capable`;
  const bits = [];
  if (model.batteryKwh) bits.push(`${fmt(model.batteryKwh)} kWh pack`);
  if (model.rangeMi) bits.push(`${fmt(model.rangeMi)} mi range`);
  if (model.chargeKw) bits.push(`${fmt(model.chargeKw)} kW charging`);
  if (model.payloadTons) bits.push(`${fmt(model.payloadTons)} t payload`);
  if (model.hvip?.eligible)
    bits.push(`HVIP ${model.hvip.incentive ?? 'eligible'}`);
  return bits.join('; ') || '';
}

function renderFilter() {
  $('catFilter').replaceChildren(
    ...Object.entries(FLEET_CATEGORIES).map(([id, label]) => {
      const count = catalog.models.filter((m) => m.category === id).length;
      return el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(id === category),
          onclick: () => {
            category = id;
            renderFilter();
            renderCatalog();
          },
        },
        `${label} (${count})`,
      );
    }),
  );
}

function renderCatalog() {
  const rows = catalog.models
    .filter((m) => m.category === category)
    .sort((a, b) => a.label.localeCompare(b.label));
  $('catalog').replaceChildren(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ['Model', 'Power', 'Energy', 'Emissions', 'Details', 'Source'].map(
          (h) => el('th', {}, h),
        ),
      ),
    ),
    el(
      'tbody',
      {},
      rows.length
        ? rows.map((m) =>
            el(
              'tr',
              {},
              el(
                'td',
                {},
                m.label,
                m.estimated ? el('span', { class: 'tag' }, ' estimated') : null,
              ),
              el('td', {}, m.powertrain),
              el('td', {}, energyText(m)),
              el('td', {}, emissionsText(m)),
              el('td', {}, detailText(m)),
              el('td', { class: 'src' }, m.source ?? ''),
            ),
          )
        : el(
            'tr',
            {},
            el(
              'td',
              { colspan: 6 },
              category === 'ogv' ? 'Loading the ship inventory…' : 'No models',
            ),
          ),
    ),
  );
}

renderFilter();
renderCatalog();
loadVesselInventory()
  .then((inventory) => {
    catalog = buildFleetCatalog({ vesselInventory: inventory });
    renderFilter();
    renderCatalog();
  })
  .catch(() => {});
