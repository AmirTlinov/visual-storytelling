import { Viewport3D } from '../viewport/three.js';
import { Group } from '../viewport/engine.js';
import { notebookOpening, type NotebookSource } from './opening.js';
import { pageTurn } from './page-turn.js';

/** Both transitions consume the composition's clock and share one inspected renderer. */
export function bookTransition(
  parent: HTMLElement,
  options: { topic: string; current: HTMLCanvasElement; previous: HTMLCanvasElement },
) {
  const view = Viewport3D.mount(parent, { label: `Tlinov · ${options.topic}` });
  view.controls.enabled = false;
  view.renderer.domElement.tabIndex = -1;
  view.renderer.domElement.style.cssText = 'width:100%;height:100%;pointer-events:none';
  const opening = notebookOpening(view, options.topic),
    turn = pageTurn(view, options),
    root = new Group();
  root.add(opening.root, turn.root);
  view.setObject(root, { fitView: false });
  return {
    render(progress: number, aspect: number, source?: NotebookSource, paper = options.current) {
      opening.root.visible = Boolean(source);
      turn.root.visible = !source;
      if (source) opening.render(progress, source, paper);
      else turn.render(progress, aspect);
      view.invalidate();
    },
    pagesChanged: turn.pagesChanged,
    dispose() {
      view.dispose();
    },
  };
}
