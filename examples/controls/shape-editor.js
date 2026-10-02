import { SketchControls } from '@visual-storytelling/core';
import { ShapeModel } from './shape-model.js';
/* Pointer and keyboard editing share the same model operations. */

  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs = {}) => {const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); return el;};
  function mount(svg, pencil, onChange, gesture = {begin() {}, end() {}}) {
    const abort = new AbortController(), listen = {signal: abort.signal}, handles = new Map();
    const overlay = make('g', {class: 've-geometry-handles'}); svg.append(overlay); svg.classList.add('ve-geometry-editor');
    const toolbar = document.createElement('div'); toolbar.className = 've-geometry-tools'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Редактирование фигуры');
    const sizeButton = SketchControls.action('Размер целиком', () => setMode('size'), {pressed: false});
    const vertexButton = SketchControls.action('Вершины', () => setMode('vertices'), {pressed: true});
    const hint = document.createElement('span'); hint.className = 've-geometry-hint';
    toolbar.append(vertexButton, sizeButton, hint);
    let form, view, mode = 'vertices', drag = null, keyGesture = false;
    function position(event) {
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      return [(p.x - view.x) / view.unit, (p.y - view.y) / view.unit];
    }
    function setMode(next) {
      cancel(); finishKeys(); mode = next === 'vertices' && !form.curved ? next : 'size'; update(form, view);
    }
    function update(next, layout) {
      // Returning from a curve restores direct manipulation of polygon vertices.
      if (form?.curved && !next.curved) mode = 'vertices';
      form = next; view = layout;
      if (form.curved) mode = 'size';
      sizeButton.setAttribute('aria-pressed', mode === 'size'); vertexButton.setAttribute('aria-pressed', mode === 'vertices'); vertexButton.disabled = form.curved;
      hint.textContent = mode === 'size' ? 'Тяни угол · Shift — пропорции' : 'Каждую вершину можно двигать отдельно';
      const points = mode === 'size' ? ShapeModel.corners(form) : form.points;
      const names = ['Левый верхний', 'Правый верхний', 'Правый нижний', 'Левый нижний'];
      const keep = new Set();
      points.forEach((point, index) => {
        const key = `${mode}-${index}`; keep.add(key);
        let handle = handles.get(key);
        if (!handle) {
          handle = make('g', {class: 've-geometry-handle', role: 'button', tabindex: '0', 'data-handle': key, 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown'});
          handle.append(make('circle', {r: 22, class: 've-geometry-hit'}));
          const ink = {seed: index + 87, roughness: .55, disableMultiStroke: true, stroke: 'currentColor', strokeWidth: 1.4, fill: 'var(--ve-surface)', fillStyle: 'solid'};
          const mark = mode === 'vertices' ? pencil.circle(0, 0, 12, ink) : pencil.rectangle(-6, -6, 12, 12, ink); mark.setAttribute('data-mark', ''); handle.append(mark);
          const ring = pencil.circle(0, 0, 23, {...ink, fill: 'none', stroke: 'var(--ve-pencil)', strokeWidth: 1}); ring.setAttribute('data-ring', ''); handle.append(ring);
          handle.addEventListener('pointerdown', event => begin(event, index), listen);
          handle.addEventListener('keydown', event => onHandleKey(event, index), listen);
          handles.set(key, handle); overlay.append(handle);
        }
        handle.setAttribute('transform', `translate(${view.x + point[0] * view.unit} ${view.y + point[1] * view.unit})`);
        handle.setAttribute('aria-label', mode === 'size' ? `${names[index]} угол: изменить размер` : `Вершина ${index + 1}: переместить`);
        handle.setAttribute('aria-description', 'Стрелки перемещают на клетку; Alt — точнее.');
        handle.dataset.active = Boolean(drag && drag.index === index);
      });
      for (const [key, handle] of handles) if (!keep.has(key)) {handle.remove(); handles.delete(key);}
    }
    function begin(event, index) {
      if (event.button !== 0 || drag) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({preventScroll: true});
      finishKeys(); gesture.begin();
      drag = {index, pointer: event.pointerId, start: position(event), shape: form, point: (mode === 'size' ? ShapeModel.corners(form) : form.points)[index], mode};
      svg.setPointerCapture(event.pointerId); svg.dataset.dragging = 'true'; update(form, view);
    }
    function change(start, index, target, proportional, editMode = mode) {
      const next = editMode === 'size' ? ShapeModel.resize(start, index, target, proportional) : ShapeModel.vertex(start, index, target);
      svg.dataset.invalid = !next;
      if (next && JSON.stringify(next.points) !== JSON.stringify(form.points)) onChange(next);
    }
    function move(event) {
      const p = position(event);
      if (!drag) {const b = ShapeModel.bounds(form), margin = 24 / view.unit; svg.dataset.near = p[0] >= b.x - margin && p[0] <= b.x + b.width + margin && p[1] >= b.y - margin && p[1] <= b.y + b.height + margin; return;}
      if (event.pointerId !== drag.pointer) return;
      event.preventDefault();
      const step = event.altKey ? .1 : .5, target = p.map((n, i) => drag.point[i] + Math.round((n - drag.start[i]) / step) * step);
      change(drag.shape, drag.index, target, event.shiftKey, drag.mode);
    }
    function finish(commit = true) {
      if (!drag) return;
      const {pointer, shape} = drag; drag = null;
      if (svg.hasPointerCapture(pointer)) svg.releasePointerCapture(pointer);
      if (!commit) onChange(shape);
      svg.dataset.dragging = 'false'; svg.dataset.invalid = 'false'; update(form, view);
      gesture.end();
    }
    function cancel() {finish(false);}
    function finishKeys() {if (keyGesture) {keyGesture = false; gesture.end();}}
    function onHandleKey(event, index) {
      if (event.key === 'Escape') {event.preventDefault(); cancel(); return;}
      if (event.metaKey || event.ctrlKey) return;
      const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if (!delta) return;
      if (!keyGesture) {gesture.begin(); keyGesture = true;}
      event.preventDefault(); const step = event.altKey ? .1 : .5, origin = (mode === 'size' ? ShapeModel.corners(form) : form.points)[index];
      change(form, index, origin.map((n, i) => n + delta[i] * step), event.shiftKey);
    }
    svg.addEventListener('pointermove', move, listen);
    svg.addEventListener('pointerleave', () => {svg.dataset.near = 'false';}, listen);
    svg.addEventListener('pointerup', event => {if (drag?.pointer === event.pointerId) {move(event); finish();}}, listen);
    svg.addEventListener('pointercancel', cancel, listen);
    svg.addEventListener('lostpointercapture', () => {if (drag) cancel();}, listen);
    svg.addEventListener('keydown', event => {if (event.key === 'Escape') cancel();}, listen);
    svg.addEventListener('keyup', event => {if (event.key.startsWith('Arrow')) finishKeys();}, listen);
    svg.addEventListener('focusout', finishKeys, listen);
    return {toolbar, update, finish() {finish(); finishKeys();}, reset() {setMode('vertices');}, dispose() {abort.abort(); finish(); finishKeys(); overlay.remove(); toolbar.remove();}};
  }
  export const ShapeEditor = {mount};
