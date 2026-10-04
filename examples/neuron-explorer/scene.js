import '@visual-storytelling/core/style.css';
import {
  SceneShell,
  ExplorerSurface,
  SvgCamera,
  SvgHighlight,
  SvgGestures,
  ScenePath,
  theme,
  widgetState,
} from '@visual-storytelling/core';
import { drawing } from './drawing.js';
import { neuron, compute } from './model.js';
window.galleryReady = document.fonts.ready.then(() => {
  const root = document.getElementById('neuron-explorer'),
    abort = new AbortController(),
    appearance = theme(root);
  const shell = SceneShell.mount(root, {
    title: 'Внутри нейрона',
    parameters: [
      { key: 'a', label: 'Вход A', min: 0, max: 4, step: 1, value: 2 },
      { key: 'b', label: 'Вход B', min: 0, max: 4, step: 1, value: 1 },
      { key: 'threshold', label: 'Порог', min: 0, max: 28, step: 1, value: 9 },
    ],
    onInput: () => {
      paint(camera.matrix);
      save();
    },
  });
  const surface = ExplorerSurface.mount(shell.stage, {
    label: 'Устройство порогового нейрона',
    description: 'Открой сумму до произведений и групп предметов.',
  });
  const { svg, viewport, hits, back, breadcrumbs, navigation, reset } = surface;
  const camera = new SvgCamera(viewport, svg, hits),
    highlight = new SvgHighlight(svg, hits),
    path = new ScenePath(neuron, (n) => n.id);
  const caption = document.createElement('p');
  caption.className = 'caption';
  caption.setAttribute('aria-live', 'polite');
  shell.actions.append(caption);
  let scene;
  const current = () => drawing(svg, path.current, shell.parameters);
  const save = () =>
    storage.save({
      modelContent: { path: path.entries.map((e) => e.node.label), ...compute(shell.parameters) },
      privateContent: {
        kind: 'neuron-explorer-v1',
        parameters: { ...shell.parameters },
        keys: path.keys,
      },
    });
  function paint(matrix, focus) {
    gestures.cancel();
    scene = current();
    hits.innerHTML = scene.hits
      .map(
        (hit) =>
          `<button class="explorer-hit" type="button" data-hit-key="${hit.key}" aria-label="Открыть: ${hit.label}"><span>${hit.label}</span></button>`,
      )
      .join('');
    hits.hidden = false;
    camera.show(scene, matrix);
    highlight.clear();
    caption.textContent = scene.caption;
    svg.querySelector('desc').textContent = scene.caption;
    navigation.hidden = path.length === 1;
    back.disabled = path.length === 1;
    breadcrumbs.replaceChildren();
    path.entries.forEach((entry, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.depth = String(i);
      b.textContent = entry.node.label;
      if (i === path.length - 1) b.setAttribute('aria-current', 'location');
      breadcrumbs.append(b);
    });
    reset.hidden = true;
    if (focus)
      (
        [...hits.children].find((b) => b.dataset.hitKey === focus) ||
        hits.firstElementChild ||
        back
      ).focus({ preventScroll: true });
  }
  function down(key, keyboard = false) {
    if (camera.travel) return;
    const hit = scene.hits.find((h) => h.key === key);
    if (!hit) return;
    const parent = scene;
    gestures.cancel();
    path.enter(hit);
    scene = current();
    hits.hidden = true;
    save();
    camera.moveInto(parent, scene, hit, () => paint(undefined, keyboard ? 'first' : null));
  }
  function up(keyboard = false) {
    if (path.length === 1) return;
    if (camera.travel?.direction === 'out') paint();
    gestures.cancel();
    const child = scene,
      last = path.pop(),
      parent = current(),
      hit = parent.hits.find((h) => h.key === last.via);
    scene = parent;
    hits.hidden = true;
    save();
    camera.moveOut(parent, child, hit, () => paint(undefined, keyboard ? last.via : null));
  }
  const fit = () => {
    if (camera.travel) paint();
    camera.animate(camera.fit(scene.box), () => {
      reset.hidden = true;
    });
  };
  const gestures = new SvgGestures(viewport, camera, highlight, {
    scene: () => scene,
    open: down,
    fit,
    changed: () => {
      reset.hidden = false;
    },
  });
  root.addEventListener(
    'click',
    (event) => {
      const b = event.target.closest('button');
      if (!b) return;
      if (b.dataset.hitKey) down(b.dataset.hitKey, event.detail === 0);
      else if (b === back) up(event.detail === 0);
      else if (b === reset) fit();
      else if (b.dataset.depth !== undefined) {
        path.jump(Number(b.dataset.depth));
        paint();
        save();
      }
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.target.closest('input') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        up(true);
      } else if (event.key === '0') {
        event.preventDefault();
        fit();
      } else if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        camera.zoom(
          event.key === '-' ? 1 / 1.4 : 1.4,
          { x: camera.size.w / 2, y: camera.size.h / 2 },
          scene.box,
        );
        reset.hidden = false;
      }
    },
    { signal: abort.signal },
  );
  function restore(saved) {
    const state = saved?.privateContent;
    if (state?.kind !== 'neuron-explorer-v1') return;
    shell.syncParameters(
      Object.fromEntries(
        ['a', 'b', 'threshold'].map((key) => [
          key,
          Math.max(
            0,
            Math.min(
              key === 'threshold' ? 28 : 4,
              Math.round(Number(state.parameters?.[key]) || 0),
            ),
          ),
        ]),
      ),
    );
    path.restore(state.keys, () => current().hits);
    paint();
  }
  const storage = widgetState('neuron-explorer', restore);
  const observer = new ResizeObserver(() => {
    if (camera.size.w !== camera.viewportSize.w || camera.size.h !== camera.viewportSize.h)
      paint(undefined, document.activeElement?.dataset.hitKey);
  });
  paint();
  restore(storage.read());
  observer.observe(viewport);
  Object.assign(root.scene, {
    svg: () => svg,
    setTheme: (value) => appearance.set(value),
    setReduced: (value) => {
      camera.reducedOverride = value;
    },
    snapshot: () => ({
      parameters: { ...shell.parameters },
      keys: path.keys,
      ...compute(shell.parameters),
    }),
  });
  shell.onDispose(() => {
    observer.disconnect();
    abort.abort();
    storage.dispose();
    gestures.dispose();
    highlight.dispose();
    camera.dispose();
    surface.dispose();
    appearance.dispose();
  });
});
