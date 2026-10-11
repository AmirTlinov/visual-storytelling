import { SceneShell, surface, vector, SvgLayout } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import timing from './timeline.json' with { type: 'json' };

// Small owner fixture: one accepted model, one rendered SVG, one story and one player.
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Проверка оболочки',
    parameters: [
      { key: 'x', label: 'По горизонтали', min: -3, max: 3, step: 0.5, value: 3 },
      { key: 'y', label: 'По вертикали', min: -3, max: 3, step: 0.5, value: 2 },
    ],
  });
  const drawing = surface(shell.stage, {
    id: 'shell-subject',
    width: 960,
    height: 400,
    grid: { step: 50 },
  });
  shell.onDispose(() => drawing.dispose());
  let pose = { x: 0, y: 0 };
  const horizontal = vector(drawing, 'horizontal', 'ink');
  const vertical = vector(drawing, 'vertical', 'orange');
  const result = vector(drawing, 'result', 'purple');
  horizontal.describe({ label: 'Горизонтальное перемещение', value: () => pose.x });
  vertical.describe({ label: 'Вертикальное перемещение', value: () => pose.y });
  result.describe({
    label: 'Результат двух перемещений',
    value: () => [pose.x, pose.y],
    inputs: () => ['horizontal', 'vertical'],
  });
  const label = SvgLayout.element('text', { 'font-size': 32, fill: 'var(--ve-ink)' });
  drawing.layer.append(label);
  const tip = document.createElement('p');
  tip.textContent = 'Одна клетка — один шаг';
  shell.actions.append(tip);
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: (frame) => ({ x: 3 * frame.progress('move_x'), y: 2 * frame.progress('move_y') }),
    render(values) {
      pose = values;
      const { width, height, scale } = shell.layout;
      const unit = Math.min(width / 8, height / 7);
      const a = [width / 2, height / 2],
        b = [a[0] + pose.x * unit, a[1]],
        c = [b[0], a[1] - pose.y * unit];
      drawing.resize(width, height, { step: unit, x: a[0], y: a[1] });
      horizontal.set(a, b);
      vertical.set(b, c);
      result.set(a, c);
      label.textContent = `(${Number(pose.x.toFixed(1))}; ${Number(pose.y.toFixed(1))})`;
      label.setAttribute('x', c[0]);
      label.setAttribute('y', c[1] - 26);
      label.setAttribute('font-size', Math.max(32, 16 / scale));
    },
  });
  root.scene.extend({ shell, story, drawing });
})();
