/**
 * Gate log section for /ev-planning: type in each truck visit (VIN, time
 * in, time out) or import the gate spreadsheet and the trucker
 * registration export, see the diesel fleet by age and engine standard,
 * then model N electric trucks doing N trips a day replacing the oldest
 * diesels. Gate data is private: it stays in this browser.
 */
import { stackedBars } from '../page/charts.js';
import { el } from './form.js';
import {
  BHP_HR_PER_MILE,
  NOT_REGISTERED,
  evSwapScenario,
  gateRowsFromCsv,
  readGateRow,
  registrationsFromCsv,
  summarizeGateLog,
} from './gateLog.js';
import { ENGINE_BAND_SOURCE, lookupVins, vinProblem } from './vin.js';

const STORE_KEY = 'portos.gateLog.v1';

const fmt = (n, digits = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '-';
const pct = (part, whole) => (whole ? `${fmt((100 * part) / whole)}%` : '-');
const minutes = (m) =>
  Number.isFinite(m)
    ? m >= 60
      ? `${Math.floor(m / 60)} h ${fmt(m % 60)} min`
      : `${fmt(m)} min`
    : '-';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && Array.isArray(saved.rows))
      return {
        rows: saved.rows,
        registrations: new Map(saved.registrations ?? []),
        lookups: new Map(saved.lookups ?? []),
      };
  } catch {
    // Unreadable or blocked storage: start empty.
  }
  return { rows: [], registrations: new Map(), lookups: new Map() };
}

function save(state) {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        rows: state.rows,
        registrations: [...state.registrations],
        lookups: [...state.lookups],
      }),
    );
  } catch {
    // Storage full or blocked: the data still lives for this page.
  }
}

const key = (row) => `${row.vin}|${row.timeIn}`;

/** Add rows, skipping visits already logged. Returns how many were new. */
function addRows(state, rows) {
  const seen = new Set(state.rows.map(key));
  let added = 0;
  for (const row of rows)
    if (!seen.has(key(row))) {
      seen.add(key(row));
      state.rows.push(row);
      added += 1;
    }
  state.rows.sort((a, b) => a.timeIn.localeCompare(b.timeIn));
  return added;
}

const kpi = (label, value, note) =>
  el(
    'div',
    { class: 'kpi' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'num' }, value),
    note ? el('div', { class: 'note' }, note) : null,
  );

const table = (head, rows) =>
  el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          head.map((h) => el('th', {}, h)),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map((r) =>
          el(
            'tr',
            {},
            r.map((c) => el('td', {}, c)),
          ),
        ),
      ),
    ),
  );

const numberInput = (name, value, min, max, step = 1) =>
  el('input', { type: 'number', name, value, min, max, step, required: true });

const today = () => new Date().toISOString().slice(0, 10);

function csvOf(rows, registrations) {
  const lines = ['VIN,Time in,Time out,Carrier'];
  for (const r of rows)
    lines.push(
      [
        r.vin,
        r.timeIn.replace('T', ' '),
        r.timeOut?.replace('T', ' ') ?? '',
        registrations.get(r.vin)?.carrier ?? '',
      ]
        .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(','),
    );
  return `${lines.join('\r\n')}\r\n`;
}

