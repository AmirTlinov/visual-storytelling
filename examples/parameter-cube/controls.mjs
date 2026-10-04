import '@visual-storytelling/core/style.css';
import { player, mountScene } from '@visual-storytelling/core';

/** HTML controls delegate to the current SVG owner, including after the object reloads. */
export function attachProjection(root, object, options = {}) {
  const lifetime = new AbortController();
  let controls, scene, rejectReady;
  mountScene(root, {
    get duration() {
      return scene?.duration ?? 0;
    },
    get currentTime() {
      return scene?.currentTime ?? 0;
    },
    get checkpoints() {
      return scene?.checkpoints;
    },
    get playing() {
      return scene?.playing ?? false;
    },
    play: () => scene?.play(),
    pause: () => scene?.pause(),
    seek: (time) => scene?.seek(time),
    snapshot: () => scene?.snapshot(),
    review: () => scene?.review() ?? { duration: 0, cues: [], segments: [] },
    svg: () => scene?.svg(),
    dispose() {
      rejectReady(new Error('Projection was disposed before it became ready'));
      lifetime.abort();
      options.dispose?.();
      controls?.dispose();
      scene?.dispose();
      root.replaceChildren();
    },
  });
  return new Promise((resolve, reject) => {
    rejectReady = reject;
    function loaded(event) {
      const next = object.contentDocument?.querySelector('svg.ve-scene')?.scene;
      if (!next) {
        if (event) reject(new Error('Loaded projection has no registered SVG scene'));
        return;
      }
      if (next === scene) return;
      controls?.dispose();
      scene?.dispose();
      scene = next;
      controls = player(root.querySelector('[data-player]'), {
        transport: scene.transport,
        stops: scene.checkpoints,
        onSeek: scene.seek,
      });
      resolve();
    }
    object.addEventListener('load', loaded, { signal: lifetime.signal });
    object.addEventListener('error', () => reject(new Error('Projection failed to load')), {
      signal: lifetime.signal,
    });
    loaded();
  });
}
