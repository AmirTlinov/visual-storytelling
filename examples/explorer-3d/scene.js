import { SceneShell } from '@visual-storytelling/core';
import { ThreeKit as T, Viewport3D } from '@visual-storytelling/core/three';
import timing from './timeline.json' with { type: 'json' };
import { measuringBox } from './box.js';
import { lessonState, part } from './model.js';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Сколько места внутри коробки?',
    parameters: [
      { key: 'x', label: 'Кубиков в ряду', min: 1, max: 6, step: 1, value: 3 },
      { key: 'z', label: 'Рядов в слое', min: 1, max: 3, step: 1, value: 2 },
      { key: 'y', label: 'Слоёв', min: 1, max: 3, step: 1, value: 2 },
    ],
  });
  shell.stage.style.height = 'clamp(300px, 51vh, 450px)';
  const view = Viewport3D.mount(shell.stage, {
    label: 'Из единичного кубика собираются ряд, слой и объём коробки',
    labelInsets: () => ({ top: 8, bottom: 8 }),
  });
  shell.attachView(view);
  const box = measuringBox(view);
  // A summary belongs to the whole experiment; it stays readable while the object turns.
  const result = document.createElement('output');
  result.className = 've-label';
  result.dataset.tone = 'purple';
  result.setAttribute('aria-label', 'Объём коробки');
  result.style.cssText =
    'left:50%;top:auto;bottom:8px;transform:translateX(-50%);font-size:clamp(20px,3.8vw,25px);text-align:center';
  shell.stage.append(result);
  const bounds = (a, b) => new T.Box3(new T.Vector3(...a), new T.Vector3(...b));
  const opening = {
    target: bounds([-2.4, -0.7, -2.5], [3.6, 3.2, 1.1]),
    direction: [3, 2.2, 6],
    padding: 26,
  };
  const unit = {
    target: bounds([-2.7, -0.5, -0.5], [-0.2, 1.9, 1.1]),
    direction: [2, 1.4, 6],
    padding: 35,
  };
  const whole = {
    target: bounds([-0.55, -1.2, -2.55], [3.6, 3.7, 0.9]),
    direction: [2, 2, 7],
    padding: 24,
  };
  const above = { ...whole, direction: [1.3, 5.5, 3.8] };
  const side = { ...whole, direction: [4.5, 2.5, 7] };
  const expanded = {
    target: bounds([-0.7, -1.2, -2.7], [6.7, 3.2, 0.9]),
    direction: [2.5, 2.6, 7],
    padding: 24,
  };
  const shots = [
    ['unit_focus', unit],
    ['place_unit', whole],
    ['layer_view', above],
    ['stack_view', side],
    ['compare_view', expanded],
  ];
  let current;
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: lessonState,
    render(state, frame, mode) {
      const exploring = mode === 'explore';
      current = { ...state, ...box.render(state, frame, exploring), mode };
      result.textContent = current.formula;
      result.hidden = !current.formula;
      if (exploring) {
        view.shot({
          target: bounds([-0.8, -1.2, -state.z - 0.7], [state.x + 0.8, state.y + 0.6, 1]),
          direction: [3, 2.6, 7],
          padding: 25,
        });
      } else {
        let from = opening,
          next = opening,
          progress = 1;
        for (const [cue, pose] of shots) {
          if (!frame.has(cue)) break;
          from = next;
          next = pose;
          progress =
            cue === 'compare_view' ? part(frame.progress(cue), 0, 0.32) : frame.progress(cue);
        }
        view.shot({ ...next, from, progress, reduced: frame.reduced });
      }
    },
  });
  Object.assign(root.scene, { shell, view, story, snapshot: () => current });
})().catch((error) => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = `Не удалось открыть сцену: ${error.message}`;
  document.getElementById('ve-scene').append(message);
  throw error;
});