/** The section's root element. */
export function createGateLogSection() {
  const state = load();
  const status = el('p', { class: 'sub', role: 'status' });
  const say = (text) => {
    status.textContent = text;
  };

  // ── Typed entry ─────────────────────────────────────────────────────────
  const vinList = el('datalist', { id: 'gateVins' });
  const vin = el('input', {
    name: 'vin',
    list: 'gateVins',
    maxlength: 20,
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '17 characters',
    style: 'text-transform:uppercase;font-family:monospace',
    required: true,
  });
  const vinNote = el('small', {});
  vin.addEventListener('input', () => {
    const problem = vin.value.trim() ? vinProblem(vin.value) : null;
    vinNote.textContent = problem ?? '';
    vin.setCustomValidity(problem ?? '');
  });
  const date = el('input', {
    type: 'date',
    name: 'date',
    value: today(),
    required: true,
  });
  const timeIn = el('input', { type: 'time', name: 'timeIn', required: true });
  const timeOut = el('input', { type: 'time', name: 'timeOut' });
  const entry = el(
    'form',
    {
      class: 'ev-form',
      onsubmit: (event) => {
        event.preventDefault();
        const { row, error } = readGateRow({
          vin: vin.value,
          date: date.value,
          timeIn: timeIn.value,
          timeOut: timeOut.value,
        });
        if (error) return say(`Not saved: ${error}.`);
        const added = addRows(state, [row]);
        say(
          added
            ? `Saved ${row.vin} at ${row.timeIn.slice(11)}.`
            : 'That visit is already logged.',
        );
        vin.value = '';
        timeIn.value = '';
        timeOut.value = '';
        vinNote.textContent = '';
        refresh();
        vin.focus();
      },
    },
    el('label', {}, 'VIN', vin, vinNote),
    el('label', {}, 'Date', date),
    el('label', {}, 'Time in', timeIn),
    el('label', {}, 'Time out (blank if still inside)', timeOut),
    el(
      'p',
      { class: 'row' },
      el('button', { type: 'submit', class: 'button primary' }, 'Add visit'),
    ),
  );

  // ── Imports ─────────────────────────────────────────────────────────────
  const readFile = (input, handle) =>
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      handle(await file.text(), file.name);
      input.value = '';
    });
  const gateFile = el('input', { type: 'file', accept: '.csv,text/csv' });
  readFile(gateFile, (text, name) => {
    const { rows, errors, unknownColumns } = gateRowsFromCsv(text);
    const added = addRows(state, rows);
    const bits = [`${name}: added ${fmt(added)} visits`];
    if (rows.length > added)
      bits.push(`${fmt(rows.length - added)} already logged`);
    if (unknownColumns.length)
      bits.push(`ignored columns ${unknownColumns.join(', ')}`);
    if (errors.length)
      bits.push(
        `${fmt(errors.length)} rows skipped (${errors
          .slice(0, 5)
          .map((e) => `line ${e.line}: ${e.problem}`)
          .join('; ')}${errors.length > 5 ? '; …' : ''})`,
      );
    say(`${bits.join('; ')}.`);
    refresh();
  });
  const regFile = el('input', { type: 'file', accept: '.csv,text/csv' });
  readFile(regFile, (text, name) => {
    const { byVin, changed, errors } = registrationsFromCsv(text);
    for (const [v, link] of byVin) {
      const old = state.registrations.get(v);
      if (!old || (link.since && (!old.since || link.since < old.since)))
        state.registrations.set(v, link);
    }
    const bits = [`${name}: linked ${fmt(byVin.size)} VINs to carriers`];
    if (changed.length)
      bits.push(
        `${fmt(changed.length)} VINs later registered by another carrier (first one kept)`,
      );
    if (errors.length)
      bits.push(
        `${fmt(errors.length)} rows skipped (${errors.slice(0, 3).join('; ')})`,
      );
    say(`${bits.join('; ')}.`);
    refresh();
  });

  const lookupButton = el(
    'button',
    {
      type: 'button',
      onclick: async () => {
        const vins = [...new Set(state.rows.map((r) => r.vin))].filter(
          (v) => !state.lookups.has(v),
        );
        if (!vins.length) return say('Every VIN is already looked up.');
        lookupButton.disabled = true;
        say(`Looking up ${fmt(vins.length)} VINs at NHTSA…`);
        try {
          const found = await lookupVins(vins);
          for (const [v, info] of found) state.lookups.set(v, info);
          say(`NHTSA decoded ${fmt(found.size)} VINs.`);
          refresh();
        } catch (error) {
          say(`NHTSA lookup failed: ${error.message}`);
        } finally {
          lookupButton.disabled = false;
        }
      },
    },
    'Look up make, model and fuel (NHTSA)',
  );
  const download = el(
    'button',
    {
      type: 'button',
      onclick: () => {
        const blob = new Blob([csvOf(state.rows, state.registrations)], {
          type: 'text/csv',
        });
        const a = el('a', {
          href: URL.createObjectURL(blob),
          download: `poh-gate-log-${today()}.csv`,
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    },
    'Download the log (CSV)',
  );
  const clear = el(
    'button',
    {
      type: 'button',
      onclick: () => {
        if (
          !confirm(
            'Remove every gate visit and carrier link from this browser?',
          )
        )
          return;
        state.rows = [];
        state.registrations.clear();
        state.lookups.clear();
        say('Cleared.');
        refresh();
      },
    },
    'Clear',
  );

  // ── Scenario inputs ─────────────────────────────────────────────────────
  const scenarioForm = el(
    'form',
    { class: 'ev-form', oninput: () => renderScenario() },
    el(
      'label',
      {},
      'Electric trucks added',
      numberInput('evTrucks', 5, 0, 1000),
    ),
    el(
      'label',
      {},
      'Port trips per EV truck per day',
      numberInput('trips', 2, 0.5, 24, 0.5),
    ),
    el(
      'label',
      {},
      'Round trip miles (yard, port, drop site, yard)',
      numberInput('miles', 60, 1, 1000),
    ),
    el(
      'label',
      {},
      'Gate operating days per year',
      numberInput('days', 260, 1, 366),
    ),
  );
  scenarioForm.addEventListener('submit', (e) => e.preventDefault());

  const summaryHost = el('div', {});
  const hourChart = el('div', { class: 'chart' });
  const scenarioHost = el('div', {});
  let summary = null;

  function renderScenario() {
    if (!summary?.visits) {
      scenarioHost.replaceChildren(
        el('p', { class: 'sub' }, 'Log some gate visits to model a swap.'),
      );
      return;
    }
    const v = (name) => Number(scenarioForm.elements[name].value);
    if (!scenarioForm.checkValidity())
      return scenarioHost.replaceChildren(
        el('p', {}, 'Check the numbers above.'),
      );
    const s = evSwapScenario(summary, {
      evTrucks: v('evTrucks'),
      tripsPerTruck: v('trips'),
      roundTripMi: v('miles'),
      operatingDays: v('days'),
    });
    const day = (k, scale, digits, unit) => [
      `${fmt(s.perDay.baseline[k] * scale, digits)} ${unit}`,
      `${fmt(s.perDay.scenario[k] * scale, digits)} ${unit}`,
    ];
    scenarioHost.replaceChildren(
      el(
        'p',
        {},
        `${fmt(s.evVisitsPerDay, 1)} of ${fmt(s.dieselVisitsPerDay, 1)} daily diesel visits move to electric trucks`,
        s.requestedVisitsPerDay > s.evVisitsPerDay
          ? ` (asked for ${fmt(s.requestedVisitsPerDay, 1)}; the log has no more)`
          : '',
        '. Replaced first: ',
        s.displaced
          .map((d) => `${fmt(d.visitsPerDay, 1)} a day from ${d.band.label}`)
          .join(', ') || 'none',
        '.',
      ),
      table(
        [
          'Port truck trips',
          'Per day today',
          'Per day with the EVs',
          'Saved per year',
        ],
        [
          [
            'NOx',
            ...day('noxKg', 1, 2, 'kg'),
            `${fmt(s.perYear.saved.noxKg)} kg`,
          ],
          [
            'PM',
            ...day('pmKg', 1000, 0, 'g'),
            `${fmt(s.perYear.saved.pmKg, 1)} kg`,
          ],
          [
            'CO2',
            ...day('co2Kg', 1, 0, 'kg'),
            `${fmt(s.perYear.saved.co2Kg / 1000, 1)} t`,
          ],
        ],
      ),
      el(
        'p',
        { class: 'sub' },
        `The EVs need about ${fmt(s.evEnergyKwhPerDay)} kWh a day where they charge (home yard, station or CaaS site, never the port); CO2 saved is net of ${fmt(s.evGridCo2KgPerDay)} kg a day of grid CO2. NOx and PM use engine certification limits times ${fmt(BHP_HR_PER_MILE, 1)} bhp-hr per mile, so real drayage NOx (slow, idling, cold SCR) is higher; planning estimates until EMFAC rates are added.`,
      ),
    );
  }

  function refresh() {
    save(state);
    vinList.replaceChildren(
      ...[...new Set(state.rows.map((r) => r.vin))].map((v) =>
        el('option', { value: v }),
      ),
    );
    summary = summarizeGateLog(state.rows, {
      registrations: state.registrations,
      lookups: state.lookups,
    });
    const s = summary;
    if (!s.visits) {
      summaryHost.replaceChildren(
        el(
          'p',
          { class: 'sub' },
          'No gate visits yet. Type them in above or import the gate spreadsheet.',
        ),
      );
      hourChart.replaceChildren();
      renderScenario();
      return;
    }
    summaryHost.replaceChildren(
      el(
        'div',
        { class: 'kpis' },
        kpi('Truck visits', fmt(s.visits), `${fmt(s.days)} days logged`),
        kpi('Visits per day', fmt(s.visitsPerDay, 1)),
        kpi('Different trucks', fmt(s.trucks)),
        kpi(
          'Time on terminal',
          minutes(s.dwellMinutes.median),
          `median; 9 in 10 under ${minutes(s.dwellMinutes.p90)}`,
        ),
        kpi(
          'Median truck age',
          s.medianAgeYears === null ? '-' : `${fmt(s.medianAgeYears)} yr`,
        ),
        kpi(
          'Pre-2010 engines',
          fmt(s.californiaNotOk.trucks),
          `${fmt(s.californiaNotOk.visits)} ${s.californiaNotOk.visits === 1 ? 'visit' : 'visits'}; not allowed under CARB Truck and Bus`,
        ),
      ),
      el('h3', {}, 'Fleet by engine standard (model year from the VIN)'),
      table(
        [
          'Engine model years',
          'Trucks',
          'Visits',
          'Share of visits',
          'NOx limit',
        ],
        s.bands
          .filter((b) => b.trucks)
          .map((b) => [
            b.band.label,
            fmt(b.trucks),
            fmt(b.visits),
            pct(b.visits, s.visits),
            b.band.noxGPerBhpHr ? `${b.band.noxGPerBhpHr} g/bhp-hr` : '-',
          ]),
      ),
      el('p', { class: 'sub' }, ENGINE_BAND_SOURCE),
      el('h3', {}, 'Carriers (from the trucker registrations)'),
      table(
        ['Carrier', 'Trucks', 'Visits', 'Share of visits'],
        s.byCarrier.map((c) => [
          c.key,
          fmt(c.trucks),
          fmt(c.visits),
          pct(c.visits, s.visits),
        ]),
      ),
      s.byCarrier.some((c) => c.key === NOT_REGISTERED)
        ? el(
            'p',
            { class: 'sub' },
            'Only non-compliant trucks fill in the registration form, so most VINs have no carrier until a carrier fleet roster is added.',
          )
        : null,
      el('h3', {}, 'Makes'),
      table(
        ['Make', 'Trucks', 'Visits'],
        s.byMake.map((m) => [m.key, fmt(m.trucks), fmt(m.visits)]),
      ),
      el('h3', {}, 'Truck arrivals by hour (all days)'),
    );
    stackedBars(hourChart, {
      categories: s.byHour.map((_, h) => String(h).padStart(2, '0')),
      stacks: [{ label: 'Arrivals', color: '#2a78d6', values: s.byHour }],
      format: (v) => fmt(v),
    });
    renderScenario();
  }

  const root = el(
    'section',
    { class: 'card', id: 'gateLog' },
    el('h2', {}, 'Gate log and EV swap scenarios'),
    el(
      'p',
      { class: 'sub' },
      'The gate records a VIN, a time in and a time out for every truck. Log them here (or import the gate spreadsheet) to see the real drayage fleet by age and engine standard, then try adding electric trucks. Gate and carrier data stays in this browser; nothing is sent anywhere except the optional NHTSA lookup, which sends VINs only.',
    ),
    vinList,
    entry,
    el(
      'div',
      { class: 'ev-form' },
      el(
        'label',
        {},
        'Import gate spreadsheet (CSV: VIN, date, time in, time out)',
        gateFile,
      ),
      el(
        'label',
        {},
        'Import trucker registrations (CSV export of the POH form)',
        regFile,
      ),
      el('p', { class: 'row' }, lookupButton, ' ', download, ' ', clear),
    ),
    status,
    summaryHost,
    hourChart,
    el('h3', {}, 'EV swap: replace the oldest diesel trucks first'),
    scenarioForm,
    scenarioHost,
  );
  refresh();
  return root;
}
