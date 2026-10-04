import { SceneShell, SketchControls } from '@visual-storytelling/core';
import { Viewport3D, ThreeKit as T } from '@visual-storytelling/core/three';
import { Physics3D, PhysicsPlayer, PhysicsReplay } from '@visual-storytelling/core/physics/3d';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector<HTMLElement>('.ve-scene')!;
  const shell = SceneShell.mount(root, { title: 'Объём сохраняет свой материал', paper: false });
  shell.stage.style.height = '430px';
  const view = Viewport3D.mount(shell.stage, {
    label: 'Три тела падают на общую опору. Перетаскивайте их, чтобы почувствовать упругость.',
  });
  const group = new T.Group();
  const world = await Physics3D.create();
  const physics = Physics3D.meshes(world, view);
  const floor = new T.Mesh(
    new T.BoxGeometry(5.4, 0.15, 2.4),
    view.ink(new T.MeshStandardMaterial({ roughness: 1 }), 'blue-wash'),
  );
  floor.position.y = -0.08;
  group.add(floor);
  physics.body('floor', floor, { fixed: true });
  const tones = ['blue', 'orange', 'purple'] as const;
  const materials = ['solid', 'rubber', 'jelly'] as const;
  const bodies = materials.map((material, i) => {
    const mesh = new T.Mesh(
      new T.SphereGeometry(0.44, 24, 16),
      view.ink(new T.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), tones[i]),
    );
    mesh.position.set((i - 1) * 1.45, 1.8 + i * 0.15, 0);
    group.add(mesh);
    const physical = physics.body(`material-${i}`, mesh, { material, cellSize: 0.23 });
    view.label(String(i + 1), mesh, {
      tone: tones[i],
      size: 22,
      offset: [0, -48],
    });
    return physical;
  });
  view.setObject(group);
  view.shot({
    target: new T.Box3(new T.Vector3(-2.8, -0.25, -1.3), new T.Vector3(2.8, 2.6, 1.3)),
    direction: [2, 2, 5],
    padding: 32,
  });
  const footer = root.querySelector<HTMLElement>('[data-player]')!;
  const legend = document.createElement('p');
  legend.textContent = '1 — твёрдый · 2 — упругий · 3 — мягкий';
  legend.style.textAlign = 'center';
  footer.before(legend);
  footer.hidden = false;
  const player = PhysicsPlayer.mount(footer, world);
  shell.actions.append(SketchControls.action('Сначала', () => player.reset()));
  const replay = PhysicsReplay.create(world, {
    duration: 5,
    beforeSeek: () => player.pause(false),
    afterSeek: player.update,
  });
  Object.defineProperties(
    root.scene!,
    Object.getOwnPropertyDescriptors({
      world,
      bodies,
      view,
      duration: replay.duration,
      get currentTime() {
        return world.time;
      },
      get playing() {
        return player.playing;
      },
      play: player.play,
      pause: player.pause,
      seek: replay.seek,
      snapshot: () =>
        bodies.map((b) => ({ id: b.id, position: b.position, soft: Boolean(b.soft) })),
    }),
  );
  shell.onDispose(() => {
    world.dispose();
    view.dispose();
  });
})();
