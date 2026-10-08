import { inkChapter } from '../story/ink-chapter.js';
import type { SceneChapter, ChapterFrame } from '../story/composition.js';
import type { ChapterTiming } from '../story/composition-plan.js';
import type { Surface } from '../ink/surface.js';
import { world2D, type World2D } from './world2d.js';
import { physicalInk } from './ink.js';
import { PhysicsReplay } from './replay.js';

/** A recorded physical experiment supplies its model; chapter lifecycle and replay stay shared. */
export function physicsChapter(
  options: ChapterTiming &
    Pick<SceneChapter, 'controls' | 'valuesAt'> & {
      width?: number;
      height?: number;
      scale?: number;
      setup(
        world: World2D,
        ink: ReturnType<typeof physicalInk>,
        view: Surface,
      ): {
        snapshot?(): unknown;
        render?(frame: ChapterFrame): void;
        dispose?(): void;
      } | void;
    },
): SceneChapter {
  return inkChapter({
    ...options,
    size: { width: options.width ?? 960, height: options.height ?? 640 },
    async create(view, signal) {
      signal.throwIfAborted();
      const world = await world2D();
      try {
        signal.throwIfAborted();
        const ink = physicalInk(world, view, { scale: options.scale ?? 100 });
        const content = options.setup(world, ink, view);
        view.grid({ step: (options.scale ?? 100) / 2 });
        const replay = PhysicsReplay.create(world, { duration: options.seconds });
        return {
          render(frame) {
            replay.seek(frame.time);
            content?.render?.(frame);
          },
          snapshot: () => ({ time: replay.currentTime, model: content?.snapshot?.() }),
          dispose() {
            try {
              content?.dispose?.();
            } finally {
              world.dispose();
            }
          },
        };
      } catch (error) {
        world.dispose();
        throw error;
      }
    },
  });
}
