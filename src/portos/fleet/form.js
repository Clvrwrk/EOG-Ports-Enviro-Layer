/**
 * The EV Planning form and result readout, as plain DOM. Used in the POH
 * Twin panel (compact) and on the /ev-planning page.
 */
import { DEFAULT_BEV_DRAYAGE_ID, FLEET_MODELS } from './catalog.js';
import {
  CHARGE_LOCATIONS,
  DROP_SITES,
  FLEET_DEFAULTS,
  PAYLOAD_PRESETS,
  TRIP_DEFAULTS,
  verdictText,
} from './planner.js';
import { WEATHER_PRESETS } from './physics.js';
import { SOC_BANDS } from './view.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key.startsWith('on') && typeof value === 'function')
      node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false)
      node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat())
    if (child !== null && child !== undefined && child !== false)
      node.append(child instanceof Node ? child : String(child));
  return node;
}

const select = (name, options, value) => {
  const node = el(
    'select',
    { name },
    options.map(([v, label]) => el('option', { value: v }, label)),
  );
  node.value = value;
  return node;
};

const number = (name, value, min, max, step = 1) =>
  el('input', {
    type: 'number',
    name,
    value,
    min,
    max,
    step,
    style: 'width:72px',
  });

/** Battery-electric trucks with physics, grouped by make. */
export const EV_TRUCKS = FLEET_MODELS.filter((m) => m.physicsId).sort((a, b) =>
  a.label.localeCompare(b.label),
);

export const DROP_CHARGE_OPTIONS = Object.freeze([
  ['0', 'No charging at the drop site'],
  ['150:60', '150 kW for up to 1 hour'],
  ['350:30', '350 kW for up to 30 minutes'],
  ['350:60', '350 kW for up to 1 hour'],
]);

