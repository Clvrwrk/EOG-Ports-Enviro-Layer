/**
 * Small SVG charts for the scenario page: a 15-minute load line chart with a
 * crosshair tooltip and a stacked monthly bar chart with per-bar tooltips.
 * Colors come from CSS custom properties so light and dark modes both work.
 */
const SVG = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10])
    if (step * power >= value) return step * power;
  return 10 * power;
}

function tooltip(container) {
  let tip = container.querySelector('.tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    container.appendChild(tip);
  }
  return tip;
}

function placeTip(tip, container, x, y) {
  const box = container.getBoundingClientRect();
  tip.style.display = 'block';
  const left = Math.min(Math.max(0, x + 12), box.width - tip.offsetWidth);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
}

function axisY(svg, { left, right, top, height, max, format }) {
  for (let i = 0; i <= 4; i += 1) {
    const value = (max * i) / 4;
    const y = top + height - (height * i) / 4;
    el(
      'line',
      {
        x1: left,
        x2: right,
        y1: y,
        y2: y,
        stroke: 'var(--grid)',
        'stroke-width': 1,
      },
      svg,
    );
    el(
      'text',
      { x: left - 6, y: y + 4, 'text-anchor': 'end' },
      svg,
    ).textContent = format(value);
  }
}

/**
 * Line chart of one or more kW series over a window of steps.
 * @param {HTMLElement} container
 * @param {{ series: { label: string, color: string, values: ArrayLike<number> }[],
 *   labels: string[], tickEvery: number, format: (v: number) => string }} spec
 */
export function lineChart(container, { series, labels, tickEvery, format }) {
  container.replaceChildren();
  const width = 860;
  const height = 260;
  const margin = { left: 56, right: 12, top: 10, bottom: 26 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const n = labels.length;
  let peak = 0;
  for (const s of series)
    for (let i = 0; i < n; i += 1) peak = Math.max(peak, s.values[i]);
  const max = niceMax(peak * 1.05);
  const x = (i) => margin.left + (n > 1 ? (plotW * i) / (n - 1) : 0);
  const y = (v) => margin.top + plotH - (plotH * v) / max;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
  axisY(svg, {
    left: margin.left,
    right: width - margin.right,
    top: margin.top,
    height: plotH,
    max,
    format,
  });
  for (let i = 0; i < n; i += tickEvery)
    el(
      'text',
      { x: x(i), y: height - 8, 'text-anchor': 'start' },
      svg,
    ).textContent = labels[i].split(' ')[0];
  for (const s of series) {
    let d = '';
    for (let i = 0; i < n; i += 1)
      d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.values[i]).toFixed(1)}`;
    el(
      'path',
      {
        d,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      },
      svg,
    );
  }
  const cross = el(
    'line',
    {
      y1: margin.top,
      y2: margin.top + plotH,
      stroke: 'var(--text-muted)',
      'stroke-width': 1,
      visibility: 'hidden',
    },
    svg,
  );
  const dots = series.map((s) =>
    el(
      'circle',
      {
        r: 4,
        fill: s.color,
        stroke: 'var(--surface-1)',
        'stroke-width': 2,
        visibility: 'hidden',
      },
      svg,
    ),
  );
  const hit = el(
    'rect',
    {
      x: margin.left,
      y: margin.top,
      width: plotW,
      height: plotH,
      fill: 'transparent',
    },
    svg,
  );
  container.appendChild(svg);
  const tip = tooltip(container);
  const hide = () => {
    tip.style.display = 'none';
    cross.setAttribute('visibility', 'hidden');
    for (const dot of dots) dot.setAttribute('visibility', 'hidden');
  };
  hit.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const scale = width / box.width;
    const px = (event.clientX - box.left) * scale;
    const i = Math.max(
      0,
      Math.min(n - 1, Math.round(((px - margin.left) / plotW) * (n - 1))),
    );
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      dots[k].setAttribute('cx', x(i));
      dots[k].setAttribute('cy', y(s.values[i]));
      dots[k].setAttribute('visibility', 'visible');
    });
    tip.replaceChildren();
    const head = document.createElement('div');
    head.textContent = labels[i];
    tip.appendChild(head);
    for (const s of series) {
      const row = document.createElement('div');
      row.textContent = `${s.label}: ${format(s.values[i])}`;
      tip.appendChild(row);
    }
    placeTip(tip, container, x(i) / scale, event.clientY - box.top);
  });
  hit.addEventListener('pointerleave', hide);
}

/**
 * Stacked bar chart, one bar per category.
 * @param {{ categories: string[], stacks: { label: string, color: string, values: number[] }[],
 *   format: (v: number) => string }} spec
 */
export function stackedBars(container, { categories, stacks, format }) {
  container.replaceChildren();
  const width = 860;
  const height = 240;
  const margin = { left: 64, right: 12, top: 10, bottom: 26 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const totals = categories.map((_, i) =>
    stacks.reduce((sum, s) => sum + s.values[i], 0),
  );
  const max = niceMax(Math.max(...totals) * 1.05);
  const band = plotW / categories.length;
  const barW = Math.min(36, band * 0.6);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
  axisY(svg, {
    left: margin.left,
    right: width - margin.right,
    top: margin.top,
    height: plotH,
    max,
    format,
  });
  const tip = tooltip(container);
  categories.forEach((category, i) => {
    const cx = margin.left + band * i + band / 2;
    let base = margin.top + plotH;
    const group = el('g', {}, svg);
    stacks.forEach((s, k) => {
      const h = (plotH * s.values[i]) / max;
      if (h <= 0) return;
      const top =
        k === stacks.length - 1 ||
        stacks.slice(k + 1).every((t) => !(t.values[i] > 0));
      // 2px surface gap between stacked segments.
      const gap = k > 0 ? 2 : 0;
      el(
        'rect',
        {
          x: cx - barW / 2,
          y: base - h,
          width: barW,
          height: Math.max(0, h - gap),
          rx: top ? 4 : 0,
          fill: s.color,
        },
        group,
      );
      base -= h;
    });
    el(
      'text',
      { x: cx, y: height - 8, 'text-anchor': 'middle' },
      svg,
    ).textContent = category;
    const hit = el(
      'rect',
      {
        x: cx - band / 2,
        y: margin.top,
        width: band,
        height: plotH,
        fill: 'transparent',
      },
      svg,
    );
    hit.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect();
      tip.replaceChildren();
      const head = document.createElement('div');
      head.textContent = `${category}: ${format(totals[i])}`;
      tip.appendChild(head);
      for (const s of stacks) {
        const row = document.createElement('div');
        row.textContent = `${s.label}: ${format(s.values[i])}`;
        tip.appendChild(row);
      }
      placeTip(
        tip,
        container,
        event.clientX - box.left,
        event.clientY - box.top,
      );
    });
    hit.addEventListener('pointerleave', () => {
      tip.style.display = 'none';
    });
  });
  container.appendChild(svg);
}
