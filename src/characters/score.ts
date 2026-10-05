import { cueSheet, type Script } from '../story/cues.js';
import type { CharacterStageOptions, Place, PropArt, PropChange } from './types.js';
import { destination } from './staging/layout.js';
import { compileBlocking } from './staging/blocking.js';
import { propStart } from './prop-timing.js';
import type { PropKey, PropState } from './prop-state.js';
export interface ActionKey {
  start: number;
  action: string;
}

/** Compile a storyboard once; the existing Story owns validation, time and playback. */
export function compileScore(options: CharacterStageOptions) {
  const { pack, set, cast, beats } = options;
  const props = { ...set.props, ...options.props };
  const finite = (n: number) => Number.isFinite(n);
  const artwork = (art: PropArt, id: string) => {
    if (
      !art ||
      typeof art.svg !== 'string' ||
      (art.paint !== undefined && typeof art.paint !== 'function')
    )
      throw new Error(`Prop ${id}: art needs svg and an optional paint function`);
    if ('activeSvg' in art)
      throw new Error(`Prop ${id}: use art.paint with the active channel instead of activeSvg`);
  };
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
  const states: Record<string, PropState> = Object.create(null);
  const propTracks: Record<string, PropKey[]> = Object.create(null);
  const objects = set.staging?.objects ?? {};
  for (const [id, item] of Object.entries(objects)) {
    if (item.art) {
      if (item.kind !== 'prop') throw new Error(`Object ${id}: art belongs to kind prop`);
      artwork(item.art, id);
    }
    if (Object.hasOwn(cast, id) || Object.hasOwn(props, id))
      throw new Error(`Physical object shares an actor or prop ID: ${id}`);
    if (item.art?.paint && (options.surfaces?.[id] || item.surface?.corners))
      throw new Error(`Object ${id}: art.paint owns its whole drawing; use surfaces for an inset`);
    if (item.art?.paint || options.surfaces?.[id]) {
      propState({ values: item.values });
      if (item.trigger && Object.hasOwn(item.values ?? {}, 'active'))
        throw new Error(`Object ${id}: the press trigger owns the active channel`);
      states[id] = { values: { ...item.values } };
      propTracks[id] = [];
    } else if (item.values !== undefined)
      throw new Error(`Object ${id}: values need art.paint or a drawing surface`);
  }
  for (const [id, prop] of Object.entries(props)) {
    artwork(prop.art, id);
    if (Object.hasOwn(cast, id)) throw new Error(`Actor and prop share an ID: ${id}`);
    if (prop.scale !== undefined && (!finite(prop.scale) || prop.scale <= 0))
      throw new Error(`Invalid prop scale: ${id}`);
    place(prop.at);
    propState(prop);
    states[id] = { at: prop.at, opacity: prop.opacity ?? 1, values: { ...prop.values } };
    propTracks[id] = [];
  }
  const propStates = { ...states };
  const ids = new Set<string>();
  for (const beat of beats) {
    if (!beat.id.trim() || ids.has(beat.id)) throw new Error(`Duplicate or empty beat: ${beat.id}`);
    if (beat.seconds !== undefined && (!finite(beat.seconds) || beat.seconds <= 0))
      throw new Error(`Invalid beat duration: ${beat.id}`);
    if (!beat.text.trim()) throw new Error(`Beat needs its visible action: ${beat.id}`);
    ids.add(beat.id);
  }
  const supplied = options.script && cueSheet(options.script).script;
  const blocking = compileBlocking(options, supplied);
  const script: Script = supplied ?? {
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
      const object = objects[id];
      if (object) {
        if (change.at !== undefined || change.opacity !== undefined || change.arc !== undefined)
          throw new Error(
            `Object ${id}: physical placement belongs to perform; props animates values`,
          );
        if (object.trigger && Object.hasOwn(change.values ?? {}, 'active'))
          throw new Error(`Object ${id}: the press trigger owns the active channel`);
      }
      propState(change);
      const to = {
        at: change.at ?? from.at,
        opacity: change.opacity ?? from.opacity,
        values: { ...from.values, ...change.values },
      };
      const origin = propStart(
        change,
        blocking?.plans.filter((p) => p.start === cue.start) ?? [],
        cue.start,
        beat.id,
      );
      const delay = change.delay ?? 0,
        start = origin + delay,
        over = change.over ?? cue.end - start;
      if (
        !finite(delay) ||
        !finite(over) ||
        delay < 0 ||
        over <= 0 ||
        start + over > cue.end + 0.000001
      )
        throw new Error(`Prop ${id}: delay and duration must fit cue ${beat.id}`);
      propTracks[id]!.push({
        start,
        end: start + over,
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
  return { script, tracks, props, propStates, propTracks, blocking };
}
export type CharacterScore = ReturnType<typeof compileScore>;
