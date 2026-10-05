import { Viewport3D } from '../viewport/three.js';
import { Vector3 } from '../viewport/engine.js';
import { theme } from '../ink/palette.js';
import type { Quad } from '../ink/projective.js';
import type { characterStage } from '../characters/stage.js';
import { notebookPageAspect } from '../characters/staging/notebook.js';
import { notebookOpening } from './opening.js';
import { notebookSource } from './world.js';

export interface NotebookPresentationOptions {
  source: Awaited<ReturnType<typeof characterStage>>;
  book: string;
  topic: string;
}

/** Enter the existing live page with the host's progress; no player or second drawing model. */
async function mount(parent: HTMLElement, options: NotebookPresentationOptions) {
  const source = await notebookSource(options.source, options.book);
  const root = document.createElement('div');
  root.dataset.notebookPresentation = '';
  root.dataset.paper = 'false';
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    padding: '0',
    margin: '0',
    maxWidth: 'none',
  });
  const colors = theme(root, 'inherit');
  const world = document.createElement('div');
  Object.assign(world.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  root.append(world);
  parent.append(root);
  let mounted: ReturnType<typeof Viewport3D.mount> | undefined;
  try {
    const view = Viewport3D.mount(world, { label: `Tlinov · ${options.topic}` });
    mounted = view;
    view.controls.enabled = false;
    view.renderer.domElement.tabIndex = -1;
    view.renderer.domElement.style.cssText = 'width:100%;height:100%;pointer-events:none';
    const opening = notebookOpening(view, options.topic);
    view.setObject(opening.root, { fitView: false });
    root.hidden = true;
    let drawing: ReturnType<typeof options.source.presentSurface> | undefined;
    let progress = 0,
      disposed = false,
      quad: Quad | undefined;
    let model: ReturnType<typeof opening.render> | undefined;
    const layout = () => {
      if (!drawing || root.hidden) return;
      const width = root.clientWidth,
        height = root.clientHeight;
      if (!width || !height) return;
      if (progress < 1 && (!model || model.open < 0.55)) {
        quad = undefined;
        drawing.project(undefined);
        return;
      }
      if (progress === 1) {
        quad = [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ];
        drawing.project(quad, width / height);
      } else {
        quad = model!.content(notebookPageAspect).map((point) => {
          const p = new Vector3(point.x, point.height ?? 0, -point.z).project(view.camera);
          return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
        }) as unknown as Quad;
        drawing.project(quad, notebookPageAspect);
      }
    };
    view.onRender(layout);
    const hide = () => {
      drawing?.release();
      drawing = undefined;
      root.hidden = true;
      quad = undefined;
    };
    return {
      /** Render the source stage first, then this presentation, using the same external frame. */
      render(value: number, reduced = false) {
        if (disposed) throw new Error('Notebook presentation has been disposed');
        if (!Number.isFinite(value)) throw new Error('Notebook progress must be finite');
        progress = reduced ? 1 : Math.max(0, Math.min(1, value));
        if (!drawing) {
          drawing = options.source.presentSurface(options.book, root);
          drawing.theme('inherit');
        }
        root.hidden = false;
        // The opaque physical page gives way to the host's transparent working surface.
        const background = progress < 1 ? 'var(--ve-surface)' : 'transparent';
        if (root.style.background !== background) root.style.background = background;
        const opacity = String(1 - Math.max(0, (progress - 0.94) / 0.06));
        if (world.style.opacity !== opacity) world.style.opacity = opacity;
        if (progress < 1) {
          const size = drawing.size;
          model = opening.render(progress, source, { liveAspect: size.width / size.height });
          view.invalidate();
        }
        layout();
      },
      hide,
      snapshot: () => ({ visible: !root.hidden, progress, quad, content: drawing?.snapshot() }),
      dispose() {
        if (disposed) return;
        disposed = true;
        hide();
        view.dispose();
        colors.dispose();
        root.remove();
      },
    };
  } catch (error) {
    mounted?.dispose();
    colors.dispose();
    root.remove();
    throw error;
  }
}

export const NotebookPresentation = { mount };
