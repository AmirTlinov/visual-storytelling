import '@visual-storytelling/core/style.css';
import { player } from '@visual-storytelling/core';

/** HTML owns native controls; the embedded SVG owns the single calculation clock. */
export function attachProjection(root, object, options = {}) {
  const lifetime = new AbortController();
  let controls, scene;
  const ready = new Promise((resolve) => {
    function loaded() {
      const next = object.contentDocument?.querySelector('svg.ve-scene')?.scene;
      if (!next || next === scene) return;
      controls?.dispose();
      scene = next;
      controls = player(root.querySelector('[data-player]'), {
        transport: scene.transport,
        stops: scene.checkpoints,
        onSeek: scene.seek,
      });
      root.scene = {
        ...scene,
        get currentTime() {
          return scene.currentTime;
        },
        dispose() {
          if (lifetime.signal.aborted) return;
          lifetime.abort();
          options.dispose?.();
          controls.dispose();
          scene.dispose();
          root.replaceChildren();
          delete root.scene;
        },
      };
      resolve();
    }
    object.addEventListener('load', loaded, { signal: lifetime.signal });
    loaded();
  });
  return ready;
}
