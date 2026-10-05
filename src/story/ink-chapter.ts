import { surface, type Surface, type Grid } from '../ink/surface.js';
import type { SceneChapter, ChapterFrame } from './composition.js';
import type { ChapterTiming } from './composition-plan.js';
import { snapshotSVG } from '../export/index.js';

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
      grid?: Grid | false;
      create(view: Surface): InkDrawing | Promise<InkDrawing>;
    },
): SceneChapter {
  return {
    ...options,
    async mount(parent) {
      const view = surface(parent, {
        id: `chapter-${++instance}`,
        title: options.title,
        description: options.text,
        width: options.size?.width ?? 960,
        height: options.size?.height ?? 640,
        grid: options.grid,
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
        if (options.size) view.fitViewport(box.width || 960, box.height || 640);
        else view.resize(size.width, size.height);
        drawing.render(frame, size);
      };
      const observer = new ResizeObserver(() => {
        if (latest && parent.checkVisibility()) render(latest);
      });
      observer.observe(parent.closest('.ve-frame') ?? parent);
      return {
        render,
        snapshot: () => drawing.snapshot?.(),
        capture(viewport) {
          if (!viewport) return snapshotSVG(view.element);
          return view.withViewport(viewport.aspect, () => snapshotSVG(view.element));
        },
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
