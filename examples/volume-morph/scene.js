import { SceneShell } from '@visual-storytelling/core';
import { ThreeKit as T, Viewport3D, VolumeMorph } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';
import './style.css';
import timing from './timeline.json' with { type: 'json' };
import { cases, stateAt, shapeFrame } from './model.js';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('volume-morph-scene');
  const shell = SceneShell.mount(root, {
    title: 'Как меняется объёмная форма?',
    parameters: [
      {
        key: 'progress',
        label: 'Переход',
        min: 0,
        max: 1,
        step: 0.01,
        value: 0,
        format: (v) => `${Math.round(Number(v) * 100)}%`,
      },
    ],
  });
  const view = Viewport3D.mount(shell.stage, {
    label: 'Кубик, шар и слияние объёмных форм',
  });
  shell.attachView(view);
  const bounds = new T.Box3(new T.Vector3(-2.5, -1.35, -1.35), new T.Vector3(2.5, 1.35, 1.35));
  const morph = VolumeMorph.mount(view, { bounds, pigment: 'blue' });
  const cube = VolumeMorph.box([1.15, 1.15, 0.97]);
  const sphere = VolumeMorph.sphere(0.69);
  const shapes = [
    [[cube], sphere],
    [[cube, cube], VolumeMorph.box([2.25, 1.15, 0.97])],
    [[cube, VolumeMorph.sphere(0.575)], VolumeMorph.capsule(0.62, 2.6)],
  ];
  const world = new T.Group();
  world.add(morph.object);
  view.setObject(world, { fitView: false });
  const caption = document.createElement('div');
  caption.className = 'volume-caption';
  const title = document.createElement('span'),
    hint = document.createElement('small');
  hint.textContent = 'Поверни предмет, чтобы рассмотреть поверхность';
  caption.append(title, hint);
  shell.stage.after(caption);
  // Face labels establish the same numbered cubes as in the reference lesson.
  const anchors = [new T.Object3D(), new T.Object3D()];
  anchors.forEach((anchor) => world.add(anchor));
  let current = { index: 0, progress: 0 },
    active = -1;
  const labels = anchors.map((anchor, i) =>
    view.label(String(i + 1), anchor, {
      space: 'world',
      height: 0.48,
      maxWidth: 0.55,
      tone: 'ink',
      visible: () => current.progress < 0.16 && (current.index !== 0 || i === 0),
    }),
  );
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt,
    render(state, frame, mode) {
      current = state;
      if (active !== state.index) {
        active = state.index;
        morph.setShapes(...shapes[active]);
      }
      const pose = shapeFrame(active, state.progress);
      morph.render(pose);
      const sourceLabels = active === 0 ? ['1'] : active === 1 ? ['1', '2'] : ['1', ''];
      labels.forEach((label, i) => {
        label.set(sourceLabels[i] ?? '');
        label.opacity(Math.max(0, 1 - state.progress / 0.16));
        anchors[i].position.set(pose.sources[i]?.position?.[0] ?? 0, 0, 0.5);
      });
      title.textContent = cases[active].title;
      const radius = active === 0 ? 1.2 : 2.45;
      const result = mode === 'story' ? frame.progress(`${cases[active].id}_result`) : 0;
      view.shot({
        target: new T.Box3(new T.Vector3(-radius, -0.95, -0.85), new T.Vector3(radius, 1.05, 0.85)),
        direction: [-4.5 - result * 1.2, 2.8, 9],
        padding: 35,
        reduced: frame.reduced,
      });
      view.invalidate();
    },
  });
  const baseSnapshot = root.scene.snapshot;
  root.scene.snapshot = () => ({
    ...baseSnapshot(),
    ...current,
    renderer: 'gpu-field',
    form: cases[current.index].id,
  });
  Object.assign(root.scene, { view, story });
  shell.onDispose(() => caption.remove());
})().catch((error) => {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.textContent = error.message;
  document.getElementById('volume-morph-scene').append(alert);
  throw error;
});
