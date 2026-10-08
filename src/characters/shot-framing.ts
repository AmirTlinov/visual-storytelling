import type { Object3D } from 'three';
import type { CharacterScore } from './score.js';
import type { Beat } from './types.js';
import { characterPartNames } from './framing.js';
import { sameShot, union, type FrameBox } from './staging/camera.js';
import { durationOf } from './staging/timing.js';

/** A shot follows the ground root, while its measured pose envelope absorbs gait and breathing. */
export function shotFraming(
  beats: readonly Beat[],
  score: CharacterScore,
  actors: Record<string, { object: Object3D }>,
  height: number,
  sample: (time: number) => Record<string, FrameBox>,
) {
  const cache = new Map<number, Record<string, FrameBox>>();
  const owners = new Map(
    Object.keys(actors).flatMap((id) =>
      [id, ...characterPartNames.map((part) => `${id}.${part}`)].map(
        (subject) => [subject, id] as const,
      ),
    ),
  );
  const owner = (id: string) => owners.get(id);
  const root = (id: string) => {
    const object = actors[id]!.object;
    return {
      x: object.position.x,
      y: height - object.position.y,
      sx: Math.abs(object.scale.x),
      sy: Math.abs(object.scale.y),
    };
  };
  return {
    prepare(index: number, focus?: readonly string[]) {
      if (focus && !focus.some(owner)) return {};
      let first = index,
        last = index;
      while (first > 0 && sameShot(beats[first - 1]!.shot, beats[index]!.shot)) first--;
      while (last + 1 < beats.length && sameShot(beats[last + 1]!.shot, beats[index]!.shot)) last++;
      if (cache.has(first)) return cache.get(first)!;
      const times = new Set<number>();
      for (let i = first; i <= last; i++) {
        const cue = score.script.cues[beats[i]!.id]!;
        // Nonuniform samples include the ends without aliasing periodic footfalls.
        for (let step = 0; step <= 32; step++) {
          const progress = (1 - Math.cos((step * Math.PI) / 32)) / 2;
          times.add(cue.start + (cue.end - cue.start) * progress);
        }
      }
      const start = score.script.cues[beats[first]!.id]!.start,
        end = score.script.cues[beats[last]!.id]!.end;
      // A natural gesture may finish long before its narrated cue. Measure its
      // prepared phases too, using the same retimed interval as the action sampler.
      for (const plan of score.blocking?.plans ?? []) {
        if (plan.start < start || plan.start >= end) continue;
        const scale = (plan.end - plan.start) / durationOf(plan.timing);
        let elapsed = 0;
        for (const phase of ['rise', 'approach', 'engage', 'act', 'release'] as const) {
          const duration = plan.timing[phase];
          if (duration)
            for (const p of [0, 0.25, 0.5, 0.75, 1])
              times.add(plan.start + (elapsed + duration * p) * scale);
          elapsed += duration;
        }
      }
      const envelope: Record<string, FrameBox> = {};
      for (const time of [...times].sort((a, b) => a - b)) {
        const subjects = sample(time);
        for (const [id, box] of Object.entries(subjects)) {
          const actor = owner(id);
          if (!actor) continue;
          const r = root(actor);
          const normalized = {
            x: (box.x - r.x) / r.sx,
            y: (box.y - r.y) / r.sy,
            width: box.width / r.sx,
            height: box.height / r.sy,
          };
          envelope[id] = envelope[id] ? union([envelope[id], normalized]) : normalized;
        }
      }
      cache.set(first, envelope);
      return envelope;
    },
    subjects(actual: Record<string, FrameBox>, envelope: Record<string, FrameBox>) {
      return Object.fromEntries(
        Object.entries(actual).map(([id, box]) => {
          const stable = envelope[id],
            actor = owner(id);
          if (!stable || !actor) return [id, box];
          const r = root(actor);
          return [
            id,
            {
              x: r.x + stable.x * r.sx,
              y: r.y + stable.y * r.sy,
              width: stable.width * r.sx,
              height: stable.height * r.sy,
            },
          ];
        }),
      );
    },
  };
}
