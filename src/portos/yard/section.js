/**
 * The "Yard zones and moves" section of the POH Twin panel: the yard's
 * zones with their moves and emissions per year, and each kind of cargo
 * move as a chain of machine segments (crane, UTR, reach stacker, truck...),
 * coloured by how much of that machine's work runs on electricity in the
 * scenario playing. Picking a zone outlines it on the map and opens its
 * card; picking a move lists its segments with per-move numbers.
 *
 * Plain DOM; every input is a dropdown or a click, nothing is typed.
 */
import { el } from '../fleet/form.js';
import { PLACES, ZONE_METRICS } from './model.js';

const STYLE_ID = 'port-yard-style';
const CSS = `
.port-yard summary{cursor:pointer;color:#20e7f2;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px}
.port-yard table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;margin-top:4px}
.port-yard th{color:#9aa6b8;font-weight:500;text-align:left;font-size:10px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.1)}
.port-yard th.v,.port-yard td.v{text-align:right}
.port-yard td{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle}
.port-yard tr.pick{cursor:pointer}.port-yard tr.pick:hover td{background:rgba(32,231,242,.08)}
.port-yard tr.on td{background:rgba(32,231,242,.16)}
.port-yard .chips{display:inline-flex;gap:2px}
.port-yard .chip{display:inline-block;width:15px;height:15px;line-height:15px;text-align:center;border-radius:3px;font-size:10px;font-weight:700;color:#0b0f17}
.port-yard .ends{color:#9aa6b8;font-size:10px}
.port-yard .muted{color:#6c778a}
.port-yard .legs td{font-size:11px;color:#c7d2e0;padding-left:6px}
.port-yard .totals{margin:4px 0;color:#e8ecf2}
`;

const ELECTRIC = [124, 255, 138];
const DIESEL = [255, 140, 58];
const n = (v, digits = 0) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });

/** Chip colour from diesel orange (0) to electric green (1). */
export function chipColor(share) {
  const mix = DIESEL.map((d, i) => Math.round(d + (ELECTRIC[i] - d) * share));
  return `rgb(${mix.join(',')})`;
}

const placesText = (ends) =>
  ends
    .split('>')
    .map((code) => PLACES[code] ?? code)
    .join(' → ');

function chips(segments) {
  return el(
    'span',
    { class: 'chips' },
    ...segments.map((segment) =>
      el(
        'span',
        {
          class: 'chip',
          style: `background:${chipColor(segment.electricShare)}`,
          title: `${segment.label}: ${Math.round(segment.electricShare * 100)}% electric`,
        },
        segment.code,
      ),
    ),
  );
}

/**
 * @param {object} args
 * @param {Element} args.host where the section goes
 * @param {(metric: string) => void} args.onMetric
 * @param {(zoneId: string|null, at?: {x:number,y:number}) => void} args.onZone
 */
