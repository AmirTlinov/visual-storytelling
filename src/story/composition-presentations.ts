import type { ChapterPresentation, SceneChapter, ChapterTransition } from './composition.js';
import { sourceAt, sourceOf } from '../scene-source.js';
import { releaseResources } from '../lifecycle.js';

export interface MountedChapter {
  element: HTMLDivElement;
  drawing: ChapterPresentation;
  effect?: { element: HTMLDivElement; drawing: ReturnType<ChapterTransition['mount']> };
}

/** A story keeps its live chapter and one recent neighbour; resource preparation is serial. */
export function chapterPresentations(chapters: readonly SceneChapter[], parent: HTMLElement) {
  const mounted = new Map<number, MountedChapter>();
  const lifetime = new AbortController();
  let current: number | undefined,
    recent: number | undefined,
    disposed = false;
  let queue: Promise<void> = Promise.resolve();
  function remove(index: number) {
    const item = mounted.get(index);
    if (!item) return;
    mounted.delete(index);
    releaseResources(
      [
        () => item.effect?.drawing.dispose(),
        () => item.drawing.dispose(),
        () => {
          sourceAt(item.element, undefined);
          item.element.remove();
        },
      ],
      'Chapter presentation release failed.',
    );
  }
  function retain(indices: readonly number[]) {
    releaseResources(
      [...mounted.keys()]
        .filter((index) => !indices.includes(index))
        .map((index) => () => remove(index)),
      'Chapter resource release failed.',
    );
  }
  async function load(index: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (mounted.has(index)) return;
    const element = document.createElement('div');
    sourceAt(element, sourceOf(chapters[index]));
    element.dataset.chapter = chapters[index]!.id;
    element.dataset.chapterPending = '';
    element.inert = true;
    // Conceal paint without changing authored visibility or SVG geometry during preparation.
    Object.assign(element.style, { position: 'absolute', inset: '0', clipPath: 'inset(100%)' });
    parent.prepend(element);
    try {
      const drawing = await chapters[index]!.mount(element, signal);
      if (disposed || signal.aborted) {
        drawing.dispose();
        signal.throwIfAborted();
        throw new Error('Story presentations have been disposed');
      }
      element.hidden = true;
      delete element.dataset.chapterPending;
      element.style.removeProperty('clip-path');
      mounted.set(index, { element, drawing });
    } catch (cause) {
      sourceAt(element, undefined);
      element.remove();
      throw cause;
    }
  }
  return {
    prepareTransition(
      index: number,
      transition: ChapterTransition,
      images: Parameters<ChapterTransition['mount']>[1],
      state: Parameters<ReturnType<ChapterTransition['mount']>['render']>[0],
    ) {
      const item = mounted.get(index)!;
      if (!item.effect) {
        const element = document.createElement('div');
        Object.assign(element.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
        item.element.append(element);
        try {
          item.effect = { element, drawing: transition.mount(element, images) };
        } catch (error) {
          element.remove();
          throw error;
        }
      }
      item.effect.drawing.render(state);
    },
    renderTransition(
      index: number,
      state: Parameters<ReturnType<ChapterTransition['mount']>['render']>[0],
    ) {
      mounted.get(index)?.effect?.drawing.render(state);
    },
    get(index: number) {
      return mounted.get(index);
    },
    get active() {
      return current === undefined ? undefined : mounted.get(current);
    },
    prepare(indices: readonly number[], signal: AbortSignal, capture?: () => Promise<void>) {
      signal = AbortSignal.any([signal, lifetime.signal]);
      const work = queue
        .catch(() => {})
        .then(async () => {
          signal.throwIfAborted();
          if (disposed) throw new Error('Story presentations have been disposed');
          retain(current === undefined ? indices : [current, ...indices]);
          try {
            for (const index of indices) await load(index, signal);
            await capture?.();
            signal.throwIfAborted();
          } catch (cause) {
            releaseResources(
              [
                () => {
                  throw cause;
                },
                () => retain(current === undefined ? [] : [current]),
              ],
              'Chapter preparation failed.',
            );
          } finally {
            if (disposed || signal.aborted) retain(current === undefined ? [] : [current]);
          }
        });
      queue = work;
      return work;
    },
    show(index: number) {
      const item = mounted.get(index);
      if (!item) throw new Error(`Chapter ${chapters[index]!.id} is not prepared`);
      if (current !== index) {
        recent = current;
        current = index;
      }
      for (const [id, entry] of mounted) {
        entry.element.hidden = id !== index;
        entry.element.inert = id !== index;
      }
      try {
        retain(recent === undefined ? [index] : [index, recent]);
      } catch (error) {
        // Resource disposal follows a successful publication and cannot undo its frame.
        console.warn('Previous chapter cleanup failed.', error);
      }
      return item;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      current = undefined;
      retain([]);
    },
  };
}
