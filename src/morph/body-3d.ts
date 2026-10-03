import { VolumeMorph } from '../viewport/morph/surface.js';
import type { Viewport3D } from '../viewport/three.js';
import { surfaceInscriptions } from './ink.js';
import type { MorphFrame } from './objects.js';
import { Vector3 } from 'three';

/** Shared presentation of generic and mathematical bodies; no proxy label geometry. */
export function morphBody3D(
  view: ReturnType<typeof Viewport3D.mount>,
  options: { pigment?: string } = {},
) {
  const surface = VolumeMorph.mount(view, options),
    inscriptions = surfaceInscriptions();
  const reading = document.createElement('span');
  reading.className = 've-surface-label';
  reading.setAttribute('data-morph-ink', '');
  view.renderer.domElement.parentElement!.append(reading);
  const center = new Vector3(),
    scale = new Vector3(),
    canvas = view.renderer.domElement;
  let disposed = false,
    latest: MorphFrame | undefined,
    previousPixel = 0;
  let topology = '',
    previous = '';
  function render(frame: MorphFrame) {
    if (disposed) return;
    latest = frame;
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    const key = JSON.stringify(frame);
    const shapes = JSON.stringify(
      [frame.sources, frame.targets].map((parts) => parts.map((p) => p.shape)),
    );
    if (shapes !== topology) {
      surface.setShapes(
        frame.sources.map((p) => p.shape),
        frame.targets.map((p) => p.shape),
      );
      topology = shapes;
    }
    if (key !== previous) surface.render(frame);
    const box = surface.geometry!.bounds;
    center.set(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2,
    );
    surface.object.localToWorld(center);
    view.camera.worldToLocal(center);
    surface.object.getWorldScale(scale);
    const pixel =
      (2 * Math.abs(center.z)) /
      (view.camera.projectionMatrix.elements[5]! *
        canvas.clientHeight *
        Math.max(0.001, Math.min(Math.abs(scale.x), Math.abs(scale.y))));
    if (key === previous && Math.abs(pixel - previousPixel) < previousPixel * 0.05) return;
    const ink = inscriptions.sample(frame, pixel);
    surface.inscribe(ink);
    reading.textContent = ink.label;
    previous = key;
    previousPixel = pixel;
  }
  const refresh = () => {
    if (latest) render(latest);
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(canvas);
  view.controls.addEventListener('change', refresh);
  surface.onDispose(() => {
    disposed = true;
    observer.disconnect();
    view.controls.removeEventListener('change', refresh);
    reading.remove();
  });
  return {
    surface,
    object: surface.object,
    render,
    dispose: surface.dispose,
  };
}
