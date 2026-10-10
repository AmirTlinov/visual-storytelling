import '@visual-storytelling/core/style.css';
import './frame.css';
import { player, mountScene, SceneShell } from '@visual-storytelling/core';

/** HTML controls delegate to the current SVG owner, including after the object reloads. */
export function attachProjection(root, object, options = {}) {
  const controlsHost = root.querySelector('[data-player]');
  controlsHost.remove();
  const content = document.createElement('div');
  content.className = 'projection-composition';
  content.append(...root.children);
  const frame = SceneShell.frame(content, { width: 1280, height: 720, scope: 'scene' });
  root.append(frame.element, controlsHost);
  frame.resize();
  const lifetime = new AbortController();
  let controls, scene, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  mountScene(
    root,
    {
      get camera() {
        return scene?.camera;
      },
      get subject() {
        return scene?.subject;
      },
      ready: () => ready.then(() => scene?.ready?.()),
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
        frame.dispose();
        options.dispose?.();
        controls?.dispose();
        scene?.dispose();
        root.replaceChildren();
      },
    },
    {
      get parameters() {
        return scene?.inspect({ presentation: false }).parameters ?? [];
      },
      values: () =>
        Object.fromEntries(
          (scene?.inspect({ presentation: false }).parameters ?? []).map((p) => [p.key, p.value]),
        ),
      setValues: async (patch) => {
        await scene.control([{ type: 'parameters', values: patch }]);
      },
    },
  );
  {
    function loaded(event) {
      const next = object.contentDocument?.querySelector('svg.ve-scene')?.scene;
      if (!next) {
        if (event) rejectReady(new Error('Loaded projection has no registered SVG scene'));
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
      resolveReady();
    }
    object.addEventListener('load', loaded, { signal: lifetime.signal });
    object.addEventListener('error', () => rejectReady(new Error('Projection failed to load')), {
      signal: lifetime.signal,
    });
    loaded();
  }
  return ready;
}
