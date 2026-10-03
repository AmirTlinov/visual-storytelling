import { Box3, Vector3 } from 'three';
import type { Viewport3D } from '../viewport/three.js';
import { morphBody3D } from './body-3d.js';
import { morphPlan, type MorphOperation } from './objects.js';

function mount(
  view: ReturnType<typeof Viewport3D.mount>,
  operation: MorphOperation,
  options: { pigment?: string } = {},
) {
  let plan = morphPlan(operation);
  const body = morphBody3D(view, options);
  const bounds = new Box3();
  let progress = 0,
    disposed = false;
  body.surface.onDispose(() => {
    disposed = true;
  });
  function prepare() {
    bounds.set(new Vector3(...plan.bounds[0]), new Vector3(...plan.bounds[1]));
    const frame = plan.sample(0);
    body.surface.prepare([{ sources: frame.sources.length, targets: frame.targets.length }]);
  }
  function render(p: number) {
    if (disposed) return;
    const frame = plan.sample(p);
    body.render(frame);
    progress = Math.max(0, Math.min(1, p));
    return frame;
  }
  function setOperation(next: MorphOperation) {
    if (disposed) throw new Error('Morph has been disposed');
    plan = morphPlan(next);
    prepare();
    render(0);
  }
  prepare();
  render(0);
  return {
    object: body.object,
    bounds,
    render,
    setOperation,
    dispose: body.dispose,
    get surface() {
      return body.surface;
    },
    get plan() {
      return plan;
    },
    get progress() {
      return progress;
    },
  };
}
export const Morph3D = { mount };
