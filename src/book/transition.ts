import * as T from '../viewport/engine.js';
import { Viewport3D } from '../viewport/three.js';
import { notebookOpening } from './opening.js';
import { pageTurn } from './page-turn.js';

/** One temporary viewport owns the physical introduction and subsequent full-frame page turns. */
export function bookTransition(
  parent: HTMLElement,
  options: { topic: string; current: HTMLCanvasElement; previous: HTMLCanvasElement },
) {
  const view = Viewport3D.mount(parent, { label: `Tlinov · ${options.topic}` });
  view.controls.enabled = false;
  view.renderer.domElement.tabIndex = -1;
  view.renderer.domElement.style.cssText = 'width:100%;height:100%;pointer-events:none';
  const opening = notebookOpening(view, options.topic),
    turn = pageTurn(view, options);
  const root = new T.Group();
  root.add(opening.root, turn.root);
  view.setObject(root, { fitView: false });
  return {
    render(state: { page: number; open: number; turn: number; aspect: number }) {
      if (
        !Number.isInteger(state.page) ||
        state.page < 0 ||
        ![state.open, state.turn, state.aspect].every(Number.isFinite) ||
        state.aspect <= 0
      )
        throw new Error('Book state must have a page and finite progress');
      opening.root.visible = state.open < 1;
      turn.root.visible = !opening.root.visible;
      if (opening.root.visible) opening.render(state.open, state.aspect);
      else turn.render(state.turn, state.aspect);
      view.invalidate();
    },
    pagesChanged: turn.pagesChanged,
    dispose: view.dispose,
  };
}
