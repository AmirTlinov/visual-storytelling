import { story, type StoryOptions } from '../../src/story/story.js';

// Type-check the authoring boundary without mounting a browser story.
export function checkStoryTypes() {
  const script = { duration: 1, cues: {} };
  const stateAt = () => ({ x: 1 });
  story({ script, stateAt, render: (s) => void s.x.toFixed() });
  story({
    script,
    stateAt,
    derive: (p) => ({ z: p.x * 2 }),
    render: (s) => void s.z.toFixed(),
  });
  story({
    script,
    stateAt,
    // @ts-expect-error A different render state requires a derive function.
    render: (s: { z: number }) => void s.z.toFixed(),
  });
  // @ts-expect-error Explicit generic arguments cannot omit the conversion either.
  const invalid: StoryOptions<{ x: number }, string, { z: number }> = {
    script,
    stateAt,
    render: (s) => void s.z.toFixed(),
  };
  return invalid;
}
