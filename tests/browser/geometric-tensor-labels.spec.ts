import { test, expect } from '@playwright/test';

test('tensor annotations avoid objects and links through camera changes and checkpoint rewind', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/geometric-tensor/index.html');
  await page.evaluate(async () => {
    await (window as any).galleryReady;
    await document.fonts.ready;
  });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
    const states = await page.evaluate(async () => {
      const root = document.querySelector<SVGSVGElement>('svg.ve-scene')!;
      const scene = (root as any).scene;
      const poses = [
        { yaw: 1.3, pitch: 0, zoom: 1, pan: [0, 0] },
        { yaw: 0.58, pitch: 0.34, zoom: 1, pan: [0, 0] },
        { yaw: 1.2, pitch: -0.75, zoom: 1, pan: [0, 0] },
        { yaw: 1.3, pitch: 0.75, zoom: 1, pan: [0, 0] },
        { yaw: 2.2, pitch: -0.5, zoom: 1.2, pan: [-30, 20] },
        { yaw: 4.5, pitch: 0.5, zoom: 0.8, pan: [25, -15] },
        { yaw: 1.3, pitch: 0, zoom: 1, pan: [0, 0] },
      ];
      const overlap = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.1;
      function inspect() {
        const labels = [...root.querySelectorAll<SVGGraphicsElement>('#annotations text')];
        const aperture = root
          .querySelector<SVGGraphicsElement>('#viewport > rect')!
          .getBoundingClientRect();
        const materials = [...root.querySelectorAll<SVGGraphicsElement>('[id$="-surface"]')];
        const overlaps: string[] = [];
        const obstacles: string[] = [];
        const outside: string[] = [];
        for (const [index, label] of labels.entries()) {
          const box = label.getBoundingClientRect();
          if (
            box.left < aperture.left - 0.1 ||
            box.top < aperture.top - 0.1 ||
            box.right > aperture.right + 0.1 ||
            box.bottom > aperture.bottom + 0.1
          )
            outside.push(label.id);
          for (const other of labels.slice(index + 1))
            if (overlap(box, other.getBoundingClientRect()))
              overlaps.push(`${label.id}/${other.id}`);
          for (const object of materials)
            if (overlap(box, object.getBoundingClientRect()))
              obstacles.push(`${label.id}/${object.id}`);
        }
        return {
          labels: labels.map((label) => ({
            id: label.id,
            status: label.dataset.layoutStatus,
            visible: label.checkVisibility({ visibilityProperty: true }),
            transform: label.getAttribute('transform'),
          })),
          leaders: [...root.querySelectorAll<SVGPathElement>('#annotations [data-label-for]')].map(
            (node) => node.getAttribute('d'),
          ),
          overlaps,
          obstacles,
          outside,
          overflow: scene.presentation().layoutOverflow,
        };
      }
      const result = [];
      for (const pose of poses) {
        if (!scene.camera.restore({ kind: 'svg-orbit', ...pose }))
          throw new Error('Supported tensor camera pose was rejected');
        result.push(inspect());
      }
      const saved = scene.capture();
      await scene.control([{ type: 'parameters', values: { t: 0.3 } }]);
      scene.camera.restore({ kind: 'svg-orbit', ...poses[3] });
      await scene.restore(saved);
      result.push(inspect());
      return result;
    });
    for (const state of states) {
      expect(state.labels).toHaveLength(5);
      expect(state.labels.every((label) => label.status === 'placed' && label.visible)).toBe(true);
      expect(state.overlaps).toEqual([]);
      expect(state.obstacles).toEqual([]);
      expect(state.outside).toEqual([]);
      expect(state.overflow).toEqual([]);
      expect(state.leaders.every(Boolean)).toBe(true);
    }
    expect(states.at(-2)).toEqual(states[0]);
    expect(states.at(-1)).toEqual(states[0]);
  }
  expect(errors).toEqual([]);
});
