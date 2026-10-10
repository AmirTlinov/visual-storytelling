import {
  SvgLayout,
  SceneShell,
  surface,
  ViewportSVG,
  widgetState,
  vector,
} from '@visual-storytelling/core';
import narrationTiming from './timeline.json' with { type: 'json' };
/* The shell is shared with explorer-3d; this file owns only the SVG subject. */
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene'),
    { element, along } = SvgLayout;
  let pose = { x: 3, y: 2, result: 1 },
    size = { width: 0, height: 0 };
  const shell = SceneShell.mount(root, {
    title: 'Как складываются перемещения',
    parameters: [
      { key: 'x', label: 'По горизонтали', min: -3, max: 3, step: 0.5, value: 3 },
      { key: 'y', label: 'По вертикали', min: -3, max: 3, step: 0.5, value: 2 },
    ],
    onInput() {
      saved.save({ privateContent: root.scene.capture() });
    },
  });
  const drawing = surface(shell.stage, {
    id: 'displacements',
    width: shell.stage.clientWidth,
    height: shell.stage.clientHeight,
    title: 'Сложение перемещений',
    description:
      'Синий путь идёт по горизонтали, оранжевый продолжает его по вертикали; фиолетовая стрелка соединяет начало и конец.',
    grid: { step: 100 },
  });
  const svg = drawing.element,
    world = drawing.layer;
  const camera = ViewportSVG.mount(svg);
  shell.attachView(camera);
  const horizontal = vector(drawing, 'horizontal', 'blue'),
    vertical = vector(drawing, 'vertical', 'orange'),
    result = vector(drawing, 'result', 'purple', 2.5);
  horizontal.describe({
    label: 'Горизонтальное перемещение',
    value: () => pose.x,
    unit: 'шаги',
    source: { file: 'scene.js' },
  });
  vertical.describe({
    label: 'Вертикальное перемещение',
    value: () => pose.y,
    unit: 'шаги',
    source: { file: 'scene.js' },
  });
  result.describe({
    label: 'Результат двух перемещений',
    value: () => [pose.x, pose.y],
    inputs: () => ['horizontal', 'vertical'],
    source: { file: 'scene.js' },
  });
  const start = element('circle', { r: 3.5, fill: 'var(--ve-ink)' }),
    end = element('circle', { r: 3.5, fill: 'var(--ve-purple)' });
  world.append(start, end);
  function label(color) {
    const text = element('text', {
      fill: 'currentColor',
      'font-size': 32,
      style: `color:var(--ve-${color});paint-order:stroke;stroke:var(--ve-surface);stroke-width:4px;stroke-linejoin:round`,
    });
    world.append(text);
    return text;
  }
  const originLabel = label('muted'),
    xLabel = label('blue'),
    yLabel = label('orange'),
    endLabel = label('purple');
  let geometry;
  const number = (n) => Number(Math.abs(n).toFixed(1));
  function labels() {
    if (!geometry) return;
    const { o, a, b } = geometry;
    const point = ([x, y]) => ({ x, y });
    const horizontalRoute = { start: point(o), end: point(a), width: 3 };
    const verticalRoute = { start: point(a), end: point(b), width: 3 };
    const diagonal = { start: point(o), end: point(b), width: 3 };
    const obstacles = [horizontalRoute, verticalRoute, diagonal, start, end];
    const put = (text, value, route, options = {}) => {
      text.textContent = value;
      along(text, route, { space: world, avoid: obstacles, offset: 32, gap: 8, ...options });
      obstacles.push(text);
    };
    const moving = Math.hypot(pose.x, pose.y) >= 0.15;
    originLabel.style.visibility = moving ? 'hidden' : 'visible';
    xLabel.style.visibility = Math.abs(pose.x) < 0.15 ? 'hidden' : 'visible';
    yLabel.style.visibility = Math.abs(pose.y) < 0.15 ? 'hidden' : 'visible';
    endLabel.style.visibility = pose.result > 0.95 && moving ? 'visible' : 'hidden';
    if (!moving) put(originLabel, 'Начало', horizontalRoute);
    if (Math.abs(pose.x) >= 0.15)
      put(xLabel, `${number(pose.x)} ${pose.x >= 0 ? 'вправо' : 'влево'}`, horizontalRoute, {
        offset: (pose.y >= 0 ? 32 : -32) * Math.sign(pose.x),
      });
    if (Math.abs(pose.y) >= 0.15)
      put(yLabel, `${number(pose.y)} ${pose.y >= 0 ? 'вверх' : 'вниз'}`, verticalRoute, {
        offset: (pose.x >= 0 ? 32 : -32) * Math.sign(pose.y),
      });
    if (pose.result > 0.95 && moving)
      put(endLabel, `(${Number(pose.x.toFixed(1))}; ${Number(pose.y.toFixed(1))})`, diagonal, {
        at: 1,
        offset: -36,
      });
  }
  function render(next = pose) {
    pose = next;
    const w = shell.stage.clientWidth,
      h = shell.stage.clientHeight;
    if (!w || !h) return;
    const resized = size.width !== w || size.height !== h;
    size = { width: w, height: h };
    const unit = Math.min(w / 9, h / 4),
      o = [w / 2, h / 2],
      a = [o[0] + pose.x * unit, o[1]],
      b = [a[0], o[1] - pose.y * unit];
    geometry = { o, a, b, unit };
    if (resized) drawing.resize(w, h, { step: unit, x: o[0], y: o[1] });
    horizontal.set(o, a);
    vertical.set(a, b);
    result.set(o, [o[0] + (b[0] - o[0]) * pose.result, o[1] + (b[1] - o[1]) * pose.result]);
    start.setAttribute('cx', o[0]);
    start.setAttribute('cy', o[1]);
    end.setAttribute('cx', b[0]);
    end.setAttribute('cy', b[1]);
  }
  const tip = document.createElement('p');
  tip.textContent = 'Одна клетка — один шаг';
  shell.actions.append(tip);
  const timing = narrationTiming;
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: (frame) => ({
      x: 3 * frame.progress('move_x'),
      y: 2 * frame.progress('move_y'),
      result: frame.reveal('result_arrow'),
    }),
    render(values, frame, mode) {
      render({ ...values, result: mode === 'explore' ? 1 : values.result });
      const { o, unit } = geometry;
      const center = mode === 'explore' ? [values.x / 2, -values.y / 2] : [1.25, -0.8];
      const overview = {
        target: {
          x: o[0] + (center[0] - 3) * unit,
          y: o[1] + (center[1] - 2.15) * unit,
          w: unit * 6,
          h: unit * 4.3,
        },
        padding: 36,
      };
      const origin = {
        target: { x: o[0] - unit * 2.6, y: o[1] - unit * 1.8, w: unit * 5.2, h: unit * 3.6 },
        padding: 36,
      };
      // Open the grid around the origin, then restore one shared scale before walking.
      camera.shot(
        mode === 'explore'
          ? overview
          : frame.has('overview')
            ? {
                ...overview,
                from: origin,
                progress: frame.progress('overview'),
                reduced: frame.reduced,
              }
            : {
                ...origin,
                from: overview,
                progress: frame.progress('origin_focus'),
                reduced: frame.reduced,
              },
      );
      labels();
    },
  });
  shell.onDispose(() => drawing.dispose());
  async function restore(snapshot) {
    const checkpoint = snapshot?.privateContent;
    if (!checkpoint?.values || !('x' in checkpoint.values) || !('y' in checkpoint.values)) return;
    try {
      await root.scene.restore(checkpoint);
    } catch (error) {
      shell.status.textContent = error.message;
    }
  }
  const saved = widgetState('displacements', restore);
  await restore(saved.read());
  shell.onDispose(saved.dispose);
  root.scene.extend({
    shell,
    story,
    camera,
  });
})();
