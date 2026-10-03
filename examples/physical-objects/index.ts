import { SceneShell, surface, lettering, SketchControls } from '@visual-storytelling/core';
import { Physics2D, PhysicsPlayer } from '@visual-storytelling/core/physics/2d';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector<HTMLElement>('.ve-scene')!;
  const shell = SceneShell.mount(root, { title: 'Форма чувствует прикосновение', paper: false });
  const width = Math.min(840, Math.max(320, root.clientWidth));
  const scale = width < 540 ? 64 : 100;
  shell.stage.style.height = 'auto';
  const drawing = surface(shell.stage, {
    id: 'physical-materials',
    width,
    height: 360,
    title: 'Три материала',
    description:
      'Перетаскивайте тела: твёрдое сохраняет форму, резина пружинит, мягкое тело сминается.',
  });
  const world = await Physics2D.create();
  const ink = Physics2D.ink(world, drawing, { scale });
  ink.body('floor', {
    shape: { box: [width / scale - 0.3, 0.16] },
    at: [width / scale / 2, 3.05],
    fixed: true,
    pigment: 'ink',
  });
  const materials = ['solid', 'rubber', 'jelly'] as const;
  const pigments = ['blue', 'orange', 'purple'] as const;
  const labels = ['Твёрдый', 'Упругий', 'Мягкий'];
  const bodies = materials.map((material, i) => {
    const x = (width / scale) * (0.2 + i * 0.3);
    lettering(drawing.layer, labels[i]!, { x: x * scale, y: 28, size: width < 540 ? 18 : 22 });
    return ink.body(`material-${i}`, {
      shape: { circle: 0.38 },
      at: [x, 1.05 + i * 0.15],
      material,
      pigment: pigments[i],
      label: String(i + 1),
    });
  });
  lettering(drawing.layer, 'Потяни — и отпусти', { x: width / 2, y: 344, size: 21 });
  const footer = root.querySelector<HTMLElement>('[data-player]')!;
  footer.hidden = false;
  const player = PhysicsPlayer.mount(footer, world);
  const reset = SketchControls.action('Сначала', () => player.reset());
  shell.actions.append(reset);
  const initial = world.snapshot();
  Object.assign(root, {
    scene: {
      world,
      bodies,
      duration: 5,
      pause: player.pause,
      seek(time: number) {
        player.pause(false);
        world.restore(initial);
        world.step(Math.round(Math.max(0, time) * 120));
        player.update();
      },
      snapshot: () =>
        bodies.map((b) => ({
          id: b.id,
          position: b.position,
          soft: Boolean(b.soft),
          sleeping: (b.soft ?? b.rigid).isSleeping(),
        })),
      dispose() {
        world.dispose();
        drawing.dispose();
        shell.dispose();
      },
    },
  });
})();
