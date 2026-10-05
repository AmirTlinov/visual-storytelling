import { fitFrame } from '../scene-frame.js';
import { bookTransition } from './transition.js';
import { bookTiming, bookBoundary } from './timing.js';
import type { NotebookSource } from './opening.js';
import type { ChapterTransition } from '../story/composition.js';
import { notebookPageAspect } from '../characters/staging/notebook.js';

/** Establish a world, enter its notebook, then turn full-frame pages. Exploration uses live chapters. */
export function bookChapters(
  topic: string,
  worlds: readonly boolean[],
  entry: (index: number) => NotebookSource | undefined,
): ChapterTransition {
  return {
    captureAspect: notebookPageAspect,
    introduction: worlds[0]
      ? undefined
      : {
          seconds: bookTiming.introduction,
          id: 'book-open',
          title: `Tlinov · ${topic}`,
          text: 'Из исторической мастерской — к записям в тетради.',
        },
    duration: (index) => bookBoundary(Boolean(worlds[index - 1]), Boolean(worlds[index])),
    mount(parent, previews) {
      const current = document.createElement('canvas'),
        previous = document.createElement('canvas'),
        overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background: 'var(--ve-surface)',
      });
      overlay.setAttribute('aria-hidden', 'true');
      overlay.dataset.bookTransition = '';
      parent.append(overlay);
      const drawing = bookTransition(overlay, { topic, current, previous });
      let currentSource: HTMLCanvasElement | undefined,
        previousSource: HTMLCanvasElement | undefined,
        imageAspect = 0;
      const copy = (canvas: HTMLCanvasElement, aspect: number, source?: HTMLCanvasElement) => {
        canvas.width = 1440;
        canvas.height = Math.round(1440 / aspect);
        const c = canvas.getContext('2d')!;
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
          const introduction = state.open < 1;
          overlay.hidden = state.reduced || (!introduction && state.progress >= 1);
          if (overlay.hidden) return;
          const source = entry(state.chapter),
            progress = introduction ? state.open : state.progress;
          overlay.dataset.bookPhase = source ? 'enter' : 'turn';
          const aspect = (parent.clientWidth || 960) / (parent.clientHeight || 640);
          const next = previews[state.chapter]?.start,
            before = previews[state.chapter - 1]?.end;
          const resized = aspect !== imageAspect,
            changed = currentSource !== next || previousSource !== before || resized;
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
          drawing.render(progress, aspect, source, previews[state.chapter]?.surface ?? current);
        },
        dispose() {
          drawing.dispose();
          overlay.remove();
        },
      };
    },
  };
}
