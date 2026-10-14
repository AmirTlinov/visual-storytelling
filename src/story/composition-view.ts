import type { chapterPresentations } from './composition-presentations.js';
import type { SceneView } from '../scene-checkpoint.js';

/** View intent follows semantic IDs; numeric camera snapshots belong to their own chapter. */
export function compositionView(
  presentations: ReturnType<typeof chapterPresentations>,
  chapter: () => string,
  mode: () => 'story' | 'explore',
) {
  let focus: readonly string[] = [];
  const apply = (index?: number) => {
    const item = index === undefined ? presentations.active : presentations.get(index);
    const view = item?.drawing.view;
    if (!focus.length || !view?.focus || !item) return;
    const nodes = [...item.element.querySelectorAll<HTMLElement | SVGElement>('[data-object]')];
    const ids = focus.filter((id) =>
      nodes.some(
        (node) => node.dataset.object === id && !node.closest('[hidden], [aria-hidden="true"]'),
      ),
    );
    if (!ids.length) return;
    view.validateFocus?.(ids);
    view.focus(ids);
  };
  const owner: SceneView = {
    get transition() {
      return presentations.active?.drawing.view?.transition;
    },
    get focus() {
      const view = presentations.active?.drawing.view;
      return view?.focus
        ? (ids: readonly string[]) => {
            view.focus!(ids);
            focus = [...ids];
          }
        : undefined;
    },
    validateFocus(ids) {
      presentations.active?.drawing.view?.validateFocus?.(ids);
    },
    reset(settings) {
      const from = settings?.from as { chapter?: string; state?: unknown } | undefined;
      presentations.active?.drawing.view?.reset({
        animate: settings?.animate,
        from: from?.chapter === chapter() ? from?.state : undefined,
      });
      if (mode() === 'story' && settings?.animate) focus = [];
      else apply();
    },
    capture() {
      const state = presentations.active?.drawing.view?.capture?.();
      return state === undefined && !focus.length
        ? undefined
        : { chapter: chapter(), state, focus: [...focus] };
    },
    restore(value) {
      const saved = value as { chapter?: string; state?: unknown; focus?: unknown } | undefined;
      if (
        !saved ||
        saved.chapter !== chapter() ||
        (saved.focus !== undefined &&
          (!Array.isArray(saved.focus) ||
            saved.focus.length > 100 ||
            new Set(saved.focus).size !== saved.focus.length ||
            saved.focus.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256)))
      )
        return false;
      const view = presentations.active?.drawing.view;
      if (saved.state !== undefined && (!view?.restore || view.restore(saved.state) === false))
        return false;
      focus = [...((saved.focus as readonly string[] | undefined) ?? [])];
      if (saved.state === undefined) apply();
      return true;
    },
    dispose() {
      focus = [];
    },
  };
  return {
    owner,
    prepare(index: number) {
      apply(index);
    },
  };
}
