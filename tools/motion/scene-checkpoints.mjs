import { storyEpisodes, selectEpisode } from './episodes.mjs';

/** Authored checkpoints, not a playback cadence. Short --from sweeps retain their frame step. */
export function sceneCheckpoints({ review, duration, cue, from, seconds, frames = 12, fps = 60 }) {
  const episodes = review ? storyEpisodes(review) : [];
  const selected = cue ? selectEpisode(episodes, cue) : undefined;
  const lo = Math.max(0, selected ? selected.start - 0.15 : (from ?? 0));
  const hi = Math.min(
    duration,
    selected ? selected.end + 0.15 : seconds !== undefined ? lo + seconds : duration,
  );
  if (lo >= hi) throw new Error('Selected interval contains fewer than two frames');
  const times = new Set();
  const add = (t) => times.add(Math.min(hi, Math.max(lo, t)));
  const range = (a, b, count) => {
    for (let i = 0; i < count; i++) add(a + ((b - a) * i) / (count - 1));
  };
  if (from !== undefined && seconds === undefined && !selected) {
    range(lo, Math.min(hi, lo + (frames - 1) / fps), frames);
  } else {
    add(lo);
    add(hi);
    if (selected) range(selected.start, selected.end, frames);
    else if (episodes.length && from === undefined && seconds === undefined) {
      for (const e of episodes.filter((e) => e.kind === 'chapter')) range(e.start, e.end, 5);
    } else range(lo, hi, frames);
    for (const e of episodes) {
      if (e.end < lo || e.start > hi) continue;
      const start = Math.max(lo, e.start),
        end = Math.min(hi, e.end);
      add(start);
      add(end);
      // Boundaries alone can miss an entire action, including a short reveal and its result.
      if (e.kind === 'action') add((start + end) / 2);
      if (e.kind === 'chapter') {
        // Observe both sides of chapter cuts, including the gaps between narrated chapters.
        for (const boundary of [e.start, e.end]) {
          if (boundary < lo || boundary > hi) continue;
          add(boundary - 1 / 60);
          add(boundary + 1 / 60);
        }
      }
    }
  }
  return { times: [...times].sort((a, b) => a - b), selected };
}
