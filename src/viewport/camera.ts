import type { Viewport } from './three.js';
import type { Shot3D, ShotTransition3D } from './shots.js';
import type { Cue } from '../story/cues.js';

export interface CameraShot extends Shot3D {
  cue: Cue;
  travel?: number;
}

/** Schedule the shared camera shots on story time; Viewport3D owns gesture takeover and fitting. */
export function cameraTrack(view: Viewport, initial: Shot3D, shots: readonly CameraShot[] = []) {
  const ordered = [...shots].sort((a, b) => a.cue.start - b.cue.start);
  let lastTime = 0,
    lastReduced = false;
  const frame = (options: Shot3D): Shot3D => {
    const padding = options.padding ?? 36;
    const horizontal = Math.min(padding, view.stage.clientWidth * 0.06);
    return {
      ...options,
      insets: {
        top: padding,
        right: horizontal,
        bottom: padding,
        left: horizontal,
        ...options.insets,
      },
    };
  };
  function render(time: number, reduced = false) {
    lastTime = time;
    lastReduced = reduced;
    let previous = initial;
    let current: ShotTransition3D = frame(initial);
    for (const shot of ordered) {
      const start = Math.max(0, shot.cue.start - (shot.travel ?? 0.85));
      if (time < start) break;
      const progress = reduced
        ? Number(time >= shot.cue.start)
        : Math.max(0, Math.min(1, (time - start) / Math.max(0.001, shot.cue.start - start)));
      current = { ...frame(shot), from: frame(previous), progress, reduced };
      if (progress < 1) break;
      previous = shot;
    }
    view.shot(current);
  }
  const stopResize = view.onResize(() => render(lastTime, lastReduced));
  return {
    render,
    explore: view.explore,
    resume(time = lastTime) {
      render(time, lastReduced);
      view.reset();
    },
    get following() {
      return view.following;
    },
    dispose: stopResize,
  };
}
