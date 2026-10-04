import { surface, type Surface } from '../ink/surface.js';
import type { SceneChapter, ChapterFrame } from './composition.js';
import type { ChapterTiming } from './composition-plan.js';

export interface InkViewport {
  width: number;
  height: number;
}
export interface InkDrawing {
  render(frame: ChapterFrame, viewport: InkViewport): void;
  snapshot?(): unknown;
  dispose?(): void;
}
let instance = 0;
/** Existing Ink drawings keep their DOM, accessibility and inspection in any story chapter. */
export function inkChapter(
  options: ChapterTiming &
    Pick<SceneChapter, 'controls' | 'valuesAt'> & {
      size?: InkViewport;
      create(view: Surface): InkDrawing | Promise<InkDrawing>;
    },
): SceneChapter {
  return {
    ...options,
    async mount(parent) {
      const { snapshotSVG } = await import('../export/index.js');
      const view = surface(parent, {
        id: `chapter-${++instance}`,
        title: options.title,
        description: options.text,
        width: options.size?.width ?? 960,
        height: options.size?.height ?? 640,
        grid: false,
      });
      Object.assign(view.element.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
      });
      let drawing: InkDrawing;
      try {
        drawing = await options.create(view);
      } catch (error) {
        view.dispose();
        throw error;
      }
      let latest: ChapterFrame | undefined;
      const render = (frame: ChapterFrame) => {
        latest = frame;
        const box = parent.getBoundingClientRect();
        const size = options.size ?? { width: box.width || 960, height: box.height || 640 };
        const current = view.element.viewBox.baseVal;
        if (current.width !== size.width || current.height !== size.height)
          view.resize(size.width, size.height, false);
        drawing.render(frame, size);
      };
      const observer = new ResizeObserver(() => {
        if (latest && parent.checkVisibility()) render(latest);
      });
      observer.observe(parent.closest('.ve-frame') ?? parent);
      return {
        render,
        snapshot: () => drawing.snapshot?.(),
        capture: () => snapshotSVG(view.element),
        dispose() {
          observer.disconnect();
          try {
            drawing.dispose?.();
          } finally {
            view.dispose();
          }
        },
      };
    },
  };
}
