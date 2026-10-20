import type { SceneView } from '../scene-checkpoint.js';
/** A stable scene port borrows the currently visible camera without owning another view. */
export function borrowSceneView(
  owner: () => Omit<SceneView, 'dispose'> | undefined,
  dispose: () => void,
): SceneView {
  return {
    get transition() {
      return owner()?.transition ?? 'idle';
    },
    get whenRendered() {
      const view = owner();
      return view?.whenRendered?.bind(view);
    },
    get focus() {
      const view = owner();
      return view?.focus?.bind(view);
    },
    get validateFocus() {
      const view = owner();
      return view?.validateFocus?.bind(view);
    },
    reset(options) {
      owner()?.reset(options);
    },
    capture() {
      return owner()?.capture?.();
    },
    restore(state) {
      const view = owner();
      return view?.restore ? view.restore(state) : false;
    },
    dispose,
  };
}
