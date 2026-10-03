import {
  SvgLayout,
  SceneShell,
  surface,
  ViewportSVG,
  widgetState,
} from '@visual-storytelling/core';
import narrationTiming from './timeline.json' with { type: 'json' };
/* The shell is shared with explorer-3d; this file owns only the SVG subject. */
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene'),
    { element, place, box } = SvgLayout;
  let pose = { x: 3, y: 2, result: 1 },
    size = { width: 0, height: 0 };
  const shell = SceneShell.mount(root, {
    title: 'Как складываются перемещения',
    paper: false,
    parameters: [
      { key: 'x', label: 'По горизонтали', min: -3, max: 3, step: 0.5, value: 3 },
      { key: 'y', label: 'По вертикали', min: -3, max: 3, step: 0.5, value: 2 },
    ],
    onInput({ x, y }) {
      saved.save({ privateContent: { version: 1, time: story.currentTime, x, y } });
    },
  });
  shell.stage.style.height = '380px';
  const drawing = surface(shell.stage, {
    id: 'displacements',
    width: shell.stage.clientWidth,
    height: 380,
    title: 'Сложение перемещений',
    description:
      'Синий путь идёт по горизонтали, оранжевый продолжает его по вертикали; фиолетовая стрелка соединяет начало и конец.',
    grid: false,
  });
  const svg = drawing.element,
    world = drawing.layer;
  const camera = ViewportSVG.mount(svg);
  shell.attachView(camera);
  function arrow(tone) {
    const group = element('g', {
      fill: 'none',
      stroke: `var(--ve-${tone})`,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    const path = element('path'),
      head = element('path');
    group.append(path, head);
    world.append(group);
    return {
      group,
      draw(a, b, amount = 1) {
        const p = [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount],
          angle = Math.atan2(p[1] - a[1], p[0] - a[0]);
        group.style.visibility = Math.hypot(p[0] - a[0], p[1] - a[1]) < 2 ? 'hidden' : 'visible';
        path.setAttribute('d', `M${a} L${p}`);
        head.setAttribute(
          'd',
          `M${p[0] - 9 * Math.cos(angle - 0.45)},${p[1] - 9 * Math.sin(angle - 0.45)} L${p} L${p[0] - 9 * Math.cos(angle + 0.45)},${p[1] - 9 * Math.sin(angle + 0.45)}`,
        );
      },
    };
  }
  const horizontal = arrow('blue'),
    vertical = arrow('orange'),
    result = arrow('purple');
  result.group.setAttribute('stroke-width', '2.5');
  const start = element('circle', { r: 3.5, fill: 'var(--ve-ink)' }),
    end = element('circle', { r: 3.5, fill: 'var(--ve-purple)' });
  world.append(start, end);
  function label(color) {
    const text = element('text', {
      fill: 'currentColor',
      'font-size': 18,
      style: `color:var(--ve-${color});paint-order:stroke;stroke:var(--ve-surface);stroke-width:4px;stroke-linejoin:round`,
    });
    world.append(text);
    return text;
  }
  const originLabel = label('muted'),
    xLabel = label('blue'),
    yLabel = label('orange'),
    endLabel = label('purple');
  function put(text, value, x, y) {
    text.textContent = value;
    const width = box(text, world).width;
    place(
      text,
      Math.max(width / 2 + 5, Math.min(size.width - width / 2 - 5, x)),
      Math.max(16, Math.min(size.height - 16, y)),
    );
  }
  function render(next = pose) {
    pose = next;
    const w = shell.stage.clientWidth,
      h = shell.stage.clientHeight;
    if (!w || !h) return;
    const resized = size.width !== w || size.height !== h;
    size = { width: w, height: h };
    const unit = Math.min((w - 135) / 6, (h - 120) / 6),
      o = [w / 2, h / 2],
      a = [o[0] + pose.x * unit, o[1]],
      b = [a[0], o[1] - pose.y * unit];
    if (resized) drawing.resize(w, h, { step: unit, x: o[0], y: o[1] });
    horizontal.draw(o, a);
    vertical.draw(a, b);
    result.draw(o, b, pose.result);
    start.setAttribute('cx', o[0]);
    start.setAttribute('cy', o[1]);
    end.setAttribute('cx', b[0]);
    end.setAttribute('cy', b[1]);
    put(originLabel, 'Начало', o[0] - 30, o[1] + (pose.y >= 0 ? 27 : -27));
    const number = (n) => Number(Math.abs(n).toFixed(1));
    put(
      xLabel,
      `${number(pose.x)} ${w < 480 ? (pose.x >= 0 ? '→' : '←') : pose.x >= 0 ? 'вправо' : 'влево'}`,
      (o[0] + a[0]) / 2,
      o[1] + (pose.y >= 0 ? 27 : -27),
    );
    xLabel.style.visibility = Math.abs(pose.x) < 0.15 ? 'hidden' : 'visible';
    put(
      yLabel,
      `${number(pose.y)} ${w < 480 ? (pose.y >= 0 ? '↑' : '↓') : pose.y >= 0 ? 'вверх' : 'вниз'}`,
      a[0] + (pose.x >= 0 ? 52 : -52),
      (a[1] + b[1]) / 2,
    );
    yLabel.style.visibility = Math.abs(pose.y) < 0.15 ? 'hidden' : 'visible';
    put(
      endLabel,
      `(${Number(pose.x.toFixed(1))}; ${Number(pose.y.toFixed(1))})`,
      b[0],
      b[1] + (pose.y >= 0 ? -25 : 25),
    );
    endLabel.style.visibility =
      pose.result > 0.95 && Math.hypot(pose.x, pose.y) > 0.1 ? 'visible' : 'hidden';
    originLabel.style.visibility = Math.hypot(pose.x, pose.y) < 0.15 ? 'visible' : 'hidden';
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
      const overview = { target: { x: 0, y: 0, w: size.width, h: size.height }, padding: 8 };
      const unit = Math.min((size.width - 135) / 6, (size.height - 120) / 6);
      const origin = {
        target: {
          x: size.width / 2 - unit * 2,
          y: size.height / 2 - unit * 2,
          w: unit * 4,
          h: unit * 4,
        },
        padding: 34,
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
    },
  });
  const observer = new ResizeObserver(() => story.update());
  observer.observe(shell.stage);
  shell.onDispose(() => observer.disconnect());
  shell.onDispose(() => drawing.dispose());
  function restore(snapshot) {
    const value = snapshot?.privateContent;
    if (
      value?.version !== 1 ||
      !Number.isFinite(value.time) ||
      value.time < 0 ||
      value.time > story.duration ||
      ![value.x, value.y].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= 3 && Number.isInteger(n * 2),
      )
    )
      return;
    story.seek(value.time);
    story.explore({ x: value.x, y: value.y, result: 1 });
  }
  const saved = widgetState('displacements', restore);
  restore(saved.read());
  shell.onDispose(saved.dispose);
  Object.assign(root.scene, {
    shell,
    story,
    camera,
  });
})();
