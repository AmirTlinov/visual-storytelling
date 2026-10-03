import {
  SvgCamera,
  SvgHighlight,
  SvgGestures,
  ScenePath,
  widgetState,
  theme,
  ExplorerSurface,
} from '@visual-storytelling/core';
import { CpuCycle } from './cpu/model.js';
import { DisplayModel } from './display/model.js';
import { NandModel } from './storage/nand-model.js';
import { CpuClock } from './cpu/controls.js';
import { DisplayControls } from './display/controls.js';
import { NandControls } from './storage/nand-controls.js';
import { rootNode, makeScene } from './scenes.js';
import { ImageJob } from './image-job/model.js';
import { ImageJobControls } from './image-job/controls.js';
import { imageAddress, imageJobBoard } from './image-job/scenes.js';
import { esc } from './drawing/symbols.js';

export function mountComputer(root) {
  const abort = new AbortController(),
    appearance = theme(root);
  const surface = ExplorerSurface.mount(root.querySelector('.explorer-stage'), {
    label: 'Внутри компьютера',
    description: 'Учебная плата: открывай компоненты до отдельных сигналов и ячеек памяти.',
  });
  surface.svg.classList.add('part-symbol');

  const viewport = root.querySelector('.explorer-viewport'),
    svg = root.querySelector('.explorer-canvas');
  const hits = root.querySelector('.explorer-hits'),
    breadcrumbs = root.querySelector('.explorer-path');
  const back = root.querySelector('.explorer-back'),
    caption = root.querySelector('.explorer-caption'),
    controls = root.querySelector('.explorer-leaf-controls');
  const navigation = root.querySelector('.explorer-navigation'),
    footer = root.querySelector('.explorer-footer'),
    reset = root.querySelector('.explorer-reset');
  const architectureButtons = [...root.querySelectorAll('[data-architecture]')];
  const camera = new SvgCamera(viewport, svg, hits);
  const highlight = new SvgHighlight(svg, hits);
  const execution = new CpuCycle();
  const display = new DisplayModel();
  const nand = new NandModel();
  const clock = new CpuClock(root.querySelector('.cpu-clock'), execution, paintSceneState, save);
  const displayControls = new DisplayControls(
    root.querySelector('.display-controls'),
    display,
    paintSceneState,
    save,
  );
  const nandControls = new NandControls(
    root.querySelector('.nand-controls'),
    nand,
    paintSceneState,
    save,
  );
  const defaultValues = {
    gate: true,
    charge: true,
    romPower: true,
    keyDown: false,
    speakerOn: false,
    light: true,
    hddPolarity: true,
  };
  const path = new ScenePath(rootNode, (node) =>
    JSON.stringify(
      Object.entries(node)
        .filter(([key]) => key !== 'label')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  let values = { ...defaultValues },
    scene,
    architecture = 'discrete';
  const job = new ImageJob(nand, display, () => architecture);
  const jobControls = new ImageJobControls(root.querySelector('.image-job'), job, {
    changed: paintSceneState,
    save,
    open: openJob,
    home: () => {
      path.reset();
      paint();
    },
    pauseOther: () => {
      clock.pause(false);
      if (camera.travel) paint();
    },
  });
  const current = () => {
    const node = path.current;
    // Scene layout must be applied before SVG and hit geometry use its size.
    root.dataset.scene = node.type;
    root.dataset.clock = String(!!node.cpuCycle);
    root.dataset.architecture = architecture;
    const scoped = node.imageByte === undefined ? values : { ...values, charge: !!job.bit(node) };
    const result = makeScene(
      node,
      camera.size,
      scoped,
      execution,
      display,
      architecture,
      nand,
      job,
    );
    if (node.imageByte !== undefined) {
      const value = job.buffer(node.imageLocation)[node.imageByte];
      result.caption = `${imageAddress(job.address(node.imageLocation, node.imageByte))} · b${node.imageBit} = ${value === null ? '—' : job.bit(node)}. ${result.caption}`;
      if (value === null) result.control = null;
    }
    return node.type === 'board' ? imageJobBoard(result, job) : result;
  };

  function snapshot() {
    return {
      version: 2,
      architecture,
      keys: path.keys,
      values: { ...values },
      cpuCycle: execution.snapshot(),
      display: display.snapshot(),
      nand: nand.snapshot(),
      imageJob: job.snapshot(),
      ...(root.dataset.moving === 'true' ? {} : { view: { ...camera.matrix, ...camera.size } }),
    };
  }
  function save() {
    const state = snapshot();
    const cpuCycle = {
      core: 'C0',
      cycles: execution.cycles,
      phase: execution.phase,
      r1: execution.r1,
      r2: execution.b,
      result: execution.word(execution.bits.map((bit) => bit.sum)),
    };
    const pixel = scene.display?.pixel;
    const displayState = {
      row: display.row,
      phase: display.phase,
      backlight: display.backlight,
      ...(pixel
        ? {
            pixel,
            storedRGB: display.rgb(pixel.row, pixel.col, 'vram'),
            heldRGB: display.rgb(pixel.row, pixel.col),
            outputRGB: display.output(pixel.row, pixel.col),
          }
        : {}),
    };
    persistence.save({
      modelContent: {
        architecture,
        component: path.entries[1]?.node.label || 'Плата',
        path: path.entries.map((item) => item.node.label),
        ...values,
        cpuCycle,
        display: displayState,
        ...(job.active
          ? {
              imageJob: {
                phase: job.phase,
                cpuInstructions: job.cpu.instructions,
                gpuPixels: job.gpu.written,
                copiedBytes: job.copied,
              },
            }
          : {}),
      },
      privateContent: { computerExplorer: state },
    });
  }
  function chrome() {
    highlight.clear();
    architectureButtons.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.architecture === architecture)),
    );
    back.disabled = path.length === 1;
    navigation.hidden = path.length === 1;
    footer.hidden = path.length === 1;
    reset.hidden = true;
    const depths = [
      ...new Set([0, ...(path.length > 2 && camera.size.w >= 520 ? [1] : []), path.length - 1]),
    ];
    const fullPath = path.entries.map((item) => item.node.label).join(' → ');
    breadcrumbs.innerHTML = depths
      .map(
        (depth, i) =>
          `${i ? '<span aria-hidden="true">›</span>' : ''}<button type="button" data-depth="${depth}" title="${esc(fullPath)}"${depth === path.length - 1 ? ' aria-current="location"' : ''}>${esc(path.entries[depth].node.label)}</button>`,
      )
      .join('');
    caption.textContent = scene.caption;
    svg.setAttribute('aria-label', path.entries.map((item) => item.node.label).join(' → '));
    svg.querySelector('title').textContent = svg.getAttribute('aria-label');
    root.dataset.depth = String(path.length - 1);
    svg.querySelector('desc').textContent = scene.caption;
    leafControl();
    clock.show(scene);
    displayControls.show(scene);
    nandControls.show(scene);
    jobControls.show();
  }
  function leafControl() {
    const node = path.current,
      control = scene.control;
    if (!control) {
      controls.replaceChildren();
      return;
    }
    if (controls.firstElementChild?.dataset.value !== control.key)
      controls.innerHTML = `<button type="button" data-value="${control.key}"></button>`;
    const button = controls.firstElementChild;
    button.textContent = control.label;
    button.setAttribute(
      'aria-pressed',
      String(
        control.key === 'charge' && node.imageByte !== undefined
          ? !!job.bit(node)
          : values[control.key],
      ),
    );
  }
  function targets() {
    highlight.clear();
    if (
      hits.children.length !== scene.hits.length ||
      scene.hits.some((hit, i) => hits.children[i].dataset.hitKey !== hit.key)
    ) {
      hits.innerHTML = scene.hits
        .map(
          (hit) =>
            `<button type="button" class="explorer-hit" data-hit-key="${esc(hit.key)}"><span></span></button>`,
        )
        .join('');
    }
    scene.hits.forEach((hit, i) => {
      const button = hits.children[i],
        label = `Открыть: ${hit.label}`;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      if (button.firstElementChild.textContent !== hit.label)
        button.firstElementChild.textContent = hit.label;
    });
    hits.hidden = false;
  }
  function paint(matrix, focusKey) {
    gestures.cancel();
    scene = current();
    targets();
    camera.show(scene, matrix || camera.fit(scene.box));
    chrome();
    updateReset();
    root.dataset.moving = 'false';
    if (focusKey) {
      const target =
        [...hits.children].find((button) => button.dataset.hitKey === focusKey) ||
        hits.firstElementChild ||
        back;
      target.focus({ preventScroll: true });
    }
  }
  function paintSceneState() {
    if (camera.travel) {
      displayControls.show(scene);
      nandControls.show(scene);
      return;
    }
    scene = current();
    const key = highlight.key;
    targets();
    camera.install(scene.body, scene.hits);
    camera.set(camera.matrix);
    highlight.clear();
    if (key) highlight.show(key);
    if (caption.textContent !== scene.caption) caption.textContent = scene.caption;
    svg.querySelector('desc').textContent =
      scene.caption + (scene.clock ? ` ${execution.phase}.` : '');
    nandControls.show(scene);
    displayControls.show(scene);
    jobControls.show();
    leafControl();
  }
  function updateReset() {
    const fit = camera.fit(scene.box),
      m = camera.matrix;
    reset.hidden =
      !!camera.travel ||
      (Math.abs(Math.log(m.s / fit.s)) < 0.001 && Math.hypot(m.x - fit.x, m.y - fit.y) < 0.5);
  }
  function fitView() {
    if (camera.travel) paint();
    const returnFocus = document.activeElement === reset;
    camera.animate(camera.fit(scene.box), () => {
      updateReset();
      save();
      if (returnFocus) hits.firstElementChild?.focus({ preventScroll: true });
    });
  }
  function zoomView(factor) {
    if (camera.travel) return;
    camera.cancel();
    camera.zoom(factor, { x: camera.size.w / 2, y: (camera.size.h + 28) / 2 }, scene.box);
    updateReset();
    save();
  }
  function down(key, keyboard = false) {
    if (camera.travel) return;
    const hit = scene.hits.find((item) => item.key === key);
    if (!hit) return;
    const depth = path.destination(hit);
    if (depth < path.length) {
      jump(depth, keyboard);
      return;
    }
    gestures.cancel();
    clock.pause(false);
    jobControls.pause(false);
    const parent = scene;
    path.enter(hit);
    scene = current();
    chrome();
    hits.hidden = true;
    root.dataset.moving = 'true';
    save();
    camera.moveInto(parent, scene, hit, () => paint(undefined, keyboard ? 'first' : null));
  }
  function up(keyboard = false) {
    if (path.length === 1) return;
    gestures.cancel();
    clock.pause(false);
    jobControls.pause(false);
    if (camera.travel?.direction === 'out') paint();
    const child = scene,
      last = path.pop(),
      parent = current();
    const hit = parent.hits.find((item) => item.key === last.via);
    scene = parent;
    chrome();
    hits.hidden = true;
    root.dataset.moving = 'true';
    save();
    camera.moveOut(parent, child, hit, () => paint(undefined, keyboard ? last.via : null));
  }
  function restore(widgetState) {
    const saved = widgetState?.privateContent?.computerExplorer;
    if (!saved || saved.version !== 2) return false;
    gestures.cancel();
    camera.cancel();
    clock.pause(false);
    jobControls.pause(false);
    execution.restore(saved.cpuCycle);
    display.restore(saved.display);
    nand.restore(saved.nand);
    architecture = saved.architecture === 'unified' ? 'unified' : 'discrete';
    job.restore(saved.imageJob);
    path.reset();
    values = Object.fromEntries(
      Object.entries(defaultValues).map(([key, value]) => [
        key,
        typeof saved.values?.[key] === 'boolean' ? saved.values[key] : value,
      ]),
    );
    path.restore(saved.keys, () => current().hits);
    scene = current();
    const v = saved.view;
    const matrix =
      v &&
      v.w === camera.size.w &&
      v.h === camera.size.h &&
      [v.s, v.x, v.y].every(Number.isFinite) &&
      v.s > 0
        ? { s: v.s, x: v.x, y: v.y }
        : undefined;
    paint(matrix);
    return true;
  }
  function jump(depth, keyboard = false) {
    if (depth === path.length - 2) up(keyboard);
    else if (depth < path.length - 1) {
      clock.pause(false);
      jobControls.pause(false);
      const focus = path.entries[depth + 1].via;
      path.jump(depth);
      paint(undefined, keyboard ? focus : null);
      save();
    }
  }
  function openJob(stage) {
    const key = {
      ssd: 'nvme',
      ram: architecture === 'unified' ? 'memory' : 'ram',
      cpu: 'cpu',
      gpu: 'gpu',
      monitor: 'monitor',
    }[stage];
    path.reset();
    paint();
    down(key, true);
  }
  root.addEventListener(
    'click',
    (event) => {
      if (
        event.target.closest('.cpu-clock,.display-controls,.nand-controls,.explorer-leaf-controls')
      )
        jobControls.pause(false);
    },
    { capture: true, signal: abort.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.architecture) {
        if (button.dataset.architecture === architecture) return;
        clock.pause(false);
        jobControls.pause(false);
        architecture = button.dataset.architecture;
        path.reset();
        if (job.prepared) job.restart();
        paint();
        save();
      } else if (button === back) up(event.detail === 0);
      else if (button.dataset.depth !== undefined) {
        jump(Number(button.dataset.depth), event.detail === 0);
      } else if (button.dataset.hitKey) down(button.dataset.hitKey, event.detail === 0);
      else if (button.dataset.value) {
        const key = button.dataset.value,
          node = path.current;
        if (key === 'charge' && node.imageByte !== undefined) job.toggleBit(node);
        else values[key] = !values[key];
        const matrix = camera.matrix;
        paint(matrix);
        save();
        controls.firstElementChild?.focus({ preventScroll: true });
      } else if (button === reset) fitView();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.target.closest('input,textarea,[contenteditable=true]')
      )
        return;
      if (event.key === 'Escape' && path.length > 1) {
        event.preventDefault();
        up(true);
      } else if (event.key === '0') {
        event.preventDefault();
        fitView();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomView(1.4);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomView(1 / 1.4);
      }
    },
    { signal: abort.signal },
  );
  const gestures = new SvgGestures(viewport, camera, highlight, {
    scene: () => scene,
    open: down,
    fit: fitView,
    changed: updateReset,
    settled: save,
  });
  const persistence = widgetState('computer-explorer', restore);
  if (!restore(persistence.read())) paint();
  const observer = new ResizeObserver(() => {
    const { w, h } = camera.size;
    if (w === camera.viewportSize.w && h === camera.viewportSize.h) return;
    const focused = document.activeElement,
      { hitKey, value, depth } = focused?.dataset || {};
    paint(undefined, hitKey);
    if (value)
      controls.querySelector(`[data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
    else if (depth !== undefined)
      (breadcrumbs.querySelector(`[data-depth="${depth}"]`) || back).focus({ preventScroll: true });
    else if (focused === reset) (hits.firstElementChild || back).focus({ preventScroll: true });
  });
  observer.observe(viewport);

  return {
    snapshot,
    restore: (state) => restore({ privateContent: { computerExplorer: state } }),
    pause() {
      clock.pause(false);
      jobControls.pause(false);
    },
    svg: () => svg,
    setTheme: (value) => appearance.set(value),
    setReduced: (value) => {
      camera.reducedOverride = value;
    },
    open: down,
    home() {
      path.reset();
      paint();
      save();
    },
    dispose() {
      observer.disconnect();
      abort.abort();
      persistence.dispose();
      gestures.dispose();
      highlight.dispose();
      camera.dispose();
      clock.dispose();
      jobControls.dispose();
      displayControls.dispose();
      nandControls.dispose();
      appearance.dispose();
      surface.dispose();
      root.replaceChildren();
    },
  };
}