export function createYardSection({ host, onMetric, onZone }) {
  if (!document.getElementById(STYLE_ID))
    document.head.append(el('style', { id: STYLE_ID }, CSS));
  let model = null;
  let metric = 'moves';
  let zonePicked = null;
  let movePicked = null;

  const metricSelect = el(
    'select',
    {
      name: 'yard-metric',
      onchange: () => {
        metric = metricSelect.value;
        onMetric(metric);
        draw();
      },
    },
    ...Object.entries(ZONE_METRICS).map(([key, m]) =>
      el('option', { value: key }, m.label),
    ),
  );
  const totals = el('p', { class: 'totals' });
  const zoneTable = el('table');
  const moveTable = el('table');
  const note = el('p', { class: 'sub' });

  function drawZones() {
    const m = ZONE_METRICS[metric];
    // Sorted by the colour metric; the last column shows it, or CO2 when
    // the zones are coloured by moves (already the middle column).
    const shown = metric === 'moves' ? ZONE_METRICS.co2 : m;
    const rows = [...model.zones].sort((a, b) => m.of(b) - m.of(a));
    zoneTable.replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Zone'),
        el('th', { class: 'v' }, 'Moves/yr'),
        el('th', { class: 'v' }, shown.unit),
      ),
      ...rows.map((zone) =>
        el(
          'tr',
          {
            class: `pick${zone.id === zonePicked ? ' on' : ''}`,
            onclick: (event) => {
              zonePicked = zone.id === zonePicked ? null : zone.id;
              const box = event.currentTarget.getBoundingClientRect();
              onZone(zonePicked, { x: box.right, y: box.top });
              drawZones();
            },
          },
          el(
            'td',
            {},
            zone.label,
            zone.outline ? '' : el('span', { class: 'muted' }, ' (not drawn)'),
          ),
          el('td', { class: 'v' }, n(zone.moves)),
          el('td', { class: 'v' }, n(shown.of(zone), 1)),
        ),
      ),
    );
  }

  function drawMoves() {
    const rows = [];
    rows.push(
      el(
        'tr',
        {},
        el('th', {}, 'Move'),
        el('th', {}, 'Segments'),
        el('th', { class: 'v' }, 'Per yr'),
        el('th', { class: 'v' }, 'kg CO2/move'),
      ),
    );
    for (const move of model.moves) {
      rows.push(
        el(
          'tr',
          {
            class: `pick${move.id === movePicked ? ' on' : ''}`,
            onclick: () => {
              movePicked = move.id === movePicked ? null : move.id;
              drawMoves();
            },
          },
          el(
            'td',
            {},
            move.label,
            el(
              'div',
              { class: 'ends' },
              `${move.places}: ${placesText(move.places)}`,
            ),
          ),
          el('td', {}, chips(move.segments)),
          el('td', { class: 'v' }, n(move.count)),
          el('td', { class: 'v' }, n(move.perMove.co2Kg, 1)),
        ),
      );
      if (move.id !== movePicked) continue;
      for (const segment of move.segments) {
        const zone = model.zones.find((z) => z.id === segment.zone);
        rows.push(
          el(
            'tr',
            { class: 'legs' },
            el(
              'td',
              { colspan: 2 },
              `${segment.code} ${segment.label}, ${zone?.label ?? segment.zone}`,
              el(
                'div',
                { class: 'ends' },
                `${n(segment.minutes, 1)} min, ${Math.round(segment.electricShare * 100)}% electric: ` +
                  `${n(segment.perMove.kwh, 2)} kWh, ${n(segment.perMove.dieselGallons + segment.perMove.gasolineGallons, 3)} gal`,
              ),
            ),
            el('td', { class: 'v' }, ''),
            el('td', { class: 'v' }, n(segment.perMove.co2Kg, 2)),
          ),
        );
      }
    }
    moveTable.replaceChildren(...rows);
  }

  function draw() {
    if (!model) return;
    const t = model.totals;
    totals.textContent =
      `${n(t.moves)} moves a year${model.year ? ` in ${model.year}` : ''}: ` +
      `${n(t.co2Kg / 1000)} t CO2, ${n(t.kwh / 1000)} MWh from the grid, ` +
      `${n(t.dieselGallons)} gal diesel.`;
    drawZones();
    drawMoves();
  }

  note.textContent =
    'Segment letters: C crane, U UTR, S reach stacker, F forklift, H heavy forklift, D vehicle driven, P driver van, T truck. Green is electric, orange diesel, set by the scenario year and the UTR and crane decisions above. Move counts and segment times are assumptions until POH move logs replace them.';

  const root = el(
    'details',
    { class: 'port-yard' },
    el('summary', {}, 'Yard zones and moves'),
    el(
      'p',
      { class: 'sub' },
      'Every cargo move split into the machines that handle it, priced per move and added up per zone.',
    ),
    totals,
    el('label', {}, 'Colour zones by', metricSelect),
    zoneTable,
    moveTable,
    note,
  );
  host.replaceChildren(root);

  return {
    root,
    /** Show a new yard model (after a scenario change). */
    show(next) {
      model = next;
      draw();
    },
    /** Mark a zone picked from the map. */
    pickZone(id) {
      zonePicked = id;
      root.open = true;
      if (model) drawZones();
    },
    destroy() {
      root.remove();
    },
  };
}
