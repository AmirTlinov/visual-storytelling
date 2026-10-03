import { SketchControls, SceneShell, SceneHistory, rough } from '@visual-storytelling/core';
import { SketchShapes } from './shapes.js';
import { ShapeModel } from './shape-model.js';
import { ShapeEditor } from './shape-editor.js';
window.galleryReady = (async () => {
  await document.fonts.ready;
  const root = document.getElementById('ve-scene');
  const initial = {width: 5, count: 4, shape: 'rect', labels: true, grid: true, color: 'blue'};
  const measure = n => Number(n.toFixed(2));
  let form = ShapeModel.create(initial.shape, initial.width), layout;
  const shell = SceneShell.mount(root, {title: 'Рисованные элементы управления', parameters: [
    {key: 'width', label: 'Ширина', min: 1, max: 8, step: .01, value: initial.width, format: n => `${measure(n)} см`},
    {key: 'count', type: 'stepper', label: 'Точек внутри', min: 0, max: 8, step: 1, value: initial.count},
    {key: 'shape', type: 'select', label: 'Фигура', value: initial.shape, options: SketchShapes.options},
    {key: 'labels', type: 'toggle', label: 'Показать размеры', value: initial.labels},
    {key: 'grid', type: 'checkbox', label: 'Тетрадная сетка', value: initial.grid},
    {key: 'color', type: 'choice', label: 'Цвет фигуры', value: initial.color, options: [{value: 'blue', label: 'Синий', color: 'blue'}, {value: 'orange', label: 'Оранжевый', color: 'orange'}, {value: 'purple', label: 'Фиолетовый', color: 'purple'}]}
  ], onInput: parametersChanged});
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'canvas'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Фигура: меняйте размер за углы или перемещайте вершины'); shell.stage.append(svg);
  const pencil = rough.svg(svg), drawing = document.createElementNS(ns, 'g'); svg.append(drawing);
  const editor = ShapeEditor.mount(svg, pencil, geometryChanged, {begin: () => history.begin(), end: () => history.end()}); shell.stage.after(editor.toolbar);
  const history = SceneHistory.mount(root, {
    read: () => ({form, parameters: {...shell.parameters}}),
    restore: state => {form = state.form; shell.setParameters(state.parameters); render();},
    beforeTravel: () => editor.finish()
  });
  const el = (tag, attrs, text) => {const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; drawing.append(n); return n;};
  function parametersChanged(v) {
    if (v.shape !== form.kind) form = ShapeModel.create(v.shape, v.width);
    else if (v.width !== measure(ShapeModel.bounds(form).width)) form = ShapeModel.width(form, v.width);
    shell.setParameters({width: measure(ShapeModel.bounds(form).width)}); render(); history.record();
  }
  function geometryChanged(next) {
    form = next; shell.setParameters({shape: form.kind, width: measure(ShapeModel.bounds(form).width)}); render(); history.record();
  }
  function resize() {
    const w = shell.stage.clientWidth, unit = Math.min(60, (w - 36) / 8), h = Math.max(280, unit * 8 + 64), x = (w - unit * 8) / 2, y = 32;
    shell.stage.style.height = `${h}px`;
    const stageBounds = shell.stage.getBoundingClientRect(), rootBounds = root.getBoundingClientRect();
    layout = {w, h, unit, x, y}; svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    root.style.setProperty('--ve-grid-step', `${unit / 2}px`); root.style.setProperty('--ve-grid-x', `${stageBounds.x - rootBounds.x + x}px`); root.style.setProperty('--ve-grid-y', `${stageBounds.y - rootBounds.y + y}px`);
    render();
  }
  function render() {
    const v = shell.parameters, b = ShapeModel.bounds(form), {unit} = layout;
    const x = layout.x + b.x * unit, y = layout.y + b.y * unit, width = b.width * unit, height = b.height * unit, cx = x + width / 2, cy = y + height / 2;
    drawing.replaceChildren(); if (root.dataset.paper !== String(v.grid)) root.dataset.paper = v.grid;
    const common = {seed: 31, roughness: .4, disableMultiStroke: true, fillStyle: 'solid', fill: `var(--ve-${v.color}-wash)`, stroke: `var(--ve-${v.color})`, strokeWidth: 1.3};
    const points = form.points.map(([u, v]) => [layout.x + u * unit, layout.y + v * unit]);
    const outline = form.curved ? pencil.ellipse(cx, cy, width, height, {...common, curveFitting: 1}) : pencil.polygon(points, common);
    outline.setAttribute('data-shape', form.kind); drawing.append(outline);
    SketchShapes.counters(points, v.count).forEach((dot, i) => {
      const counter = pencil.circle(dot.x, dot.y, dot.radius * 2, {seed: i + 5, roughness: .6, disableMultiStroke: true, stroke: 'var(--ve-ink)', strokeWidth: 1.5, fill: `var(--ve-${v.color}-soft)`, fillStyle: 'solid'});
      counter.setAttribute('data-counter', i); drawing.append(counter);
    });
    if (v.labels) {
      el('text', {x: cx, y: y - 16, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 20}, `${measure(b.width)} см`);
      el('text', {transform: `translate(${x - 14} ${cy}) rotate(-90)`, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 18}, `${measure(b.height)} см`);
    }
    editor.update(form, layout);
  }
  const reset = SketchControls.action('Вернуть исходное', () => {editor.finish(); form = ShapeModel.create(initial.shape, initial.width); shell.setParameters(initial); editor.reset(); render(); history.record();});
  shell.actions.append(reset); const observer = new ResizeObserver(resize); observer.observe(shell.stage); resize();
  root.scene = {shell, dispose() {observer.disconnect(); editor.dispose(); history.dispose(); shell.dispose();}};
})();
