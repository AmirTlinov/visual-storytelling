import { activeCue } from './cues.js';
import type { ControlValue } from '../controls/fields.js';
import type { SceneChapter, ChapterPresentation, ChapterFrame } from './composition.js';

export interface MountedChapter {
  element: HTMLDivElement;
  drawing: ChapterPresentation;
}

/** Boundary images use the live presentation once; capture must freeze its inputs before awaiting. */
export function chapterPreviews(
  chapters: readonly SceneChapter[],
  mounted: readonly MountedChapter[],
  parent: HTMLElement,
  defaults: Readonly<Record<string, ControlValue>>,
  restore: () => void,
  publish: () => void,
  captureAspect?: number,
) {
  const images: {
    start?: HTMLCanvasElement;
    end?: HTMLCanvasElement;
    surface?: HTMLCanvasElement;
  }[] = chapters.map(() => ({}));
  let disposed = false,
    generation = 0,
    signature = '',
    pending: Promise<void> = Promise.resolve();
  const refresh = () => {
    if (disposed) return Promise.resolve();
    const style = getComputedStyle(parent),
      box = parent.getBoundingClientRect();
    const key = JSON.stringify([
      box.width,
      box.height,
      style.colorScheme,
      ...[...style]
        .filter((name) => name.startsWith('--ve-'))
        .map((name) => [name, style.getPropertyValue(name)]),
    ]);
    if (key === signature) return pending;
    signature = key;
    const revision = ++generation,
      captures: {
        index: number;
        key: 'start' | 'end' | 'surface';
        image: Promise<HTMLCanvasElement | undefined>;
      }[] = [];
    try {
      for (const [index, chapter] of chapters.entries()) {
        const { element, drawing } = mounted[index]!;
        element.hidden = false;
        try {
          for (const end of [false, true]) {
            const frame: ChapterFrame = {
              time: end ? chapter.seconds : 0,
              progress: Number(end),
              reduced: false,
              mode: 'story',
              values: defaults,
              beat: activeCue(chapter.script, end ? chapter.seconds : 0),
            };
            frame.values = { ...defaults, ...chapter.valuesAt?.(frame) };
            drawing.render(frame);
            captures.push({
              index,
              key: end ? 'end' : 'start',
              image: Promise.resolve(drawing.capture?.()),
            });
            if (!end && captureAspect)
              captures.push({
                index,
                key: 'surface',
                image: Promise.resolve(drawing.capture?.({ aspect: captureAspect })),
              });
          }
        } finally {
          element.hidden = true;
        }
      }
    } catch (error) {
      void Promise.allSettled(captures.map((c) => c.image));
      signature = '';
      throw error;
    } finally {
      restore();
    }
    pending = Promise.all(captures.map((c) => c.image)).then(
      (result) => {
        if (disposed || revision !== generation) return;
        for (const [i, capture] of captures.entries())
          images[capture.index]![capture.key] = result[i];
        publish();
      },
      (error) => {
        if (revision === generation) signature = '';
        throw error;
      },
    );
    return pending;
  };
  return {
    images,
    refresh,
    dispose() {
      disposed = true;
      generation++;
      images.length = 0;
    },
  };
}
