import type { SceneHandle } from './scene-handle.js';
import type { ControlValue } from './controls/fields.js';

/** A portable position in a scene; playback remains owned by the mounted runtime. */
export interface SceneCheckpoint {
  time: number;
  cue?: string;
  progress: number;
  mode: 'story' | 'explore';
  muted?: boolean;
  rate?: number;
  selected?: readonly string[];
  values: Record<string, ControlValue>;
  view?: unknown;
}

export interface SceneView {
  reset(): void;
  dispose(): void;
  capture?(): unknown;
  restore?(state: unknown): void;
}

export function captureScene(handle: SceneHandle, view?: SceneView): SceneCheckpoint {
  const state = handle.inspect({ presentation: false });
  const cue = state.review.cues
    .filter(
      (c) =>
        c.start <= state.time &&
        c.end > c.start &&
        (state.time < c.end || (state.time === state.duration && c.end === state.duration)),
    )
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  return {
    time: state.time,
    cue: cue?.id,
    progress: cue ? (state.time - cue.start) / (cue.end - cue.start) : 0,
    mode: state.mode,
    muted: state.muted,
    rate: state.rate,
    selected: state.selected,
    values: Object.fromEntries(
      state.parameters.filter((p) => !p.disabled).map((p) => [p.key, p.value]),
    ),
    view: view?.capture?.(),
  };
}

/** Restore through the same validated controls as human and agent input. */
export async function restoreScene(handle: SceneHandle, state: SceneCheckpoint, view?: SceneView) {
  if (!state || !Number.isFinite(state.time) || !Number.isFinite(state.progress))
    throw new Error('Invalid scene checkpoint');
  const capabilities = handle.inspect().capabilities;
  if (state.muted !== undefined && capabilities.includes('mute'))
    await handle.control([{ type: 'mute', value: state.muted }]);
  if (state.rate !== undefined && capabilities.includes('rate'))
    await handle.control([{ type: 'rate', value: state.rate }]);
  if (capabilities.includes('pause')) await handle.control([{ type: 'pause' }]);
  if (
    state.cue &&
    capabilities.includes('cue') &&
    handle.review().cues.some((c) => c.id === state.cue)
  )
    await handle.control([
      { type: 'cue', id: state.cue, progress: Math.min(1, Math.max(0, state.progress)) },
    ]);
  else if (capabilities.includes('seek'))
    await handle.control([
      { type: 'seek', time: Math.min(handle.duration ?? 0, Math.max(0, state.time)) },
    ]);
  if (capabilities.includes('mode')) await handle.control([{ type: 'mode', value: state.mode }]);
  if (state.mode === 'explore' && capabilities.includes('parameters')) {
    const pending = new Map(Object.entries(state.values ?? {}));
    // A chapter selector can change the bounds and availability of the next field.
    while (pending.size) {
      const parameter = handle.inspect().parameters.find((p) => {
        const value = pending.get(p.key);
        return (
          pending.has(p.key) &&
          !p.disabled &&
          typeof p.value === typeof value &&
          (typeof value !== 'number' ||
            (Number.isFinite(value) &&
              value >= (p.min ?? -Infinity) &&
              value <= (p.max ?? Infinity))) &&
          (!p.options || p.options.some((o) => o.value === value))
        );
      });
      if (!parameter) break;
      const value = pending.get(parameter.key)!;
      pending.delete(parameter.key);
      await handle.control([{ type: 'parameters', values: { [parameter.key]: value } }]);
    }
  }
  if (state.view !== undefined) view?.restore?.(state.view);
  if (state.selected && capabilities.includes('select'))
    await handle.control([
      {
        type: 'select',
        ids: state.selected.filter((id) => handle.objects?.().some((o) => o.id === id)),
      },
    ]);
  return handle.inspect();
}
