/**
 * One navigation bar for every Port Environmental OS page: a breadcrumb that
 * follows the URL pattern (globe › ports › state › port › page) and buttons
 * to every other page and layer, so no page is a dead end.
 *
 * The page model (`NAV_LINKS`, `breadcrumbs`, `currentPage`) is pure; only
 * `mountSiteNav` and `followNavRequest` touch the DOM.
 */
import { TWIN_PATH } from '../scenarioStore.js';

/** The rail panel that holds the twin's layer switches (meters, assets...). */
export const TWIN_PANEL_ID = 'poh-twin-panel';
/** Query flags another page sets to open something once this page loads. */
export const PANEL_PARAM = 'panel';
export const INTERVIEW_PARAM = 'interview';

const PORT = Object.freeze({
  category: { slug: 'ports', label: 'Ports' },
  state: { slug: 'california', label: 'California' },
  name: 'Port of Hueneme',
  path: TWIN_PATH,
});

/** Every page and layer the bar links to, in the order shown. */
export const NAV_LINKS = Object.freeze([
  { id: 'globe', label: 'Globe', href: '/' },
  { id: 'twin', label: '3D port twin', href: TWIN_PATH },
  {
    id: 'layers',
    label: 'Twin layers',
    href: `${TWIN_PATH}?${PANEL_PARAM}=twin`,
    title: 'Meters, power flow, assets and ships on the 3D twin',
  },
  { id: 'scenarios', label: 'Scenario builder', href: '/scenarios' },
  {
    id: 'interview',
    label: 'Build by interview',
    href: `/scenarios?${INTERVIEW_PARAM}=1`,
  },
  { id: 'compare', label: 'Compare', href: '/scenarios#compare' },
  { id: 'admin', label: 'Asset admin', href: '/admin' },
]);

const PAGE_LABELS = Object.freeze({
  scenarios: 'Scenario builder',
  admin: 'Asset admin',
});

const trimPath = (pathname) =>
  String(pathname ?? '/')
    .replace(/\.html$/, '')
    .replace(/\/+$/, '') || '/';

/**
 * Which page a path is: 'globe', 'twin', 'scenarios', 'admin' or null for a
 * path this bar does not know.
 */
export function currentPage(pathname) {
  const path = trimPath(pathname);
  if (path === '/') return 'globe';
  if (path === PORT.path) return 'twin';
  if (path === '/scenarios') return 'scenarios';
  if (path === '/admin') return 'admin';
  return null;
}

/**
 * The breadcrumb for a path: a list of `{ label, href }`, where the last
 * entry (the page itself) has `href: null`. Every page under the port sits
 * below it: Globe › Ports › California › Port of Hueneme › Scenario builder.
 */
export function breadcrumbs(pathname) {
  const page = currentPage(pathname);
  const globe = { label: 'Globe', href: '/' };
  if (page === 'globe' || page === null) return [{ ...globe, href: null }];
  const port = [
    globe,
    { label: PORT.category.label, href: null },
    { label: PORT.state.label, href: null },
    { label: PORT.name, href: page === 'twin' ? null : PORT.path },
  ];
  if (page === 'twin') return port;
  return [...port, { label: PAGE_LABELS[page], href: null }];
}

/** The links to show on a page: every link except the page itself. */
export function linksFor(pathname) {
  const page = currentPage(pathname);
  return NAV_LINKS.filter((link) => link.id !== page);
}

