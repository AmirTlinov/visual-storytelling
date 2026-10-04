import { cueSheet, type Script } from '../story/cues.js';
import type { CharacterStageOptions, Place, PropChange } from './types.js';
import { destination } from './staging/layout.js';
import { compileBlocking } from './staging/blocking.js';

export const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export interface ActionKey {
  start: number;
  action: string;
}
export interface PropKey {
  start: number;
  end: number;
  from: PropChange;
  to: PropChange;
  arc: number;
}

/** Compile a storyboard once; the existing Story owns validation, time and playback. */
export function compileScore(options: CharacterStageOptions) {
  const { pack, set, cast, beats } = options;
  const props = { ...set.props, ...options.props };
  const finite = (n: number) => Number.isFinite(n);
  if (![set.width, set.height].every((n) => finite(n) && n > 0))
    throw new Error('Invalid stage size');
  if (!beats.length || !Object.keys(cast).length)
    throw new Error('A character story needs a cast and beats');
  if (options.blend !== undefined && (!finite(options.blend) || options.blend < 0))
    throw new Error('Invalid pose blend');
  for (const [name, definition] of Object.entries(pack.actions)) {
    if (
      !definition.animation?.trim() ||
      (definition.pose !== undefined && (!finite(definition.pose) || definition.pose < 0))
    )
      throw new Error(`Invalid action: ${name}`);
  }
  for (const [name, anchor] of Object.entries(pack.anchors)) {
    if (!anchor.bone?.trim() || ![anchor.x, anchor.y].every(finite))
      throw new Error(`Invalid anchor: ${name}`);
  }
  function place(at: Place, actor = false) {
    if (typeof at === 'string') {
      if (!Object.hasOwn(set.spots, at)) throw new Error(`Unknown stage spot: ${at}`);
      place(set.spots[at]!, actor);
    } else if (!at || typeof at !== 'object') throw new Error('A stage position is required');
    else if ('actor' in at) {
      if (actor || !Object.hasOwn(cast, at.actor) || !Object.hasOwn(pack.anchors, at.anchor))
        throw new Error(`Unknown actor anchor: ${at.actor}.${at.anchor}`);
    } else if (![at.x, at.y].every(finite)) throw new Error('Stage coordinates must be finite');
  }
  const action = (name: string) => {
    if (!Object.hasOwn(pack.actions, name))
      throw new Error(
        `Unknown action "${name}" in ${pack.id}. Available: ${Object.keys(pack.actions).join(', ')}`,
      );
  };
  const tracks: Record<string, ActionKey[]> = Object.create(null);
  for (const [id, actor] of Object.entries(cast)) {
    if (!pack.skins.includes(actor.skin)) throw new Error(`Unknown skin: ${actor.skin}`);
    if (actor.scale !== undefined && (!finite(actor.scale) || actor.scale <= 0))
      throw new Error(`Invalid scale: ${id}`);
    if (set.staging) {
      if (typeof actor.at === 'object' && 'y' in actor.at)
        throw new Error('Prepared actors use ground coordinates');
      destination(set.staging, actor.at);
    } else {
      if (typeof actor.at === 'object' && !('y' in actor.at))
        throw new Error('Flat sets use screen coordinates');
      place(actor.at, true);
    }
    action(actor.action ?? 'idle');
    tracks[id] = [{ start: 0, action: actor.action ?? 'idle' }];
  }
  function propState(state: PropChange) {
    if (state.at !== undefined) place(state.at);
    if (
      state.opacity !== undefined &&
      (!finite(state.opacity) || state.opacity < 0 || state.opacity > 1)
    )
      throw new Error('Prop opacity must be in [0,1]');
    if (Object.values(state.values ?? {}).some((n) => !finite(n)))
      throw new Error('Prop channels must be finite');
    if (state.arc !== undefined && !finite(state.arc)) throw new Error('Prop arc must be finite');
  }
  const states: Record<string, PropChange> = Object.create(null);
  const propTracks: Record<string, PropKey[]> = Object.create(null);
  for (const [id, prop] of Object.entries(props)) {
    if (Object.hasOwn(cast, id)) throw new Error(`Actor and prop share an ID: ${id}`);
    if (prop.scale !== undefined && (!finite(prop.scale) || prop.scale <= 0))
      throw new Error(`Invalid prop scale: ${id}`);
    place(prop.at);
    propState(prop);
    states[id] = { at: prop.at, opacity: prop.opacity ?? 1, values: { ...prop.values } };
    propTracks[id] = [];
  }
  const ids = new Set<string>();
  for (const beat of beats) {
    if (!beat.id.trim() || ids.has(beat.id)) throw new Error(`Duplicate or empty beat: ${beat.id}`);
    if (beat.seconds !== undefined && (!finite(beat.seconds) || beat.seconds <= 0))
      throw new Error(`Invalid beat duration: ${beat.id}`);
    if (!beat.text.trim()) throw new Error(`Beat needs its visible action: ${beat.id}`);
    ids.add(beat.id);
  }
  if (options.script) cueSheet(options.script);
  const blocking = compileBlocking(options, options.script);
  const script: Script = options.script ?? {
    duration: 0,
    cues: {},
    segments: [],
  };
  let time = 0,
    previousEnd = 0;
  for (const beat of beats) {
    if (!options.script) {
      const span = blocking?.cues[beat.id] ?? { start: time, end: time + (beat.seconds ?? 2.5) };
      script.cues[beat.id] = { ...span, action: beat.text };
      (script.segments as Array<unknown>).push({
        id: beat.id,
        ...span,
        text: beat.text,
        title: beat.title ?? beat.text,
      });
    }
    if (!Object.hasOwn(script.cues, beat.id))
      throw new Error(`Narration is missing cue: ${beat.id}`);
    const cue = script.cues[beat.id]!;
    if (cue.end <= cue.start) throw new Error(`Beat cue needs a positive duration: ${beat.id}`);
    if (cue.start < previousEnd) throw new Error(`Overlapping or unordered beat: ${beat.id}`);
    previousEnd = cue.end;
    for (const [id, name] of Object.entries(beat.actors ?? {})) {
      if (!tracks[id]) throw new Error(`Unknown actor: ${id}`);
      action(name);
      if (cue.start === 0) tracks[id]![0] = { start: 0, action: name };
      else tracks[id]!.push({ start: cue.start, action: name });
    }
    for (const [id, change] of Object.entries(beat.props ?? {})) {
      const from = states[id];
      if (!from) throw new Error(`Unknown prop: ${id}`);
      propState(change);
      const to = { ...from, ...change, values: { ...from.values, ...change.values } };
      const delay = change.delay ?? 0,
        over = change.over ?? cue.end - cue.start - delay;
      if (
        !finite(delay) ||
        !finite(over) ||
        delay < 0 ||
        over <= 0 ||
        delay + over > cue.end - cue.start + 0.000001
      )
        throw new Error(`Prop ${id}: delay and duration must fit cue ${beat.id}`);
      propTracks[id]!.push({
        start: cue.start + delay,
        end: cue.start + delay + over,
        from,
        to,
        arc: change.arc ?? 0,
      });
      states[id] = to;
    }
    time = cue.end;
  }
  if (!options.script) script.duration = time;
  cueSheet(script);
  return { script, tracks, props, propTracks, blocking };
}
export type CharacterScore = ReturnType<typeof compileScore>;
