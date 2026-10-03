import { esc, P, C, gate } from './drawing/symbols.js';
import { renderers } from './drawing/catalog-symbols.js';
import '@visual-storytelling/core/style.css';
import './drawing/art.css';
import './catalog.css';
import catalog from './catalog.json' with { type: 'json' };
import { theme, widgetState, exportSVG, download, SvgLayout } from '@visual-storytelling/core';

const root = document.getElementById('computer-shapes-preview');
const hero = root.querySelector('.parts-hero');
const grid = root.querySelector('.parts-grid');
const viewButton = root.querySelector('.parts-view');
const appearance = theme(root),
  abort = new AbortController();
const state = { family: 'hardware', kind: 'gpu', inside: false, ports: false };
const parts = catalog;

function symbol(id, width, height, { mini = false, inside = false, ports = false } = {}) {
  const scale = Math.min((width - 12) / 360, (height - 12) / 240);
  const T = (x, y, value, size = 12, cls = '') =>
    mini
      ? ''
      : `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" class="${cls}" font-size="${Math.max(size, 11 / scale)}">${esc(value)}</text>`;
  const ctx = { T, mini, inside },
    item = parts.find((p) => p.id === id);
  const shape = (renderers[id] || ((c) => gate(c, id)))(ctx);
  let connectors = '';
  if (ports)
    connectors = shape.ports
      .map((p) => {
        const px = p.x + p.dx,
          py = p.y + p.dy;
        return (
          P(`M ${p.x} ${p.y} L ${px} ${py}`) +
          C(px, py, 4 / scale, 'port-ring') +
          (p.dx || p.dy ? T(px, py + (p.dy < 0 ? -12 : 15) / scale, p.label, 11, 'mono') : '')
        );
      })
      .join('');
  const x = (width - 360 * scale) / 2,
    y = (height - 240 * scale) / 2;
  return `<title>${esc(item.name)} — ${esc(item.type)}</title><desc>${esc(inside ? item.insideCaption || item.caption : item.caption)}</desc><g class="part-symbol" transform="translate(${x} ${y}) scale(${scale})">${shape.body}${connectors}</g>`;
}
function draw() {
  const box = hero.getBoundingClientRect();
  if (!box.width) return;
  hero.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  hero.innerHTML = symbol(state.kind, box.width, box.height, state);
  hero.setAttribute('aria-label', parts.find((p) => p.id === state.kind).name);
  grid.querySelectorAll('svg').forEach((svg) => {
    const r = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    svg.innerHTML = symbol(svg.dataset.symbol, r.width, r.height, { mini: true });
  });
}
function render() {
  const item = parts.find((p) => p.id === state.kind);
  root
    .querySelectorAll('[data-family]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.family === state.family)));
  grid.innerHTML = parts
    .filter((p) => p.family === state.family)
    .map(
      (p) =>
        `<button type="button" class="parts-tile" data-kind="${p.id}" aria-pressed="${p.id === state.kind}"><svg data-symbol="${p.id}" aria-hidden="true"></svg><span>${esc(p.name)}</span></button>`,
    )
    .join('');
  root.querySelector('.parts-name').textContent = item.name;
  root.querySelector('.parts-type').textContent = item.type;
  root.querySelector('.parts-caption').textContent = state.inside
    ? item.insideCaption || item.caption
    : item.caption;
  viewButton.hidden = !item.action;
  viewButton.querySelector('span').textContent = item.action || '';
  viewButton.setAttribute('aria-pressed', String(state.inside));
  root.querySelector('.parts-ports').checked = state.ports;
  draw();
}
function save() {
  storage.save({
    modelContent: { selectedComputerShape: state.kind, inside: state.inside, ports: state.ports },
    privateContent: { version: 3, kind: state.kind, inside: state.inside, ports: state.ports },
  });
}
function restore(snapshot) {
  const next = snapshot?.privateContent,
    item = parts.find((p) => p.id === next?.kind);
  if (!item || next.version !== 3) return false;
  Object.assign(state, {
    family: item.family,
    kind: item.id,
    inside: !!item.action && !!next.inside,
    ports: !!next.ports,
  });
  return true;
}
root.querySelectorAll('[data-family]').forEach((b) =>
  b.addEventListener(
    'click',
    () => {
      state.family = b.dataset.family;
      state.kind = parts.find((p) => p.family === state.family).id;
      state.inside = false;
      render();
      save();
    },
    { signal: abort.signal },
  ),
);
grid.addEventListener(
  'click',
  (event) => {
    const tile = event.target.closest('[data-kind]');
    if (!tile) return;
    state.kind = tile.dataset.kind;
    state.inside = false;
    render();
    save();
    grid.querySelector(`[data-kind="${state.kind}"]`).focus({ preventScroll: true });
  },
  { signal: abort.signal },
);
viewButton.addEventListener(
  'click',
  () => {
    state.inside = !state.inside;
    render();
    save();
  },
  { signal: abort.signal },
);
root.querySelector('.parts-ports').addEventListener(
  'change',
  (e) => {
    state.ports = e.target.checked;
    draw();
    save();
  },
  { signal: abort.signal },
);
const storage = widgetState('computer-catalog', (snapshot) => {
  if (restore(snapshot)) render();
});
restore(storage.read());
render();
const observer = new ResizeObserver(draw);
observer.observe(hero);
root
  .querySelector('[data-download]')
  .addEventListener(
    'click',
    async () =>
      download(await exportFigure(), state.kind + (state.inside ? '-inside' : '') + '.svg'),
    { signal: abort.signal },
  );
async function exportFigure() {
  const bounds = SvgLayout.box(hero.querySelector('.part-symbol'), hero);
  const document = new DOMParser().parseFromString(await exportSVG(hero), 'image/svg+xml');
  const svg = document.documentElement;
  const width = bounds.width + 20,
    height = bounds.height + 20;
  svg.setAttribute('viewBox', `${bounds.x - 10} ${bounds.y - 10} ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  return new XMLSerializer().serializeToString(svg);
}
root.scene = window.explainer = {
  svg: () => hero,
  exportSVG: exportFigure,
  snapshot: () => ({ ...state }),
  setTheme: (value) => appearance.set(value),
  dispose() {
    observer.disconnect();
    abort.abort();
    storage.dispose();
    appearance.dispose();
    root.replaceChildren();
  },
};
