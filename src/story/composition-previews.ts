import type { ChapterFrame, SceneChapter } from './composition.js';
import type { MountedChapter } from './composition-presentations.js';
import { activeCue } from './cues.js';
import type { ControlValue } from '../controls/fields.js';

/** Freeze only the two sides of the requested boundary, independently of live GPU owners. */
export function chapterPreviews(
  chapters: readonly SceneChapter[],
  parent: HTMLElement,
  defaults: Record<string, ControlValue>,
  get: (index: number) => MountedChapter | undefined,
  restore: () => void,
  captureAspect?: number,
) {
  const images: {
    start?: HTMLCanvasElement;
    end?: HTMLCanvasElement;
    surface?: HTMLCanvasElement;
  }[] = chapters.map(() => ({}));
  let signature = '',
    revision = 0,
    disposed = false;
  let ready: { index: number; revision: number } | undefined;
  const retained = new Set<number>();
  function clear() {
    for (const index of retained) {
      delete images[index]!.start;
      delete images[index]!.end;
      delete images[index]!.surface;
    }
    retained.clear();
    ready = undefined;
  }
  function refresh() {
    if (disposed) return false;
    const box = parent.getBoundingClientRect(),
      style = getComputedStyle(parent);
    const key = JSON.stringify([
      box.width,
      box.height,
      style.colorScheme,
      Array.from(style)
        .filter((name) => name.startsWith('--ve-'))
        .map((name) => [name, style.getPropertyValue(name)]),
    ]);
    if (key === signature) return false;
    signature = key;
    revision++;
    clear();
    return true;
  }
  refresh();
  return {
    images,
    refresh,
    has(index: number) {
      return ready?.index === index && ready.revision === revision;
    },
    async prepare(index: number, signal: AbortSignal) {
      const version = revision;
      const pending: {
        index: number;
        key: 'start' | 'end' | 'surface';
        image: Promise<HTMLCanvasElement | undefined>;
      }[] = [];
      try {
        for (const id of index ? [index - 1, index] : [index]) {
          signal.throwIfAborted();
          const chapter = chapters[id]!,
            { element, drawing } = get(id)!;
          const end = id !== index;
          const frame: ChapterFrame = {
            time: end ? chapter.seconds : 0,
            progress: Number(end),
            reduced: false,
            mode: 'story',
            values: defaults,
            beat: activeCue(chapter.script, end ? chapter.seconds : 0),
          };
          frame.values = { ...defaults, ...chapter.valuesAt?.(frame) };
          const hidden = element.hidden;
          element.hidden = false;
          try {
            drawing.render(frame);
            pending.push({
              index: id,
              key: end ? 'end' : 'start',
              image: Promise.resolve(drawing.capture?.()),
            });
            if (!end && captureAspect)
              pending.push({
                index: id,
                key: 'surface',
                image: Promise.resolve(drawing.capture?.({ aspect: captureAspect })),
              });
          } finally {
            element.hidden = hidden;
          }
        }
      } catch (cause) {
        void Promise.allSettled(pending.map((item) => item.image));
        throw cause;
      } finally {
        restore();
      }
      const captures = await Promise.all(pending.map((item) => item.image));
      signal.throwIfAborted();
      if (disposed || version !== revision) return;
      clear();
      for (const [offset, item] of pending.entries()) {
        images[item.index]![item.key] = captures[offset];
        retained.add(item.index);
      }
      ready = { index, revision };
    },
    dispose() {
      disposed = true;
      revision++;
      clear();
    },
  };
}
