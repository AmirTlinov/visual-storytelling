import type { Story, StoryMoment, StoryMode } from '../story/story.js';
import type { ControlValue } from '../controls/fields.js';
import type { SceneRendering } from '../scene-access.js';

/** Live capabilities forward to the accepted Story; the shell owns its controls and layout. */
export function controllerAccess<P, K extends string, S>(
  controller: Story<P, K, S>,
  {
    play,
    keys,
    mode,
  }: { play: () => Promise<void>; keys: readonly string[]; mode: (value: StoryMode) => StoryMode },
) {
  return {
    play,
    seek: controller.seek,
    ready: controller.ready,
    pause: controller.pause,
    get mute() {
      return controller.player.state.hasAudio ? controller.player.mute : undefined;
    },
    setRate: controller.player.rate,
    get muted() {
      const state = controller.player.state;
      return state.hasAudio ? state.muted : undefined;
    },
    get rate() {
      return controller.player.state.rate;
    },
    get speech() {
      return controller.player.state.speech;
    },
    review: controller.review,
    duration: controller.duration,
    get currentTime() {
      return controller.currentTime;
    },
    snapshot: () => controller.presented?.state,
    get condition() {
      return controller.condition;
    },
    subject: controller.subject,
    get rendering(): SceneRendering {
      const moment = (value: StoryMoment<P, S>) => ({
        time: value.time,
        chapter: value.chapter,
        mode: mode(value.mode),
        values: Object.fromEntries(
          keys.map((key) => [key, (value.values as Record<string, ControlValue>)[key]!]),
        ),
      });
      const requested = moment(controller.requested);
      return {
        phase: controller.phase,
        requested,
        presented:
          controller.presented === controller.requested
            ? requested
            : controller.presented && moment(controller.presented),
        error: controller.error && {
          stage: controller.error.stage,
          message:
            controller.error.cause instanceof Error
              ? controller.error.cause.message
              : String(controller.error.cause),
        },
      };
    },
    setReduced: controller.setReduced,
  };
}
