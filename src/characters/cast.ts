import { releaseResources } from '../lifecycle.js';
import { performance, type CharacterPerformance } from './performance.js';
import { characterDetails } from './framing.js';
import { contactRig } from './staging/ik.js';
import type { CharacterData } from './rig.js';
import type { CharacterScore } from './score.js';
import type { CharacterStageOptions, Point } from './types.js';
import type { ChapterFrame } from '../story/composition.js';

/** One cast owns its rigs; a flat scientific scene can supply absolute model poses. */
export function characterCast(
  data: CharacterData,
  options: CharacterStageOptions,
  score: CharacterScore,
  point: (at: CharacterStageOptions['cast'][string]['at']) => Point,
) {
  const actors: Record<string, CharacterPerformance> = {};
  const contacts: Record<string, ReturnType<typeof contactRig>> = {};
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    releaseResources(
      [
        ...Object.values(contacts).map((rig) => rig.dispose),
        ...Object.values(actors).map((a) => a.dispose),
      ],
      'Character cast disposal failed.',
    );
  };
  try {
    if (options.pose && options.set.staging)
      throw new Error('Prepared staging owns cast poses; model poses belong to a flat stage.');
    for (const [id, actor] of Object.entries(options.cast)) {
      const perf = performance(
        data,
        options.pack,
        actor,
        score.tracks[id]!,
        point(actor.at),
        options.set.height,
        options.blend,
      );
      actors[id] = perf;
      if (options.pose && options.pack.rig) {
        const chains = Object.fromEntries(
          Object.entries(options.pack.rig.arms).map(([side, arm]) => [
            side,
            {
              upper: perf.bones.get(arm.upper)!,
              lower: perf.bones.get(arm.lower)!,
            },
          ]),
        );
        contacts[id] = contactRig(perf, chains, options.set.height);
      }
    }
    return {
      actors,
      sample(
        time: number,
        reduced: boolean,
        frame?: ChapterFrame,
        staged?: () => Record<string, string>,
      ) {
        const reached: Record<string, { hand: string; at: Point; target: Point; error: number }[]> =
          {};
        const actions = staged
          ? staged()
          : Object.fromEntries(
              Object.entries(actors).map(([id, actor]) => {
                const pose = options.pose?.(id, time, reduced, frame);
                if (
                  pose &&
                  (![pose.at.x, pose.at.y, pose.scale, pose.rotation ?? 0].every(Number.isFinite) ||
                    pose.scale <= 0)
                )
                  throw new Error(
                    'A model character pose needs finite coordinates and positive scale.',
                  );
                const action = actor.sample(time, reduced, pose);
                for (const reach of pose?.reach ?? []) {
                  if (!contacts[id]) throw new Error('Model contacts need a biped rig.');
                  if (
                    ![reach.at.x, reach.at.y, reach.weight ?? 1].every(Number.isFinite) ||
                    (reach.weight ?? 1) < 0 ||
                    (reach.weight ?? 1) > 1
                  )
                    throw new Error(
                      'A model contact needs finite coordinates and weight from 0 to 1.',
                    );
                  contacts[id]!.solve(reach.hand, reach.at, reach.weight ?? 1);
                  const at = contacts[id]!.point(reach.hand);
                  (reached[id] ??= []).push({
                    hand: reach.hand,
                    at,
                    target: reach.at,
                    error: Math.hypot(at.x - reach.at.x, at.y - reach.at.y),
                  });
                }
                return [id, action];
              }),
            );
        return {
          actions,
          contacts: reached,
          actorBounds: Object.fromEntries(
            Object.entries(actors).map(([id, actor]) => [id, actor.bounds()]),
          ),
          details: Object.fromEntries(
            Object.entries(actors).flatMap(([id, actor]) =>
              Object.entries(characterDetails(actor, options.pack.rig, options.set.height)).map(
                ([part, box]) => [`${id}.${part}`, box],
              ),
            ),
          ),
        };
      },
      dispose,
    };
  } catch (cause) {
    releaseResources(
      [
        () => {
          throw cause;
        },
        dispose,
      ],
      'Character cast preparation failed.',
    );
    throw cause;
  }
}
