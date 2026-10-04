import { fitFrame } from '../scene-frame.js';
import { bookTransition } from './transition.js';
import { bookSize } from './geometry.js';
import { bookTiming } from './timing.js';
import type { ChapterTransition } from '../story/composition.js';

/** The book is optional scenery over existing chapter presentations. */
export function bookChapters(topic: string): ChapterTransition {
  return {
    introduction: {
      seconds: bookTiming.introduction,
      id: 'book-open',
      title: `Tlinov · ${topic}`,
      text: 'Открывается тайная книга.',
    },
    duration: bookTiming.turn,
    mount(parent, previews) {
      const page = () => {
        const canvas = document.createElement('canvas');
        canvas.width = bookSize.width * bookSize.pixelsPerUnit;
        canvas.height = bookSize.height * bookSize.pixelsPerUnit;
        return canvas;
      };
      const current = page(),
        previous = page(),
        overlay = document.createElement('div');
      Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      overlay.setAttribute('aria-hidden', 'true');
      parent.append(overlay);
      const drawing = bookTransition(overlay, { topic, current, previous });
      let currentSource: HTMLCanvasElement | undefined,
        previousSource: HTMLCanvasElement | undefined;
      const copy = (canvas: HTMLCanvasElement, source?: HTMLCanvasElement) => {
        const c = canvas.getContext('2d')!;
        c.reset();
        if (source) {
          const box = fitFrame(source.width, source.height, canvas.width, canvas.height);
          c.drawImage(
            source,
            (canvas.width - box.width) / 2,
            (canvas.height - box.height) / 2,
            box.width,
            box.height,
          );
        }
      };
      return {
        render(state) {
          overlay.hidden = state.reduced || (state.open >= 1 && state.progress >= 1);
          if (overlay.hidden) return;
          const next = previews[state.chapter]?.start,
            before = previews[state.chapter - 1]?.end;
          const changed = currentSource !== next || previousSource !== before;
          if (currentSource !== next) {
            currentSource = next;
            copy(current, next);
          }
          if (previousSource !== before) {
            previousSource = before;
            copy(previous, before);
          }
          if (changed) drawing.pagesChanged();
          drawing.render({
            page: state.chapter,
            reduced: state.reduced,
            open: Math.max(0, Math.min(1, (state.open * bookTiming.introduction - 0.4) / 1.8)),
            focus: Math.max(0, Math.min(1, (state.open * bookTiming.introduction - 2.2) / 2)),
            turn: state.progress,
          });
        },
        dispose() {
          drawing.dispose();
          overlay.remove();
        },
      };
    },
  };
}