const fmt = (n, digits = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '-';

/**
 * Build the form. `initial` may carry siteId, modelId and any trip or fleet
 * option. Returns { root, read(), setBusy(), showError() }.
 */
export function createEvForm(onRun, initial = {}) {
  const site = select(
    'site',
    DROP_SITES.map((s) => [s.id, s.label]),
    initial.siteId ?? 'santa-clarita-dc',
  );
  const truck = select(
    'truck',
    EV_TRUCKS.map((m) => [m.id, m.label]),
    initial.modelId ?? DEFAULT_BEV_DRAYAGE_ID,
  );
  const payloads = Object.entries(PAYLOAD_PRESETS).map(([k, p]) => [
    k,
    p.label,
  ]);
  const outLoad = select(
    'out',
    payloads,
    initial.outboundPayload ?? TRIP_DEFAULTS.outboundPayload,
  );
  const backLoad = select(
    'back',
    payloads,
    initial.returnPayload ?? TRIP_DEFAULTS.returnPayload,
  );
  const weather = select(
    'weather',
    Object.keys(WEATHER_PRESETS).map((k) => [
      k,
      k[0].toUpperCase() + k.slice(1),
    ]),
    initial.weather ?? TRIP_DEFAULTS.weather,
  );
  const dropCharge = select(
    'dropCharge',
    DROP_CHARGE_OPTIONS,
    initial.dropCharge ?? '0',
  );
  const trucks = number(
    'trucks',
    initial.trucks ?? FLEET_DEFAULTS.trucks,
    1,
    2000,
  );
  const tripsPerDay = number(
    'trips',
    initial.tripsPerTruckPerDay ?? FLEET_DEFAULTS.tripsPerTruckPerDay,
    1,
    6,
  );
  const chargerKw = select(
    'chargerKw',
    [
      ['50', '50 kW'],
      ['150', '150 kW'],
      ['350', '350 kW'],
    ],
    String(initial.chargerKw ?? FLEET_DEFAULTS.chargerKw),
  );
  const chargeAt = select(
    'chargeAt',
    Object.entries(CHARGE_LOCATIONS).map(([k, c]) => [k, c.label]),
    initial.chargeAt ?? FLEET_DEFAULTS.chargeAt,
  );
  const price = number(
    'usdPerKwh',
    initial.usdPerKwh ?? FLEET_DEFAULTS.usdPerKwh,
    0.05,
    1,
    0.01,
  );
  const run = el('button', { type: 'submit' }, 'Plan this trip');
  const status = el('p', { class: 'ev-status sub' });
  const row = (label, input) => el('label', {}, label, input);
  const root = el(
    'form',
    {
      class: 'ev-form',
      onsubmit: (event) => {
        event.preventDefault();
        onRun(read());
      },
    },
    row('Drop site', site),
    row('Truck', truck),
    row('Load out', outLoad),
    row('Load back', backLoad),
    row('Weather', weather),
    row('At the drop site', dropCharge),
    row('Trucks in the fleet', trucks),
    row('Round trips per truck a day', tripsPerDay),
    row('Where the trucks charge', chargeAt),
    row('Charger power there', chargerKw),
    row('Electricity price ($/kWh)', price),
    el('div', { class: 'row' }, run),
    status,
  );
  function read() {
    const [kw, minutes] = dropCharge.value.split(':').map(Number);
    return {
      siteId: site.value,
      modelId: truck.value,
      trip: {
        outboundPayload: outLoad.value,
        returnPayload: backLoad.value,
        weather: weather.value,
        chargeAtDropKw: kw || 0,
        chargeAtDropMinutes: minutes || 0,
      },
      fleet: {
        trucks: Number(trucks.value) || 1,
        tripsPerTruckPerDay: Number(tripsPerDay.value) || 1,
        chargerKw: Number(chargerKw.value),
        chargeAt: chargeAt.value,
        usdPerKwh: Number(price.value) || FLEET_DEFAULTS.usdPerKwh,
      },
    };
  }
  return {
    root,
    read,
    setBusy(busy, text = '') {
      run.disabled = busy;
      status.textContent = text;
    },
    showError(error) {
      run.disabled = false;
      status.textContent = error?.message ?? String(error);
    },
  };
}

/** Query string that reopens a plan (twin or page). */
export function planQuery(request) {
  const q = new URLSearchParams({ ev: request.siteId, truck: request.modelId });
  return q.toString();
}

/** Plan request from a page's query string, or null. */
export function planFromSearch(search) {
  const q = new URLSearchParams(search ?? '');
  const siteId = q.get('ev');
  if (!siteId || !DROP_SITES.some((s) => s.id === siteId)) return null;
  const modelId = q.get('truck');
  return {
    siteId,
    modelId: EV_TRUCKS.some((m) => m.id === modelId)
      ? modelId
      : DEFAULT_BEV_DRAYAGE_ID,
  };
}

/** Result tables for a runTrip() answer. */
export function resultView({ site, trip, fleet }) {
  const f = trip.feasibility;
  const tone = f.verdict === 'feasible' ? 'down' : 'up';
  const rows = (pairs) =>
    el(
      'table',
      {},
      pairs.map(([k, v]) =>
        el('tr', {}, el('td', {}, k), el('td', { class: 'v' }, v)),
      ),
    );
  const a = fleet.annual;
  return el(
    'div',
    { class: 'ev-result' },
    el('p', { class: tone }, el('strong', {}, verdictText(trip))),
    rows(
      [
        [
          'Round trip',
          `${fmt(trip.miles)} mi, ${fmt(trip.hours, 1)} h driving`,
        ],
        [
          'Energy used',
          `${fmt(trip.kwh)} kWh (${fmt(trip.kwhPerMile, 2)} kWh/mi)`,
        ],
        ['Lowest charge', `${fmt(trip.minSocPct)}%`],
        ['Back at port with', `${fmt(trip.finalSocPct)}%`],
        trip.dropCharge
          ? [
              'Charged at drop site',
              `${fmt(trip.dropCharge.energyKwh)} kWh in ${trip.dropCharge.minutes} min`,
            ]
          : null,
      ].filter(Boolean),
    ),
    el(
      'p',
      { class: 'sub' },
      `Fleet: ${fleet.options.trucks} trucks x ${fleet.options.tripsPerTruckPerDay} trip(s) a day to ${site.label}`,
    ),
    rows([
      [
        `Charging energy at ${fleet.chargeLocation.short}`,
        `${fmt(fleet.depotKwhPerDay)} kWh/day (${fmt(fleet.depotMwhPerYear)} MWh/yr)`,
      ],
      [
        'Charging load',
        `${fmt(fleet.peakKw)} kW over ${fleet.options.chargeWindowHours} h`,
      ],
      [
        `Chargers at ${fleet.chargeLocation.short}`,
        `${fleet.chargersNeeded} x ${fleet.chargerKw} kW${fleet.fitsWindow ? '' : ' (too slow for the window)'}`,
      ],
      [
        'CO2e avoided vs diesel',
        `${fmt(a.avoided.co2eT)} t/yr (${fmt(a.avoided.pctCo2e * 100)}%)`,
      ],
      ['NOx avoided', `${fmt(a.avoided.noxKg)} kg/yr`],
      ['PM2.5 avoided', `${fmt(a.avoided.pm25Kg, 1)} kg/yr`],
      [
        'Electricity vs diesel',
        `$${fmt(fleet.energyCostPerYear)} vs $${fmt(fleet.dieselCostPerYear)} a year`,
      ],
    ]),
    el(
      'p',
      { class: 'sub legend' },
      SOC_BANDS.map(([, color, label]) =>
        el('span', {}, el('i', { style: `background:${color}` }), label),
      ),
    ),
    el(
      'p',
      { class: 'sub' },
      `${site.label} is an example drop site (approximate). Trips start and end at the POH gate; the drive to and from the carrier's home yard is not included yet. Car routing from OpenStreetMap; terrain from Re:Earth. ${trip.outbound.disclaimer}`,
    ),
  );
}
