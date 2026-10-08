import type { SceneChapter } from '../story/composition.js';
import type { CharacterStageOptions } from './types.js';
import { compileScore } from './score.js';
import { characterStage } from './stage.js';

/** A full character performance is one optional presentation in an ordinary SceneStory. */
export function characterChapter(
  options: CharacterStageOptions &
    Pick<SceneChapter, 'id' | 'title' | 'controls' | 'valuesAt'> & {
      text?: string;
      seconds?: number;
    },
): SceneChapter {
  const score = compileScore(options);
  if (options.seconds !== undefined && Math.abs(options.seconds - score.script.duration) > 1e-6)
    throw new Error(`Character chapter ${options.id}: seconds must match its script`);
  return {
    id: options.id,
    title: options.title,
    text: options.text ?? options.beats.map((beat) => beat.text).join('\n\n'),
    seconds: score.script.duration,
    script: score.script,
    controls: options.controls,
    valuesAt: options.valuesAt,
    async mount(parent) {
      const stage = await characterStage(parent, options, score);
      return {
        render: (frame) => stage.render(frame.time, frame.reduced, frame),
        snapshot: stage.snapshot,
        capture: () => stage.capture(),
        view: stage.view,
        dispose: stage.dispose,
      };
    },
  };
}