const STYLE_ID = 'portos-nav-style';
const CSS = `
.portos-nav{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;
  font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-sizing:border-box}
.portos-nav ol{display:flex;flex-wrap:wrap;align-items:center;list-style:none;margin:0;padding:0;gap:2px}
.portos-nav li{display:inline-flex;align-items:center}
.portos-nav li+li::before{content:'\\203A';margin:0 6px;opacity:.6}
.portos-nav li[aria-current]{font-weight:600}
.portos-nav .links{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}
.portos-nav .links a{border-radius:6px;padding:3px 9px;text-decoration:none;white-space:nowrap}
.portos-nav.page{margin:0 0 14px;padding:8px 12px;border-radius:8px;
  background:var(--surface-1,#fcfcfb);border:1px solid var(--border,#e2e1dc);color:var(--text-secondary,#52514e)}
.portos-nav.page a{color:var(--accent,#2a78d6)}
.portos-nav.page .links a{border:1px solid var(--border,#e2e1dc);background:var(--surface-0,#f4f4f1)}
.portos-nav.page .links a:hover{border-color:var(--accent,#2a78d6)}
.portos-nav.globe{position:fixed;top:100px;right:16px;z-index:45;
  max-width:min(600px,calc(100vw - 32px));padding:6px 10px;border-radius:10px;color:#c9d2de;
  background:rgba(10,14,22,.86);border:1px solid rgba(32,231,242,.35);backdrop-filter:blur(6px)}
.portos-nav.globe a{color:#20e7f2}
.portos-nav.globe li[aria-current]{color:#e8ecf2}
.portos-nav.globe .links a{border:1px solid #2b3648;background:#141b28}
.portos-nav.globe .links a:hover{border-color:#20e7f2}
.portos-nav.globe.folded .links{display:none}
.portos-nav .fold{background:none;border:0;color:inherit;cursor:pointer;font:inherit;padding:0 2px;opacity:.8}
@media (max-width:720px){.portos-nav.globe{top:auto;bottom:64px}}
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.append(doc.createTextNode(CSS));
  doc.head.append(style);
}

function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs))
    if (value != null) node.setAttribute(key, value);
  for (const child of children)
    node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
  return node;
}

/** Open the twin's layer panel from its rail button, if the page has one. */
export function openTwinPanel(doc = document) {
  const panel = doc.querySelector(`[data-panel-id="${TWIN_PANEL_ID}"]`);
  if (panel && !panel.classList.contains('collapsed')) return true;
  const button = doc.querySelector(`[data-rail-item="${TWIN_PANEL_ID}"]`);
  if (!button) return false;
  button.click();
  return true;
}

/** Wait (a while) for `test` to pass, polling as the app builds its UI. */
function whenReady(test, { tries = 60, every = 500 } = {}) {
  let left = tries;
  const tick = () => {
    if (test() || --left <= 0) return;
    setTimeout(tick, every);
  };
  tick();
}

/**
 * Act on the flags a link from another page carried: `?panel=twin` opens the
 * twin's layer panel, `?interview=1` starts "Build by interview". The flag is
 * removed from the address once handled so a reload does not repeat it.
 */
export function followNavRequest({ doc = document, win = window } = {}) {
  const url = new URL(win.location.href);
  const panel = url.searchParams.get(PANEL_PARAM);
  const interview = url.searchParams.get(INTERVIEW_PARAM);
  if (!panel && !interview) return;
  url.searchParams.delete(PANEL_PARAM);
  url.searchParams.delete(INTERVIEW_PARAM);
  win.history.replaceState(win.history.state, '', url.href);
  if (panel) whenReady(() => openTwinPanel(doc));
  if (interview)
    whenReady(() => {
      const button = doc.getElementById('interview');
      if (!button) return false;
      button.click();
      return true;
    });
}

/**
 * Put the bar on the page. `variant` 'page' is an in-flow bar for the
 * scenario builder and admin pages (pass `host`, it is prepended there);
 * 'globe' floats over the 3D globe. Returns the bar element.
 */
export function mountSiteNav({
  doc = document,
  win = window,
  host = null,
  variant = 'page',
  pathname = win.location.pathname,
} = {}) {
  ensureStyle(doc);
  doc.querySelector('nav.portos-nav')?.remove();
  const page = currentPage(pathname);
  const trail = breadcrumbs(pathname);
  const crumbs = trail.map((crumb, index) =>
    crumb.href
      ? el(doc, 'li', {}, el(doc, 'a', { href: crumb.href }, crumb.label))
      : el(
          doc,
          'li',
          index === trail.length - 1 ? { 'aria-current': 'page' } : {},
          crumb.label,
        ),
  );
  const links = linksFor(pathname).map((link) => {
    const a = el(
      doc,
      'a',
      { href: link.href, title: link.title ?? null, 'data-nav': link.id },
      link.label,
    );
    // Already on the twin: open its layer panel instead of reloading.
    if (link.id === 'layers' && page === 'twin')
      a.addEventListener('click', (event) => {
        if (openTwinPanel(doc)) event.preventDefault();
      });
    // Already on the builder: start the interview in place.
    if (link.id === 'interview' && page === 'scenarios')
      a.addEventListener('click', (event) => {
        const button = doc.getElementById('interview');
        if (!button) return;
        event.preventDefault();
        button.click();
      });
    if (link.id === 'compare' && page === 'scenarios')
      a.setAttribute('href', '#compare');
    return a;
  });
  const nav = el(
    doc,
    'nav',
    { class: `portos-nav ${variant}`, 'aria-label': 'Site' },
    el(doc, 'ol', { 'aria-label': 'Breadcrumb' }, ...crumbs),
    el(doc, 'div', { class: 'links' }, ...links),
  );
  if (variant === 'globe') {
    const fold = el(
      doc,
      'button',
      { type: 'button', class: 'fold', 'aria-expanded': 'true' },
      'Hide links',
    );
    fold.addEventListener('click', () => {
      const folded = nav.classList.toggle('folded');
      fold.setAttribute('aria-expanded', String(!folded));
      fold.replaceChildren(
        doc.createTextNode(folded ? 'Show links' : 'Hide links'),
      );
    });
    nav.append(fold);
    doc.body.append(nav);
  } else {
    (host ?? doc.body).prepend(nav);
  }
  return nav;
}
