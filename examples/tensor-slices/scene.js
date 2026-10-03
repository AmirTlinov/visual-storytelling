import { SceneShell, SketchControls } from '@visual-storytelling/core';
import {
  Viewport3D,
  ThreeKit as T,
  TensorData,
  TensorView,
  tensorSlice,
  cameraTrack,
} from '@visual-storytelling/core/three';
window.galleryReady = (async () => {
  await document.fonts.ready;
  const root = document.querySelector('#ve-scene');
  let camera, story;
  const shell = SceneShell.mount(root, {
    title: 'Один срез сохраняет свои значения',
    exploration: 'view',
    onMode(mode) {
      if (mode === 'story') camera?.resume(story?.currentTime ?? 0);
      else camera?.explore();
    },
  });
  const view = Viewport3D.mount(shell.stage, {
    label: 'Три измерения данных: день, точка и измерение',
    onInteract: () => shell.setMode('explore'),
  });
  await view.ready;
  const data = new TensorData(
    [3, 2, 3],
    [12, 14, 16, 10, 13, 15, 13, 15, 17, 11, 14, 16, 14, 16, 18, 12, 15, 17],
    ['день', 'точка', 'измерение'],
  );
  const whole = new TensorView(view, data, {
    id: 'measurements',
    title: '3 дня × 2 точки × 3 измерения',
    tone: 'blue',
    depthGap: 1.25,
  });
  whole.group.position.y = 1.5;
  const slice = tensorSlice(view, whole, { id: 'first-day', title: 'первый день · те же 6 чисел' });
  const group = new T.Group();
  group.add(whole.group, slice.group);
  view.setObject(group, { fitView: false });
  const timing = {
    duration: 18,
    cues: {
      reveal: { start: 0, end: 3, action: 'Появляются три слоя измерений.' },
      slice: {
        start: 5,
        end: 10,
        action: 'Первый слой выдвигается; его шесть значений сохраняются.',
      },
      read: { start: 10, end: 18, hold: 'Сравнить исходные значения с извлечённым слоем.' },
    },
    segments: [
      { id: 'whole', start: 0, end: 5, text: 'Сначала весь набор' },
      { id: 'slice', start: 5, end: 10, text: 'Извлекаем первый день' },
      { id: 'read', start: 10, end: 18, text: 'Те же значения, отдельное представление' },
    ],
  };
  camera = cameraTrack(view, { target: slice.framing, direction: [0.55, 0.3, 1], padding: 70 }, [
    { cue: timing.cues.slice, target: slice.framing, direction: [0.24, 0.2, 1], padding: 60 },
  ]);
  story = shell.attachStory({
    audio: null,
    timing,
    render(time, cues, reduced) {
      whole.reveal(cues.progress('reveal', time));
      slice.render(cues.progress('slice', time), reduced);
      camera.render(time, reduced);
      view.invalidate();
    },
  });
  const reset = SketchControls.action('Вернуть ракурс', () => {
    shell.setMode('story');
    camera.resume(story.currentTime);
  });
  shell.actions.append(reset);
  shell.setMode('story');
  story.seek(0);
  root.scene = {
    seek: story.seek,
    pause: story.pause,
    review: story.review,
    snapshot: () => ({
      values: slice.result.values,
      readability: view.inspect(),
      following: camera.following,
    }),
    view,
    shell,
    dispose() {
      camera.dispose();
      whole.dispose();
      slice.dispose();
      view.dispose();
      shell.dispose();
    },
  };
  window.explainer = root.scene;
})();
