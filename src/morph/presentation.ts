import { borrowSceneView } from '../scene/view-access.js';
import { releaseResources } from '../lifecycle.js';
import { mathPlan } from './plan.js';
import type { MathOperation, MathMorphPlan } from './types.js';
import type { ConstructionPlan } from './construction/types.js';
import type { MorphCues, MorphTime } from './timing.js';
import { mountBodies } from './body-presentation.js';
import { mountConstruction } from './construction/render.js';
import type { SceneView } from '../scene-checkpoint.js';

type Operation = MathOperation | MathMorphPlan | ConstructionPlan;
const isConstruction = (value: Operation): value is ConstructionPlan =>
  'encoding' in value && value.encoding === 'construction';

/** One mounted owner survives changes between numerical bodies and geometric explanations. */
export async function mountMath(
  parent: HTMLElement,
  operation: Operation,
  options: {
    projection?: '2d' | '3d';
    pigment?: string;
    columns?: number;
    formula?: boolean;
    notes?: boolean | 'operators';
    format?: (value: number) => string;
  } = {},
) {
  const element = document.createElement('div');
  element.className = 've-math-presentation';
  const layout = parent.closest('[data-scene-frame]') ? 'scene' : 'content';
  parent.append(element);
  let host: HTMLDivElement | undefined;
  let body: ReturnType<typeof mountBodies> | undefined;
  let construction: ReturnType<typeof mountConstruction> | undefined;
  let disposed = false;
  const current = () => (body ?? construction)!;
  const currentView = (): SceneView => current().view;
  function setOperation(next: Operation) {
    if (disposed) throw new Error('Math presentation has been disposed');
    // Same-kind edits reuse the owner. A different presentation is mounted before retiring it.
    if (isConstruction(next)) {
      const prepared = next;
      if (construction) return construction.setOperation(prepared);
      replace(
        (target) => mountConstruction(target, prepared, { layout }),
        (mounted) => {
          construction = mounted;
          body = undefined;
        },
      );
    } else {
      const prepared = mathPlan(next);
      if (body) return body.setOperation(prepared);
      replace(
        (target) => mountBodies(target, prepared, { ...options, layout }),
        (mounted) => {
          body = mounted;
          construction = undefined;
        },
      );
    }
  }
  function replace<T extends { dispose(): void }>(
    mount: (target: HTMLDivElement) => T,
    publish: (candidate: T) => void,
  ) {
    const target = document.createElement('div');
    target.dataset.mathLayout = layout;
    target.style.visibility = 'hidden';
    element.append(target);
    let candidate: T;
    try {
      candidate = mount(target);
    } catch (error) {
      target.remove();
      throw error;
    }
    const previous = current(),
      previousHost = host;
    host = target;
    publish(candidate);
    target.style.removeProperty('visibility');
    // Once accepted, a replacement remains usable even if retiring the old owner fails.
    releaseResources(
      [() => previous?.dispose(), () => previousHost?.remove()],
      'Previous math presentation disposal failed.',
    );
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    releaseResources(
      [() => current()?.dispose(), () => element.remove()],
      'Math presentation disposal failed.',
    );
  }
  try {
    setOperation(operation);
  } catch (error) {
    releaseResources(
      [
        () => {
          throw error;
        },
        dispose,
      ],
      'Math presentation initialization failed.',
    );
    throw error;
  }
  return {
    element,
    view: borrowSceneView(() => (disposed ? undefined : currentView()), dispose),
    render(time: MorphTime, cues?: MorphCues) {
      if (!disposed) return current().render(time, cues);
    },
    get plan() {
      return current().plan;
    },
    get projection() {
      return current().projection;
    },
    setOperation,
    dispose,
  };
}
