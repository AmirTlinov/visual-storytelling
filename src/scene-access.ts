import type { SceneHandle } from './scene-handle.js';
import type { ControlParameter, ControlValue } from './controls/fields.js';

export type SceneCommand =
  | { type: 'pause' | 'play' }
  | { type: 'seek'; time: number }
  | { type: 'cue'; id: string; progress?: number }
  | { type: 'mode'; value: 'story' | 'explore' }
  | { type: 'parameters'; values: Record<string, ControlValue> }
  | { type: 'focus'; ids: readonly string[] }
  | { type: 'theme'; value: 'auto' | 'light' | 'dark' }
  | { type: 'reduced'; value: boolean };
export interface SceneInspection {
  time: number;
  duration: number;
  playing: boolean;
  mode: 'story' | 'explore';
  parameters: (ControlParameter & { key: string; visible: boolean })[];
  capabilities: string[];
  snapshot: unknown;
  presentation: ReturnType<NonNullable<SceneHandle['presentation']>> | undefined;
  review: ReturnType<SceneHandle['review']>;
}
export interface SceneAccessOwner {
  playing?(): boolean;
  mode?(): 'story' | 'explore';
  values?(): Record<string, ControlValue>;
  parameters?: readonly (ControlParameter & { key: string })[];
  visible?(key: string): boolean;
  setMode?(value: 'story' | 'explore'): void;
  setValues?(values: Record<string, ControlValue>): void;
  assertLive(): void;
}
export function sceneAccess(handle: SceneHandle, owner: SceneAccessOwner) {
  const inspect = (): SceneInspection => {
    owner.assertLive();
    return {
      time: handle.currentTime ?? 0,
      duration: handle.duration ?? 0,
      playing: owner.playing?.() ?? false,
      mode: owner.mode?.() ?? 'explore',
      parameters: (owner.parameters ?? []).map((p) => ({
        ...p,
        value: owner.values?.()[p.key] ?? p.value,
        visible: owner.visible?.(p.key) ?? true,
      })),
      capabilities: [
        ...(['seek', 'play', 'pause'] as const).filter((key) => typeof handle[key] === 'function'),
        ...(handle.seek && handle.review().cues.length ? ['cue'] : []),
        ...(owner.setValues && owner.parameters?.length ? ['parameters'] : []),
        ...(owner.setMode ? ['mode'] : []),
        ...(handle.setReduced ? ['reduced'] : []),
        ...(handle.focus ? ['focus'] : []),
        ...(handle.setTheme ? ['theme'] : []),
      ],
      snapshot: handle.snapshot(),
      presentation: handle.presentation?.(),
      review: handle.review(),
    };
  };
  return {
    inspect,
    find(query: string) {
      owner.assertLive();
      if (typeof query !== 'string') throw new Error('Find needs text');
      const words = query.toLocaleLowerCase().replaceAll('ё', 'е').split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      return handle
        .review()
        .cues.filter((c) =>
          words.every((word) =>
            [c.id, c.action, c.hold, c.quote, c.text]
              .join(' ')
              .toLocaleLowerCase()
              .replaceAll('ё', 'е')
              .includes(word),
          ),
        )
        .slice(0, 20);
    },
    async control(commands: readonly SceneCommand[]) {
      owner.assertLive();
      if (!Array.isArray(commands) || !commands.length || commands.length > 32)
        throw new Error('Supply 1–32 scene commands');
      // Check command shapes and parameter ranges before applying the ordered operations.
      for (const c of commands) {
        if (!c || typeof c !== 'object') throw new Error('A scene command needs a type');
        if (
          c.type === 'parameters' &&
          (!c.values || typeof c.values !== 'object' || Array.isArray(c.values))
        )
          throw new Error('Parameters need a values object');
        if (
          c.type === 'seek' &&
          (!Number.isFinite(c.time) || c.time < 0 || c.time > (handle.duration ?? 0))
        )
          throw new Error('Seek is outside story time');
        if (c.type === 'cue') {
          if (!handle.review().cues.some((q) => q.id === c.id))
            throw new Error(`Unknown cue: ${c.id}`);
          if (!Number.isFinite(c.progress ?? 0) || (c.progress ?? 0) < 0 || (c.progress ?? 0) > 1)
            throw new Error('Cue progress must be in [0,1]');
        }
        if (c.type === 'mode' && (!owner.setMode || !['story', 'explore'].includes(c.value)))
          throw new Error('Unknown scene mode');
        if (
          c.type === 'theme' &&
          (!handle.setTheme || !['auto', 'light', 'dark'].includes(c.value))
        )
          throw new Error('Theme is unavailable or invalid');
        if (
          c.type === 'focus' &&
          (!Array.isArray(c.ids) ||
            !c.ids.length ||
            c.ids.some((id: unknown) => typeof id !== 'string' || !id.trim()))
        )
          throw new Error('Focus needs supported object IDs');
        if (c.type === 'reduced' && (!handle.setReduced || typeof c.value !== 'boolean'))
          throw new Error('Reduced motion needs a boolean');
        if (c.type === 'parameters' && !owner.setValues)
          throw new Error('Parameters are unavailable');
        if ((c.type === 'seek' || c.type === 'cue') && !handle.seek)
          throw new Error('Seeking is unavailable');
        if ((c.type === 'play' || c.type === 'pause') && !handle[c.type as 'play' | 'pause'])
          throw new Error(`Playback ${c.type} is unavailable`);
        if (c.type === 'parameters')
          for (const [key, value] of Object.entries(c.values)) {
            const p = owner.parameters?.find((p) => p.key === key);
            if (
              !p ||
              typeof value !== typeof p.value ||
              (typeof value === 'number' &&
                (!Number.isFinite(value) ||
                  value < (p.min ?? -Infinity) ||
                  value > (p.max ?? Infinity))) ||
              (p.options && !p.options.some((o) => o.value === value))
            )
              throw new Error(`Invalid scene parameter: ${key}`);
          }
        if (
          ![
            'pause',
            'play',
            'seek',
            'cue',
            'mode',
            'parameters',
            'focus',
            'theme',
            'reduced',
          ].includes(c.type)
        )
          throw new Error('Unsupported scene command');
      }
      for (const c of commands) {
        owner.assertLive();
        switch (c.type) {
          case 'pause':
            handle.pause!();
            break;
          case 'play':
            await handle.play!();
            break;
          case 'seek':
            handle.seek!(c.time);
            break;
          case 'cue': {
            const q = handle.review().cues.find((q) => q.id === c.id)!;
            handle.seek!(q.start + (q.end - q.start) * (c.progress ?? 0));
            break;
          }
          case 'mode':
            owner.setMode!(c.value);
            break;
          case 'parameters':
            for (const key of Object.keys(c.values))
              if (owner.parameters?.find((p) => p.key === key)?.disabled)
                throw new Error(`Scene parameter is disabled: ${key}`);
            owner.setValues!({ ...owner.values?.(), ...c.values });
            break;
          case 'focus':
            if (!handle.focus) throw new Error('Focus is unavailable in the current chapter');
            handle.focus(c.ids);
            break;
          case 'theme':
            await handle.setTheme!(c.value);
            break;
          case 'reduced':
            handle.setReduced!(c.value);
            break;
        }
      }
      return inspect();
    },
  };
}
