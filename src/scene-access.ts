import type { SceneHandle } from './scene-handle.js';
import type { ControlParameter, ControlValue } from './controls/fields.js';
import type { SceneView, SceneRestoreNotice } from './scene-checkpoint.js';
import type { CueReview } from './story/cues.js';

export type SceneSearchResult =
  | ({ type: 'cue' } & CueReview['cues'][number])
  | ({ type: 'chapter' } & CueReview['segments'][number])
  | { type: 'object'; id: string; label: string; cues: string[] };

export type SceneCommand =
  | { type: 'pause' | 'play' }
  | { type: 'undoExperiment' | 'redoExperiment' }
  | { type: 'mute'; value: boolean }
  | { type: 'rate'; value: number }
  | { type: 'seek'; time: number }
  | { type: 'cue'; id: string; progress?: number }
  | { type: 'mode'; value: 'story' | 'explore' }
  | { type: 'parameters'; values: Record<string, ControlValue> }
  | { type: 'focus'; ids: readonly string[] }
  | { type: 'select'; ids: readonly string[] }
  | { type: 'theme'; value: 'auto' | 'light' | 'dark' | 'inherit' }
  | { type: 'reduced'; value: boolean };
export interface SceneControlOptions {
  signal?: AbortSignal;
}
export interface SceneInspection {
  restoreNotices?: readonly SceneRestoreNotice[];
  time: number;
  duration: number;
  playing: boolean;
  muted?: boolean;
  rate?: number;
  selected?: readonly string[];
  objects?: ReturnType<NonNullable<SceneHandle['objects']>>;
  experimentHistory?: { undo: boolean; redo: boolean };
  mode: 'story' | 'explore';
  parameters: (Omit<ControlParameter, 'format'> & {
    key: string;
    visible: boolean;
    displayValue?: string;
  })[];
  capabilities: string[];
  snapshot: unknown;
  presentation: ReturnType<NonNullable<SceneHandle['presentation']>> | undefined;
  review: ReturnType<SceneHandle['review']>;
}
export interface SceneAccessOwner {
  view?(): SceneView | undefined;
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
  const inspect = ({ presentation = true }: { presentation?: boolean } = {}): SceneInspection => {
    owner.assertLive();
    const objects = handle.objects?.(),
      review = handle.review();
    return {
      restoreNotices: handle.restoreNotices,
      time: handle.currentTime ?? 0,
      duration: handle.duration ?? 0,
      playing: owner.playing?.() ?? false,
      muted: handle.muted,
      rate: handle.rate,
      selected: handle.selected,
      objects,
      experimentHistory: handle.experimentHistory,
      mode: owner.mode?.() ?? 'explore',
      parameters: (owner.parameters ?? []).map(({ format, ...p }) => {
        const value = owner.values?.()[p.key] ?? p.value;
        return {
          ...p,
          value,
          displayValue: format?.(value),
          visible: owner.visible?.(p.key) ?? true,
        };
      }),
      capabilities: [
        ...(['seek', 'play', 'pause'] as const).filter((key) => typeof handle[key] === 'function'),
        ...(handle.seek && review.cues.length ? ['cue'] : []),
        ...(owner.setValues && owner.parameters?.length ? ['parameters'] : []),
        ...(owner.setMode ? ['mode'] : []),
        ...(handle.setReduced ? ['reduced'] : []),
        ...(handle.focus ? ['focus'] : []),
        ...(handle.setTheme ? ['theme'] : []),
        ...(handle.mute ? ['mute'] : []),
        ...(handle.setRate ? ['rate'] : []),
        ...(handle.select && objects?.length ? ['select'] : []),
        ...(['undoExperiment', 'redoExperiment'] as const).filter(
          (key) => typeof handle[key] === 'function',
        ),
      ],
      snapshot: handle.snapshot(),
      presentation: presentation ? handle.presentation?.() : undefined,
      review,
    };
  };
  return {
    inspect,
    find(query: string): SceneSearchResult[] {
      owner.assertLive();
      if (typeof query !== 'string') throw new Error('Find needs text');
      const normalize = (text: string) => text.toLocaleLowerCase().replaceAll('ё', 'е');
      const words = normalize(query).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const review = handle.review();
      const objects = handle.objects?.() ?? [];
      const results: { value: SceneSearchResult; score: number }[] = [];
      const add = (value: SceneSearchResult, label: string, context: string) => {
        const text = normalize([value.id, label, context].join(' '));
        if (!words.every((word) => text.includes(word))) return;
        const phrase = words.join(' ');
        const score =
          normalize(value.id) === phrase
            ? 100
            : normalize(label) === phrase
              ? 80
              : words.filter((word) => normalize(label).includes(word)).length * 5 + 1;
        results.push({ value, score });
      };
      for (const c of review.cues)
        add(
          { ...c, type: 'cue' },
          c.action ?? c.hold ?? c.quote ?? c.text ?? c.id,
          [
            c.text,
            c.quote,
            ...review.segments
              .filter((ch) => ch.start <= c.start && ch.end > c.start)
              .map((ch) => ch.title),
            ...objects.filter((o) => c.targets?.includes(o.id)).map((o) => o.label),
          ].join(' '),
        );
      for (const chapter of review.segments) {
        const { words: _words, ...summary } = chapter;
        add({ ...summary, type: 'chapter' }, chapter.title ?? chapter.id, chapter.text);
      }
      for (const object of objects)
        add(
          {
            type: 'object',
            id: object.id,
            label: object.label,
            cues: review.cues.filter((c) => c.targets?.includes(object.id)).map((c) => c.id),
          },
          object.label,
          '',
        );
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((result) => result.value);
    },
    async control(commands: readonly SceneCommand[], { signal }: SceneControlOptions = {}) {
      owner.assertLive();
      signal?.throwIfAborted();
      if (!Array.isArray(commands) || !commands.length || commands.length > 32)
        throw new Error('Supply 1–32 scene commands');
      const validate = (c: SceneCommand) => {
        if (!c || typeof c !== 'object') throw new Error('A scene command needs a type');
        if (
          (c.type === 'undoExperiment' || c.type === 'redoExperiment') &&
          !handle[c.type as 'undoExperiment' | 'redoExperiment']
        )
          throw new Error('Experiment history is unavailable');
        if (c.type === 'mute' && (!handle.mute || typeof c.value !== 'boolean'))
          throw new Error('Mute is unavailable or invalid');
        if (
          c.type === 'rate' &&
          (!handle.setRate || !Number.isFinite(c.value) || c.value < 0.25 || c.value > 3)
        )
          throw new Error('Playback rate must be between 0.25 and 3');
        if (
          c.type === 'select' &&
          (!Array.isArray(c.ids) ||
            !handle.select ||
            c.ids.some(
              (id: unknown) =>
                typeof id !== 'string' || !handle.objects?.().some((o) => o.id === id),
            ))
        )
          throw new Error('Select needs known object IDs');
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
          (!handle.setTheme || !['auto', 'light', 'dark', 'inherit'].includes(c.value))
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
              p.disabled ||
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
            'mute',
            'rate',
            'select',
            'undoExperiment',
            'redoExperiment',
          ].includes(c.type)
        )
          throw new Error('Unsupported scene command');
      };
      // Reject invalid input before effects; a previous operation can then change live bounds.
      for (const c of commands) validate(c);
      for (const c of commands) {
        owner.assertLive();
        signal?.throwIfAborted();
        validate(c);
        switch (c.type) {
          case 'undoExperiment':
            await handle.undoExperiment!();
            break;
          case 'redoExperiment':
            await handle.redoExperiment!();
            break;
          case 'mute':
            await handle.mute!(c.value);
            break;
          case 'rate':
            handle.setRate!(c.value);
            break;
          case 'select':
            handle.select!(c.ids);
            break;
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
        signal?.throwIfAborted();
      }
      return inspect();
    },
  };
}
