import type { ChapterFrame, SceneChapter } from './composition.js';
import type { MountedChapter } from './composition-presentations.js';
import { activeCue } from './cues.js';
import type { ControlValue } from '../controls/fields.js';
import { freezePresentation } from './frozen-presentation.js';
import { releaseResources } from '../lifecycle.js';

/** Freeze only the two sides of the requested boundary, independently of live GPU owners. */
export function chapterPreviews(
  chapters: readonly SceneChapter[],
  parent: HTMLElement,
  defaults: Record<string, ControlValue>,
  get: (index: number) => MountedChapter | undefined,
  restore: () => void | Promise<unknown>,
  captureAspect?: number,
  subjectAt?: (frame: ChapterFrame) => unknown,
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
  let fallback: (() => void)[] = [];
  const lifetime = new AbortController(),
    running = new Set<(() => void)[]>();
  function releaseFallback() {
    const previous = fallback;
    fallback = [];
    releaseResources(previous.reverse(), 'Accepted preview fallback release failed.');
  }
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
    get frozen() {
      return fallback.length > 0;
    },
    accept: releaseFallback,
    has(index: number) {
      return ready?.index === index && ready.revision === revision;
    },
    async prepare(index: number, signal: AbortSignal) {
      signal = AbortSignal.any([signal, lifetime.signal]);
      const version = revision;
      const pending: {
        index: number;
        key: 'start' | 'end' | 'surface';
        image: Promise<HTMLCanvasElement | undefined>;
      }[] = [];
      const releases: (() => void)[] = [];
      running.add(releases);
      const failures: unknown[] = [];
      try {
        for (const id of index ? [index - 1, index] : [index]) {
          signal.throwIfAborted();
          const chapter = chapters[id]!,
            mounted = get(id)!,
            { element, drawing } = mounted;
          if (!drawing.capture) continue;
          releases.push(await freezePresentation(mounted, signal));
          signal.throwIfAborted();
          const end = id !== index;
          const frame: ChapterFrame = {
            chapter: chapter.id,
            time: end ? chapter.seconds : 0,
            progress: Number(end),
            reduced: false,
            mode: 'story',
            values: defaults,
            beat: activeCue(chapter.script, end ? chapter.seconds : 0),
          };
          frame.values = { ...defaults, ...chapter.valuesAt?.(frame) };
          frame.subject = subjectAt?.(frame);
          const hidden = element.hidden;
          const clip = element.style.clipPath;
          const pendingAttribute = element.getAttribute('data-presentation-pending');
          element.dataset.presentationPending = '';
          element.style.clipPath = 'inset(100%)';
          element.hidden = false;
          releases.push(() => {
            element.hidden = hidden;
            if (clip) element.style.clipPath = clip;
            else element.style.removeProperty('clip-path');
            if (pendingAttribute === null) delete element.dataset.presentationPending;
            else element.setAttribute('data-presentation-pending', pendingAttribute);
          });
          drawing.render(frame);
          await drawing.ready?.(signal);
          signal.throwIfAborted();
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
        }
      } catch (cause) {
        void Promise.allSettled(pending.map((item) => item.image));
        failures.push(cause);
      } finally {
        let restored = disposed;
        try {
          if (!disposed) await restore();
          restored = true;
        } catch (cause) {
          failures.push(cause);
        }
        if (restored) {
          try {
            releaseResources(releases.splice(0).reverse(), 'Boundary preview release failed.');
            releaseFallback();
          } catch (cause) {
            failures.push(cause);
          }
        } else {
          fallback.push(...releases.splice(0));
        }
        running.delete(releases);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length)
        throw new AggregateError(failures, 'Boundary preview and restoration failed.');
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
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      revision++;
      clear();
      releaseResources(
        [
          releaseFallback,
          ...[...running].map(
            (releases) => () =>
              releaseResources(releases.splice(0).reverse(), 'Pending preview release failed.'),
          ),
        ],
        'Preview disposal failed.',
      );
    },
  };
}
