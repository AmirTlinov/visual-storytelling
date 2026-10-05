import { fitFrame } from '../scene-frame.js';
import { bookTransition } from './transition.js';
import { bookTiming, bookOpening } from './timing.js';
import type { ChapterTransition } from '../story/composition.js';

/** The notebook opens on a desk, then yields its entire frame to the existing chapter. */
export function bookChapters(topic: string): ChapterTransition {
  return {
    introduction: {
      seconds: bookTiming.introduction,
      id: 'book-open',
      title: `Tlinov · ${topic}`,
      text: 'Раскроем тетрадь и заглянем в записи.',
    },
    duration: bookTiming.turn,
    mount(parent, previews) {
      const page = () => document.createElement('canvas');
      const current = page(),
        previous = page(),
        overlay = document.createElement('div');
      Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      overlay.setAttribute('aria-hidden', 'true');
      overlay.dataset.bookTransition = '';
      parent.append(overlay);
      const drawing = bookTransition(overlay, { topic, current, previous });
      let currentSource: HTMLCanvasElement | undefined,
        previousSource: HTMLCanvasElement | undefined,
        imageAspect = 0;
      const copy = (canvas: HTMLCanvasElement, aspect: number, source?: HTMLCanvasElement) => {
        const c = canvas.getContext('2d')!;
        canvas.width = 1440;
        canvas.height = Math.round(1440 / aspect);
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
          const opening = state.open < 1;
          overlay.dataset.bookPhase = opening ? 'opening' : 'turn';
          overlay.style.background = opening ? 'var(--ve-surface)' : 'transparent';
          // Reveal the chapter only after the camera has entered the paper and its edges are gone.
          overlay.style.opacity = String(opening ? 1 - bookOpening(state.open).reveal : 1);
          const aspect = (parent.clientWidth || 960) / (parent.clientHeight || 640);
          if (!opening) {
            const next = previews[state.chapter]?.start,
              before = previews[state.chapter - 1]?.end;
            const resized = imageAspect !== aspect;
            const changed = currentSource !== next || previousSource !== before || resized;
            if (currentSource !== next || resized) {
              currentSource = next;
              copy(current, aspect, next);
            }
            if (previousSource !== before || resized) {
              previousSource = before;
              copy(previous, aspect, before);
            }
            if (changed) {
              imageAspect = aspect;
              drawing.pagesChanged();
            }
          }
          drawing.render({
            page: state.chapter,
            open: state.open,
            turn: state.progress,
            aspect,
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
