import { sceneAccess } from '../../src/scene-access.ts';
import { captureScene, restoreScene } from '../../src/scene-checkpoint.ts';

/** Adapt the observed public capabilities of a pinned document; its runtime keeps ownership. */
export function adaptScene(source) {
  if (!source || typeof source !== 'object' || typeof source.dispose !== 'function')
    throw new Error('The document has no mounted SceneHandle.');
  if (source.inspect && source.control && source.capture && source.restore) return source;
  let disposed = false,
    notices = [];
  const assertLive = () => {
    if (disposed) throw new Error('Scene has been disposed');
  };
  const compatibility = {
    checkpoint: 'position',
    hostPlaybackPolicy: typeof source.connectHost === 'function',
    playbackState:
      typeof source.inspect === 'function' || typeof source.playing === 'boolean'
        ? 'observed'
        : 'unavailable',
    message:
      'Старая библиотека сохраняет место рассказа. Для сохранения камеры, условий и согласованного звука нескольких сцен попросите Codex обновить проект. Обновление можно отменить.',
  };
  const additions = {
    get restoreNotices() {
      return notices;
    },
    review: () => source.review?.() ?? { duration: source.duration ?? 0, cues: [], segments: [] },
    snapshot: () => source.snapshot?.() ?? null,
    inspect(options) {
      assertLive();
      const state = source.inspect?.(options) ?? access.inspect(options);
      return {
        ...state,
        ...(compatibility.playbackState === 'unavailable' ? { playing: undefined } : {}),
        restoreNotices: notices,
        compatibility,
      };
    },
    async control(commands, { signal } = {}) {
      assertLive();
      signal?.throwIfAborted();
      if (!source.control) {
        await access.control(commands, { signal });
        return additions.inspect();
      }
      if (!Array.isArray(commands) || !commands.length || commands.length > 32)
        throw new Error('Supply 1–32 scene commands');
      for (const command of commands) {
        assertLive();
        signal?.throwIfAborted();
        await source.control([command]);
      }
      signal?.throwIfAborted();
      return additions.inspect();
    },
    find(query) {
      assertLive();
      return source.find?.(query) ?? access.find(query);
    },
    capture() {
      assertLive();
      return source.capture?.() ?? captureScene(handle);
    },
    async restore(checkpoint) {
      assertLive();
      const state = source.restore
        ? await source.restore(checkpoint)
        : await restoreScene(handle, checkpoint);
      notices = state.restoreNotices ?? [];
      return additions.inspect();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      source.dispose();
    },
  };
  const bound = new Map();
  const handle = new Proxy(source, {
    get(target, key) {
      if (Object.hasOwn(additions, key)) return Reflect.get(additions, key, additions);
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (bound.get(key)?.source !== value)
        bound.set(key, {
          source: value,
          call: (...args) => {
            assertLive();
            return Reflect.apply(value, target, args);
          },
        });
      return bound.get(key).call;
    },
  });
  const access = sceneAccess(handle, {
    assertLive,
    playing: () => source.playing,
    mode: () => (source.duration > 0 ? 'story' : 'explore'),
  });
  return handle;
}
