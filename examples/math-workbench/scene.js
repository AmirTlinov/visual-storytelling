import { SceneShell, SketchControls } from '@visual-storytelling/core';
import { Viewport3D, vectorOperation, cameraTrack } from '@visual-storytelling/core/three';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('#ve-scene');
  let camera, story, operation;
  const shell = SceneShell.mount(root, {
    title: 'Одни числа — понятные действия',
    exploration: 'view',
    onMode(mode) {
      if (mode === 'story') camera?.resume(story?.currentTime ?? 0);
      else camera?.explore();
    },
  });
  const view = Viewport3D.mount(shell.stage, {
    label: 'Перенос пары чисел, действие и получение результата',
    onInteract: () => shell.setMode('explore'),
  });
  await view.ready;
  const examples = {
    add: {
      kind: 'add',
      a: [-0.06, -1.58, 0.45, -0.05, -0.16, -0.2, 0.06, 0.26],
      b: [0.25, 0.32, -0.45, 0.0032, 0.4, -0.06, 0.8, 0.0004],
      labels: { a: 'первое смещение', b: 'второе смещение', result: 'общее смещение' },
    },
    multiply: {
      kind: 'multiply',
      a: [1.2, 0.4, -0.8, 2.5],
      b: [0.5, 2, -1, 0.2],
      labels: { a: 'величины', b: 'масштабы', result: 'после масштабирования' },
    },
    dot: {
      kind: 'dot',
      a: [0.25, 0.35, 0.2, 0.4, 0.8, 0.5, 0.2, 0.35, 0.1],
      b: [1, 2, 1, 2, 4, 2, 1, 2, 1].map((n) => n / 16),
      labels: { a: 'яркости пикселей', b: 'доли фильтра', result: 'новая яркость' },
    },
  };
  function choose(key) {
    story?.pause();
    camera?.dispose();
    operation?.dispose();
    const spec = examples[key];
    operation = vectorOperation(view, { id: 'calculation', ...spec });
    view.setObject(operation.group, { fitView: false });
    const duration = spec.a.length * 5 + 3;
    const timing = {
      duration,
      cues: {
        compute: {
          start: 1,
          end: duration - 2,
          action: 'Копии каждой пары приходят в область операции; результат занимает свою ячейку.',
        },
      },
      segments: spec.a.map((_, i) => ({
        id: `coordinate-${i}`,
        start: 1 + i * 5,
        end: 1 + (i + 1) * 5,
        text: `Координата ${i + 1}`,
      })),
    };
    camera = cameraTrack(view, {
      target: operation.framing,
      direction: [0.04, 0.05, 1],
      padding: 58,
    });
    story = shell.attachStory({
      audio: null,
      script: timing,
      stateAt: (frame) => frame.progress('compute'),
      render(progress, frame) {
        operation.render(progress, frame.reduced);
        camera.render(frame.time, frame.reduced);
      },
    });
    shell.setMode('story');
    story.seek(0);
    Object.assign(root.scene, {
      snapshot: () => ({
        ...operation.snapshot(),
        following: camera.following,
        readability: view.inspect(),
      }),
      shell,
      view,
      dispose() {
        operation.dispose();
        shell.dispose();
      },
    });
    window.explainer = root.scene;
  }
  const picker = SketchControls.field(
    {
      type: 'select',
      label: 'Действие',
      value: 'add',
      options: [
        { value: 'add', label: 'Сложение координат' },
        { value: 'multiply', label: 'Изменение масштаба' },
        { value: 'dot', label: 'Фильтр изображения' },
      ],
    },
    choose,
  );
  shell.attachView({
    reset: () => {
      shell.setMode('story');
      camera.resume(story.currentTime);
    },
    dispose: () => {
      camera.dispose();
      view.dispose();
    },
  });
  shell.actions.append(picker.element);
  choose('add');
})();
