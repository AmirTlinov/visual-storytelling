import { inkLayout } from './ink-layout.js';
import { contentViewport } from '../layout/content.js';
import type { FusionShape, FusionPose } from '../ink/fusion/shape.js';
import { physicalFusion } from '../physics/fusion.js';
import { smooth } from './numbers.js';
import {
  morphTiming,
  motionProgress,
  watchMotion,
  type MorphTime,
  type MorphCues,
} from './timing.js';

export interface InkOperation {
  readonly sources: readonly (string | FusionShape)[];
  readonly targets: readonly (string | FusionShape)[];
}
/** Validate before a story publishes edited parameters or allocates its renderer. */
function plan(operation: InkOperation) {
  if (
    !operation.sources.length ||
    !operation.targets.length ||
    [...operation.sources, ...operation.targets].some(
      (value) => typeof value === 'string' && !value.trim(),
    )
  )
    throw new Error('Ink morph needs visible sources and targets');
  return operation;
}
/** Default written transition: readable layout, stroke transport, contact and Rapier elasticity. */
async function mount(
  parent: HTMLElement,
  operation: InkOperation,
  options: { color?: string } = {},
) {
  let current = plan(operation),
    progress = 0,
    disposed = false,
    tension = 36,
    width = 0;
  let poses: { sources: FusionPose[]; targets: FusionPose[] } = { sources: [], targets: [] };
  let duration = 4;
  const authoredDuration = duration;
  const view = await physicalFusion(parent, {
    color: options.color,
    duration: authoredDuration,
    frame(time) {
      const p = time / authoredDuration,
        approach = smooth((p - 0.03) / 0.17);
      return {
        sources: poses.sources.map((pose) => ({
          ...pose,
          x: pose.x * (1 - 0.16 * approach),
          y: pose.y * (1 - 0.16 * approach),
        })),
        targets: poses.targets,
        tension,
        morph: 1 - (1 - smooth((p - 0.04) / 0.86)) ** 2,
      };
    },
  });
  const viewport = contentViewport(parent);
  let lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  function render(input: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const time = morphTiming(input, cues),
      p = time.progress;
    if (time.duration !== undefined && (!Number.isFinite(time.duration) || time.duration < 0))
      throw new Error('Ink duration must be finite and non-negative');
    // A zero-length cue selects an endpoint. Keep the positive physical clock;
    // fusionTrack returns exact endpoints without running the simulation.
    if (time.duration !== undefined && time.duration > 0 && time.duration !== duration) {
      view.setDuration(time.duration);
      duration = time.duration;
    }
    lastTime = input;
    lastCues = cues;
    progress = Math.max(0, Math.min(1, p));
    view.render(motionProgress(time, 0.9) * duration);
  }
  function rebuild(candidate = current, reset = false) {
    const nextWidth = Math.max(1, parent.getBoundingClientRect().width || width || 240);
    const layout = inkLayout(candidate, nextWidth);
    const sources = layout.sources.shapes,
      targets = layout.targets.shapes,
      height = layout.height;
    const oldPoses = poses;
    poses = { sources: layout.sources.poses, targets: layout.targets.poses };
    try {
      view.setShapes(sources, targets);
    } catch (error) {
      poses = oldPoses;
      throw error;
    }
    current = candidate;
    width = nextWidth;
    viewport.resize(height);
    view.setSize(width, height);
    view.canvas.setAttribute(
      'aria-label',
      [current.sources, current.targets]
        .map((group) =>
          group.map((value) => (typeof value === 'string' ? value : 'форма')).join(' + '),
        )
        .join(' → '),
    );
    render(reset ? 0 : lastTime, reset ? undefined : lastCues);
  }
  function setOperation(next: InkOperation) {
    if (disposed) throw new Error('Ink morph has been disposed');
    rebuild(plan(next), true);
  }
  const observer = new ResizeObserver(() => {
    if (
      !disposed &&
      parent.getClientRects().length &&
      Math.abs(parent.getBoundingClientRect().width - width) > 1
    )
      rebuild();
  });
  const unwatchMotion = watchMotion(() => render(lastTime, lastCues));
  try {
    setOperation(operation);
    observer.observe(parent);
  } catch (error) {
    observer.disconnect();
    unwatchMotion();
    view.dispose();
    viewport.dispose();
    throw error;
  }
  return {
    canvas: view.canvas,
    render,
    setOperation,
    setTension(value: number) {
      if (!Number.isFinite(value)) throw new Error('Ink tension must be finite');
      tension = Math.max(0, Math.min(64, value));
      render(lastTime, lastCues);
    },
    get stats() {
      return view.stats;
    },
    get progress() {
      return progress;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      unwatchMotion();
      view.dispose();
      viewport.dispose();
    },
  };
}
export const InkMorph = { mount, plan };
