/**
 * The twin's control panel: the day and hour being played, the decisions
 * (UTRs, cranes, charging, battery, shore power, fleet-plan year), a live
 * "now" readout and the year scoreboard against today's baseline. Also the
 * data card that opens when a model is clicked.
 *
 * Plain DOM with its own scoped styles, mounted while the layer is on.
 */
import { CHARGING_STRATEGIES } from '../fleetSim.js';
import { FLEET_PLAN } from '../hueneme.js';
import { STEPS_PER_DAY } from '../touCalendar.js';
import { TWIN_COLORS } from './view.js';

const STYLE_ID = 'port-twin-style';
const CSS = `
.port-twin{position:fixed;top:392px;bottom:60px;right:12px;width:330px;overflow:auto;z-index:40;
  background:rgba(10,14,22,.88);color:#e8ecf2;border:1px solid rgba(32,231,242,.35);border-radius:10px;
  font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;padding:10px 12px;backdrop-filter:blur(6px)}
.port-twin h2{font-size:14px;margin:0 0 2px;display:flex;justify-content:space-between;align-items:center}
.port-twin.collapsed{bottom:auto}.port-twin.collapsed>:not(h2){display:none}
@media (max-height:760px){.port-twin{top:72px;right:auto;left:12px;bottom:auto;max-height:calc(100vh - 140px)}}.port-twin .sub{color:#9aa6b8;margin:0 0 8px;font-size:11px}
.port-twin fieldset{border:0;border-top:1px solid rgba(255,255,255,.1);margin:8px 0 0;padding:8px 0 0}
.port-twin legend{color:#20e7f2;font-weight:600;padding:0;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.port-twin label{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0}
.port-twin select,.port-twin button{background:#141b28;color:#e8ecf2;border:1px solid #2b3648;border-radius:6px;padding:3px 6px;font:inherit}
.port-twin button{cursor:pointer}.port-twin button:hover{border-color:#20e7f2}
.port-twin .row{display:flex;gap:6px;align-items:center}.port-twin .row>*{flex:0 0 auto}
.port-twin input[type=range]{width:100%}
.port-twin .clock{font-size:16px;font-variant-numeric:tabular-nums}
.port-twin .badge{display:inline-block;border-radius:4px;padding:0 5px;font-size:10px;background:#2b3648}
.port-twin table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.port-twin td{padding:2px 0}.port-twin td.v{text-align:right}.port-twin td.d{text-align:right;width:70px}
.port-twin .up{color:#ff8c3a}.port-twin .down{color:#7cff8a}
.port-twin .legend span{display:inline-flex;align-items:center;gap:4px;margin-right:8px}
.port-twin .legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.port-twin-card{position:fixed;z-index:41;min-width:220px;max-width:300px;background:rgba(10,14,22,.94);color:#e8ecf2;
  border:1px solid #20e7f2;border-radius:8px;padding:8px 10px;font:12px/1.4 system-ui,sans-serif;pointer-events:auto}
.port-twin-card h3{margin:0 0 4px;font-size:13px}.port-twin-card table{border-collapse:collapse;width:100%}
.port-twin-card td{padding:1px 0;vertical-align:top}.port-twin-card td:first-child{color:#9aa6b8;padding-right:8px}
.port-twin-card button{position:absolute;top:4px;right:6px;background:none;border:0;color:#9aa6b8;cursor:pointer;font-size:14px}
`;

const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmt = (row, v) =>
  row.unit === '$'
    ? money(v)
    : `${Math.round(v).toLocaleString('en-US')} ${row.unit}`;
const PERIOD_TEXT = {
  on: 'On-peak',
  mid: 'Mid-peak',
  off: 'Off-peak',
  super_off: 'Super off-peak',
};
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

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat())
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  return node;
}

function select(name, options, value, onChange) {
  const node = el('select', { name, onchange: () => onChange(node.value) });
  for (const [key, label] of options) {
    const option = el('option', { value: key }, label);
    if (String(key) === String(value)) option.selected = true;
    node.append(option);
  }
  return node;
}

