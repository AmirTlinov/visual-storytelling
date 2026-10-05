import type { ChapterPresentation, SceneChapter } from './composition.js';

export interface MountedChapter {
  element: HTMLDivElement;
  drawing: ChapterPresentation;
}

/** A story keeps its live chapter and one recent neighbour; resource preparation is serial. */
export function chapterPresentations(chapters: readonly SceneChapter[], parent: HTMLElement) {
  const mounted = new Map<number, MountedChapter>();
  let current: number | undefined,
    recent: number | undefined,
    disposed = false;
  let queue: Promise<void> = Promise.resolve();
  function remove(index: number) {
    const item = mounted.get(index);
    if (!item) return;
    mounted.delete(index);
    try {
      item.drawing.dispose();
    } finally {
      item.element.remove();
    }
  }
  function retain(indices: readonly number[]) {
    for (const index of mounted.keys()) if (!indices.includes(index)) remove(index);
  }
  async function load(index: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (mounted.has(index)) return;
    const element = document.createElement('div');
    element.dataset.chapter = chapters[index]!.id;
    element.inert = true;
    // Hidden visibility keeps the actual viewport dimensions available during mount/capture.
    Object.assign(element.style, { position: 'absolute', inset: '0', visibility: 'hidden' });
    parent.prepend(element);
    try {
      const drawing = await chapters[index]!.mount(element);
      if (disposed || signal.aborted) {
        drawing.dispose();
        signal.throwIfAborted();
        throw new Error('Story presentations have been disposed');
      }
      element.hidden = true;
      element.style.removeProperty('visibility');
      mounted.set(index, { element, drawing });
    } catch (cause) {
      element.remove();
      throw cause;
    }
  }
  return {
    get(index: number) {
      return mounted.get(index);
    },
    get active() {
      return current === undefined ? undefined : mounted.get(current);
    },
    prepare(indices: readonly number[], signal: AbortSignal, capture?: () => Promise<void>) {
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
      retain(recent === undefined ? [index] : [index, recent]);
      return item;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current = undefined;
      retain([]);
    },
  };
}
