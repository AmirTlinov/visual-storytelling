import { SceneShell } from '@visual-storytelling/core';
import { Viewport3D, ThreeKit as T, InkStroke3D } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('trace');
  const shell = SceneShell.mount(root, {
    title: 'Как возникает траектория?',
    parameters: [{ key: 'turns', label: 'Обороты', min: 1, max: 4, step: 1, value: 2 }],
  });
  shell.stage.style.height = 'clamp(300px, 60vh, 520px)';
  const view = Viewport3D.mount(shell.stage, {
    label: 'Вращение и подъём образуют винтовую линию',
  });
  shell.attachView(view);
  const group = new T.Group();
  const axis = InkStroke3D.create(
    view,
    [
      [0, -1.5, 0],
      [0, 1.5, 0],
    ],
    {
      color: 'pencil',
      dashed: true,
      width: 1.2,
    },
  );
  const trace = InkStroke3D.create(view, [], { color: 'blue', width: 2.4 });
  const tip = new T.Mesh(new T.SphereGeometry(0.045, 16, 10), new T.MeshBasicMaterial());
  view.ink(tip.material, 'blue');
  group.add(axis.root, trace.root, tip);
  view.setObject(group, { fitView: false });
  const box = new T.Box3(new T.Vector3(-1.5, -1.8, -1.5), new T.Vector3(1.5, 1.8, 1.5));
  let turns;
  shell.attachStory({
    script: {
      duration: 8,
      cues: {
        trace: { start: 0, end: 6, action: 'Вращение вместе с подъёмом оставляет винтовой след.' },
        inspect: { start: 6, end: 8, hold: 'Поверните траекторию и измените число оборотов.' },
      },
    },
    stateAt: () => ({ turns: 2 }),
    render(values, frame, mode) {
      if (turns !== values.turns) {
        turns = values.turns;
        trace.points(
          Array.from({ length: 241 }, (_, i) => {
            const t = i / 240,
              angle = t * turns * Math.PI * 2;
            return [1.2 * Math.cos(angle), -1.4 + 2.8 * t, 1.2 * Math.sin(angle)];
          }),
        );
      }
      const progress = mode === 'explore' ? 1 : frame.reveal('trace');
      trace.draw(progress);
      tip.position.fromArray(trace.pointAt(progress));
      view.shot({ target: box, direction: [3, 1.5, 6], padding: 20 });
    },
  });
})();