/**
 * @param {object} handlers
 * @param {(patch: object) => void} handlers.onDecision
 * @param {(step: number) => void} handlers.onSeek
 * @param {(direction: number) => void} handlers.onCallDay
 * @param {() => void} handlers.onPlayToggle
 * @param {() => void} handlers.onWalk
 * @param {object} decisions current decisions
 */
export function createTwinPanel(
  handlers,
  decisions,
  { approximate = true, berthLabel = '' } = {},
) {
  if (!document.getElementById(STYLE_ID))
    document.head.append(el('style', { id: STYLE_ID }, CSS));

  const clock = el('div', { class: 'clock' });
  const period = el('span', { class: 'badge' });
  const slider = el('input', {
    type: 'range',
    min: 0,
    max: STEPS_PER_DAY - 1,
    step: 1,
    value: 0,
  });
  let dayStart = 0;
  slider.addEventListener('input', () =>
    handlers.onSeek(dayStart + Number(slider.value)),
  );
  const play = el(
    'button',
    { onclick: () => handlers.onPlayToggle() },
    '▶ Play',
  );
  const now = el('table');
  const board = el('table');

  const years = Object.keys(FLEET_PLAN).map((y) => [y, `${y} fleet plan`]);
  const decide = (key) => (value) =>
    handlers.onDecision({ [key]: key === 'year' ? Number(value) : value });

  const root = el(
    'section',
    { class: 'port-twin', 'aria-label': 'Port twin scenario' },
    el(
      'h2',
      {},
      'Port of Hueneme twin',
      el(
        'button',
        {
          'aria-label': 'Collapse',
          onclick: (event) => {
            const collapsed = root.classList.toggle('collapsed');
            event.currentTarget.textContent = collapsed ? '▸' : '▾';
          },
        },
        '▾',
      ),
    ),
    el(
      'p',
      { class: 'sub' },
      `${berthLabel}. Modeled from the POH utilization workbook.`,
      approximate ? ' Equipment positions are approximate.' : '',
      ' Click any machine for its data.',
    ),
    el(
      'div',
      { class: 'row' },
      el('button', { onclick: () => handlers.onWalk() }, 'Walk to the berth'),
    ),
    el(
      'fieldset',
      {},
      el('legend', {}, 'Time'),
      el('div', { class: 'row' }, clock, period),
      slider,
      el(
        'div',
        { class: 'row' },
        el('button', { onclick: () => handlers.onCallDay(-1) }, '◀ Prev ship'),
        play,
        el('button', { onclick: () => handlers.onCallDay(1) }, 'Next ship ▶'),
      ),
    ),
    el('fieldset', {}, el('legend', {}, 'Right now'), now),
    el(
      'fieldset',
      {},
      el('legend', {}, 'Decisions'),
      el(
        'label',
        {},
        'Year',
        select('year', years, decisions.year, decide('year')),
      ),
      el(
        'label',
        {},
        'UTRs',
        select(
          'utrs',
          [
            ['plan', 'Fleet plan mix'],
            ['diesel', 'All diesel'],
            ['electric', 'All electric'],
          ],
          decisions.utrs,
          decide('utrs'),
        ),
      ),
      el(
        'label',
        {},
        'Harbor cranes',
        select(
          'cranes',
          [
            ['plan', 'Fleet plan mix'],
            ['plug-in', 'All plug-in'],
            ['diesel', 'All diesel'],
          ],
          decisions.cranes,
          decide('cranes'),
        ),
      ),
      el(
        'label',
        {},
        'UTR charging',
        select(
          'charging',
          Object.entries(CHARGING_STRATEGIES).map(([k, v]) => [k, v.label]),
          decisions.charging,
          decide('charging'),
        ),
      ),
      el(
        'label',
        {},
        'Site battery',
        select(
          'battery',
          [
            ['none', 'None'],
            ['1mwh', '1 MWh / 500 kW'],
          ],
          decisions.battery,
          decide('battery'),
        ),
      ),
      el(
        'label',
        {},
        'Reefer shore power',
        select(
          'shorePower',
          [
            ['off', 'Off'],
            ['on', 'On'],
          ],
          decisions.shorePower ? 'on' : 'off',
          (v) => handlers.onDecision({ shorePower: v === 'on' }),
        ),
      ),
    ),
    el('fieldset', {}, el('legend', {}, 'Year vs. today'), board),
    el(
      'p',
      { class: 'sub legend' },
      ...[
        ['Grid power', TWIN_COLORS.grid],
        ['Diesel', TWIN_COLORS.diesel],
        ['Charging', TWIN_COLORS.charging],
        ['Parked', TWIN_COLORS.parked],
      ].map(([label, hex]) =>
        el('span', {}, el('i', { style: `background:${hex}` }), label),
      ),
    ),
  );
  document.body.append(root);

  let card = null;

  return {
    setPlaying(playing) {
      play.textContent = playing ? '❚❚ Pause' : '▶ Play';
    },
    showFrame(frame) {
      const t = frame.time;
      dayStart = frame.step - (frame.step % STEPS_PER_DAY);
      slider.value = String(frame.step % STEPS_PER_DAY);
      clock.textContent = `${MONTHS[t.month - 1]} ${t.day} · ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
      period.textContent = PERIOD_TEXT[frame.period] ?? frame.period;
      const count = (list, state, diesel) =>
        list.filter(
          (u) =>
            u.state === state &&
            (diesel == null || (u.powertrain === 'diesel') === diesel),
        ).length;
      const rows = [
        [
          'Ship at berth',
          frame.ship ? `${frame.ship.type} (${frame.ship.id})` : 'None',
        ],
        [
          'Cranes working',
          `${count(frame.cranes, 'working')} of ${frame.cranes.length}`,
        ],
        [
          'UTRs working',
          `${count(frame.utrs, 'working', false)} electric, ${count(frame.utrs, 'working', true)} diesel`,
        ],
        ['UTRs charging', String(count(frame.utrs, 'charging'))],
        ['Site load', `${Math.round(frame.siteKw)} kW`],
        [
          'At the meter',
          `${Math.round(frame.meterKw)} kW${frame.batteryKw ? ` (battery ${frame.batteryKw > 0 ? '−' : '+'}${Math.round(Math.abs(frame.batteryKw))} kW)` : ''}`,
        ],
        ['Diesel burn', `${frame.dieselGallonsPerHour.toFixed(1)} gal/hr`],
        ['Equipment CO2', `${Math.round(frame.co2KgPerHour)} kg/hr`],
      ];
      now.replaceChildren(
        ...rows.map(([a, b]) =>
          el('tr', {}, el('td', {}, a), el('td', { class: 'v' }, b)),
        ),
      );
    },
    showScoreboard(rows) {
      board.replaceChildren(
        el(
          'tr',
          {},
          el('td', {}, ''),
          el('td', { class: 'v' }, 'Scenario'),
          el('td', { class: 'd' }, 'vs today'),
        ),
        ...rows.map((row) => {
          const delta = row.value - row.base;
          const same = Math.abs(delta) < (row.unit === '$' ? 1 : 0.5);
          const text = same
            ? '—'
            : `${delta > 0 ? '+' : '−'}${fmt(row, Math.abs(delta))}`;
          return el(
            'tr',
            {},
            el('td', {}, row.label),
            el('td', { class: 'v' }, fmt(row, row.value)),
            el(
              'td',
              { class: `d ${same ? '' : delta > 0 ? 'up' : 'down'}` },
              text,
            ),
          );
        }),
      );
    },
    showCard(data, x, y) {
      card?.remove();
      if (!data) {
        card = null;
        return;
      }
      card = el(
        'div',
        { class: 'port-twin-card', role: 'dialog' },
        el(
          'button',
          { 'aria-label': 'Close', onclick: () => handlers.onCardClose?.() },
          '×',
        ),
        el('h3', {}, data.title),
        el(
          'table',
          {},
          ...data.rows.map(([a, b]) =>
            el('tr', {}, el('td', {}, a), el('td', {}, b)),
          ),
        ),
      );
      card.style.left = `${Math.min(x + 14, window.innerWidth - 320)}px`;
      card.style.top = `${Math.min(y + 14, window.innerHeight - 260)}px`;
      document.body.append(card);
    },
    destroy() {
      card?.remove();
      root.remove();
    },
  };
}
