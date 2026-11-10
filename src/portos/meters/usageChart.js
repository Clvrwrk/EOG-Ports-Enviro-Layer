/**
 * The usage graph: a stacked 24-hour load curve by end use with a cursor at
 * the twin's clock and the day's running kWh, and a red line at the
 * interval that sets the month's demand charge when it falls on this day.
 * Draws into its own fixed box at the bottom right of the page.
 */
const SVG = 'http://www.w3.org/2000/svg';
const W = 440;
const H = 110;
const STYLE_ID = 'port-usage-style';
const CSS = `
.port-usage{position:fixed;left:472px;bottom:100px;z-index:40;width:${W + 20}px;background:rgba(10,14,22,.9);color:#e8ecf2;
  border:1px solid #2b3648;border-radius:8px;padding:8px 10px;font:12px/1.4 system-ui,sans-serif;pointer-events:auto}
.port-usage h3{margin:0;font-size:12px;display:flex;justify-content:space-between;gap:8px}
.port-usage h3 b{font-variant-numeric:tabular-nums;color:#20e7f2}
.port-usage svg{display:block;width:100%;height:${H}px;margin:4px 0}
.port-usage .axis{display:flex;justify-content:space-between;color:#9aa6b8;font-size:10px}
.port-usage .keys span{display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:10px}
.port-usage .keys i{width:8px;height:8px;border-radius:2px;display:inline-block}
.port-usage p{margin:4px 0 0;color:#9aa6b8;font-size:10px}
@media (max-width:900px){.port-usage{display:none}}`;

const n0 = (value) => Math.round(value).toLocaleString('en-US');

function node(tag, attrs = {}, text) {
  const item = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs))
    item.setAttribute(key, value);
  if (text != null) item.textContent = text;
  return item;
}

/** SVG path for one stacked band between two running totals. */
export function bandPath(lower, upper, top, width = W, height = H) {
  const count = upper.length;
  const x = (i) => ((i / (count - 1)) * width).toFixed(1);
  const y = (kw) => (height - (kw / top) * height).toFixed(1);
  let path = '';
  for (let i = 0; i < count; i += 1)
    path += `${i ? 'L' : 'M'}${x(i)} ${y(upper[i])}`;
  for (let i = count - 1; i >= 0; i -= 1) path += `L${x(i)} ${y(lower[i])}`;
  return `${path}Z`;
}

export function createUsageChart() {
  if (!document.getElementById(STYLE_ID))
    document.head.append(node('style', { id: STYLE_ID }, CSS));
  const title = node('h3');
  const heading = node('span', {}, 'Port electricity today');
  const figure = node('b');
  title.append(heading, figure);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  const axis = node('div', { class: 'axis' });
  for (const label of ['00:00', '06:00', '12:00', '18:00', '24:00'])
    axis.append(node('span', {}, label));
  const keys = node('div', { class: 'keys' });
  const note = node('p');
  const root = node('section', {
    class: 'port-usage',
    'aria-label': 'Port electricity use over the day',
  });
  root.append(title, svg, axis, keys, note);
  document.body.append(root);
  let drawnDay = null;
  let cursor = null;

  return {
    /** Draw a dayProfile; the bands redraw only when the day changes. */
    show(profile, signature = '', { demandStepOfDay = null } = {}) {
      const dayKey = `${profile.dayStart}:${signature}:${demandStepOfDay}`;
      const top = Math.max(1, profile.peakKw) * 1.08;
      if (dayKey !== drawnDay) {
        drawnDay = dayKey;
        svg.replaceChildren();
        keys.replaceChildren();
        let lower = new Float64Array(profile.totalKw.length);
        for (const row of profile.series) {
          const upper = lower.map((kw, i) => kw + row.kw[i]);
          const band = document.createElementNS(SVG, 'path');
          band.setAttribute('d', bandPath(lower, upper, top));
          band.setAttribute('fill', row.color);
          band.setAttribute('fill-opacity', '0.8');
          svg.append(band);
          lower = upper;
          const key = node('span');
          key.append(
            node('i', { style: `background:${row.color}` }),
            row.label,
          );
          keys.append(key);
        }
        cursor = document.createElementNS(SVG, 'line');
        cursor.setAttribute('y1', '0');
        cursor.setAttribute('y2', String(H));
        cursor.setAttribute('stroke', '#ffffff');
        cursor.setAttribute('stroke-width', '1.5');
        cursor.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(cursor);
        if (demandStepOfDay != null) {
          const mark = document.createElementNS(SVG, 'line');
          const at = (
            (demandStepOfDay / (profile.totalKw.length - 1)) *
            W
          ).toFixed(1);
          for (const [key, value] of Object.entries({
            x1: at,
            x2: at,
            y1: 0,
            y2: H,
            stroke: '#ff4d4d',
            'stroke-width': 2,
            'stroke-dasharray': '4 3',
            'vector-effect': 'non-scaling-stroke',
          }))
            mark.setAttribute(key, value);
          svg.append(mark);
        }
        note.textContent = `${demandStepOfDay != null ? 'Red line: the interval that sets this month\u2019s demand charge. ' : ''}Modeled${profile.sample ? ' from sample numbers' : ' from monthly bills and the scenario'}; no 15-minute meter data yet. Peak today ${n0(profile.peakKw)} kW, ${n0(profile.kwhDay)} kWh over the day.`;
      }
      const x = (profile.stepOfDay / (profile.totalKw.length - 1)) * W;
      cursor.setAttribute('x1', x.toFixed(1));
      cursor.setAttribute('x2', x.toFixed(1));
      figure.textContent = `${n0(profile.nowKw)} kW now · ${n0(profile.kwhSoFar)} kWh so far`;
      svg.setAttribute(
        'aria-label',
        `Load now ${n0(profile.nowKw)} kW, ${n0(profile.kwhSoFar)} kWh used so far today`,
      );
    },
    destroy() {
      root.remove();
    },
  };
}
