import { SceneShell, MathMorph } from '@visual-storytelling/core';
import { Viewport3D, ThreeKit as T, MathMorph3D } from '@visual-storytelling/core/three';
import { Physics3D, PhysicsPlayer, PhysicsReplay } from '@visual-storytelling/core/physics/3d';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('morph-contact-scene');
  const shell = SceneShell.mount(root, { title: 'Форма становится опорой' });
  const view = Viewport3D.mount(shell.stage, {
    label:
      'Шар опирается на целую полосу. Разрез открывает щель: шар теряет опору и падает. Его можно подхватить мышью',
  });
  shell.attachView(view);
  const model = MathMorph3D.mount(view, MathMorph.divide(6, 2), { pigment: 'orange' });
  const objects = new T.Group();
  objects.add(model.object);
  const ball = new T.Mesh(
    new T.SphereGeometry(0.28, 24, 16),
    view.ink(new T.MeshStandardMaterial({ roughness: 1 }), 'blue'),
  );
  ball.position.set(0, 0.82, 0);
  objects.add(ball);
  view.setObject(objects, { fitView: false });
  view.shot({
    target: new T.Box3(new T.Vector3(-4, -2, -1.5), new T.Vector3(4, 3, 1.5)),
    direction: [3, 3, 9],
    padding: 36,
  });
  const world = await Physics3D.create();
  const contact = Physics3D.morph(world, model.surface, { id: 'cutting-surface', cellSize: 0.06 });
  const meshes = Physics3D.meshes(world, view);
  const body = meshes.body('ball', ball);
  const floor = new T.Line(
    new T.BufferGeometry().setFromPoints([
      new T.Vector3(-3.8, -1.9, 0),
      new T.Vector3(3.8, -1.9, 0),
    ]),
    view.ink(new T.LineBasicMaterial({ transparent: true, opacity: 0.5 }), 'ink'),
  );
  objects.add(floor);
  world.body('floor', { shape: { box: [16, 0.2, 8] }, at: [0, -2, 0], fixed: true });
  const duration = 6;
  const frame = () => model.render(Math.max(0, Math.min(1, (world.time - 1) / 4)));
  const offStep = world.beforeStep(frame),
    offRender = world.onRender(frame);
  const stop = world.track('cut-motion', {
    awake: () => world.time < duration,
    dispose() {
      offStep();
      offRender();
    },
  });
  const controls = root.querySelector('[data-player]');
  controls.hidden = false;
  const player = PhysicsPlayer.mount(controls, world);
  const replay = PhysicsReplay.create(world, {
    duration: 8,
    beforeSeek: () => player.pause(false),
    afterSeek: () => player.pause(false),
  });
  shell.onDispose(() => {
    player.dispose();
    world.dispose();
    model.dispose();
    stop();
  });
  root.scene.extend({
    view,
    world,
    model,
    body,
    duration: replay.duration,
    get currentTime() {
      return world.time;
    },
    get playing() {
      return player.playing;
    },
    seek: replay.seek,
    play: player.play,
    pause: () => player.pause(false),
    snapshot: () => ({
      time: world.time,
      ball: body.position,
      phase: model.plan.sample(Math.max(0, Math.min(1, (world.time - 1) / 4))).phase,
    }),
  });
  player.play();
})();
