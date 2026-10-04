import { SceneShell } from '@visual-storytelling/core';
import { CharacterStage, chibi, workshop } from '@visual-storytelling/core/characters';
import { ThreeKit as T, Viewport3D } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('chibi-stage');
  const shell = SceneShell.mount(root, { title: 'От идеи к опыту', paper: false });
  const view = Viewport3D.mount(shell.stage, { label: 'Тесла и Мира перед моделью атома' });
  shell.attachView(view);
  const hidden = document.createElement('div');
  const actors = await CharacterStage.mount(hidden, {
    pack: chibi,
    set: workshop(),
    background: false,
    cast: {
      tesla: { skin: 'tesla', at: 'left', scale: 0.7 },
      mira: { skin: 'mira', at: 'right', scale: 0.7, flip: true },
    },
    beats: [
      {
        id: 'think',
        seconds: 3,
        text: 'Обдумывают модель.',
        actors: { tesla: 'think', mira: 'confused' },
      },
      {
        id: 'idea',
        seconds: 4,
        text: 'Находят общий подход.',
        actors: { tesla: 'idea', mira: 'celebrate' },
      },
    ],
  }).catch((error) => {
    shell.dispose();
    throw error;
  });
  actors.show(false);
  shell.onDispose(actors.dispose);
  const texture = new T.CanvasTexture(actors.canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const cast = new T.Mesh(
    new T.PlaneGeometry(9.6, 6.5),
    new T.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  cast.position.set(0, 3.25, 1.2);
  const model = new T.Group();
  const nucleus = new T.Mesh(
    new T.SphereGeometry(0.35, 24, 16),
    view.ink(new T.MeshStandardMaterial(), 'orange'),
  );
  model.add(nucleus);
  for (const angle of [-0.8, 0.8]) {
    const orbit = new T.Mesh(
      new T.TorusGeometry(1.1, 0.018, 8, 64),
      view.ink(new T.MeshBasicMaterial(), 'pencil'),
    );
    orbit.rotation.y = angle;
    model.add(orbit);
  }
  model.position.set(0, 2.7, -0.8);
  const all = new T.Group();
  all.add(cast, model);
  view.setObject(all);
  const whole = {
    target: new T.Box3(new T.Vector3(-4.8, 0, -2), new T.Vector3(4.8, 6.5, 1.3)),
    direction: [0, 0.15, 8],
    padding: 12,
  };
  shell.attachStory({
    script: {
      duration: 11,
      cues: {
        intro: { start: 0, end: 7, action: 'Герои вводят модель.' },
        detail: { start: 7, end: 9, action: 'Герои уходят, камера приближает модель.' },
      },
    },
    stateAt: (frame) => ({ time: frame.time, detail: frame.progress('detail') }),
    render(state, frame) {
      cast.visible = !frame.finished('detail');
      if (cast.visible) {
        actors.render(Math.min(7, state.time), frame.reduced);
        texture.needsUpdate = true;
      }
      cast.material.opacity = 1 - state.detail;
      view.shot({
        target: model,
        direction: [2, 1.2, 8],
        from: whole,
        progress: state.detail,
        reduced: frame.reduced,
        padding: 48,
      });
      view.invalidate();
      frame.target('intro', 'cast');
      frame.target('detail', 'model');
    },
  });
})().catch((error) => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = error.message;
  document.getElementById('chibi-stage').append(message);
  throw error;
});
