import { mathPlan } from './math.js';
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
  options: { projection?: '2d' | '3d'; pigment?: string; columns?: number } = {},
) {
  const element = document.createElement('div');
  element.className = 've-math-presentation';
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
      replace((target) => {
        const mounted = mountConstruction(target, prepared);
        return () => {
          construction = mounted;
          body = undefined;
        };
      });
    } else {
      const prepared = mathPlan(next);
      if (body) return body.setOperation(prepared);
      replace((target) => {
        const layout = parent.closest('[data-scene-frame]') ? 'scene' : 'content';
        target.dataset.mathLayout = layout;
        const mounted = mountBodies(target, prepared, { ...options, layout });
        return () => {
          body = mounted;
          construction = undefined;
        };
      });
    }
  }
  function replace(mount: (target: HTMLDivElement) => () => void) {
    const target = document.createElement('div');
    target.style.visibility = 'hidden';
    element.append(target);
    try {
      const publish = mount(target);
      current()?.dispose();
      host?.remove();
      host = target;
      publish();
      target.style.removeProperty('visibility');
    } catch (error) {
      target.remove();
      throw error;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    current().dispose();
    element.remove();
  }
  try {
    setOperation(operation);
  } catch (error) {
    body?.dispose();
    construction?.dispose();
    element.remove();
    throw error;
  }
  return {
    element,
    view: {
      get transition() {
        return currentView().transition;
      },
      get focus() {
        const view = currentView();
        return view.focus?.bind(view);
      },
      get validateFocus() {
        const view = currentView();
        return view.validateFocus?.bind(view);
      },
      reset(settings) {
        currentView().reset(settings);
      },
      capture() {
        return currentView().capture?.();
      },
      restore(value) {
        const view = currentView();
        return view.restore ? view.restore(value) : false;
      },
      dispose,
    } satisfies SceneView,
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
