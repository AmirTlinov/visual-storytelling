import { fusionText } from '../ink/fusion/text.js';
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
/** Default written transition: readable layout, stroke transport, contact and Rapier elasticity. */
async function mount(
  parent: HTMLElement,
  operation: InkOperation,
  options: { color?: string } = {},
) {
  let current = operation,
    progress = 0,
    disposed = false,
    tension = 36,
    width = 0;
  let poses: { sources: FusionPose[]; targets: FusionPose[] } = { sources: [], targets: [] };
  const duration = 4;
  const view = await physicalFusion(parent, {
    color: options.color,
    duration,
    frame(time) {
      const p = time / duration,
        approach = smooth((p - 0.03) / 0.17);
      return {
        sources: poses.sources.map((pose) => ({
          x: pose.x * (1 - 0.16 * approach),
          y: pose.y * (1 - 0.16 * approach),
        })),
        targets: poses.targets,
        tension,
        morph: 1 - (1 - smooth((p - 0.04) / 0.86)) ** 2,
      };
    },
  });
  const originalHeight = parent.style.height;
  let lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  function render(input: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const time = morphTiming(input, cues),
      p = time.progress;
    lastTime = input;
    lastCues = cues;
    progress = Math.max(0, Math.min(1, p));
    view.render(motionProgress(time, 0.9) * duration);
  }
  function rebuild(candidate = current) {
    const nextWidth = Math.max(240, parent.getBoundingClientRect().width);
    const inputs = [...candidate.sources, ...candidate.targets];
    const block = inputs.some(
      (value) => typeof value === 'string' && (/\s/.test(value) || value.length > 14),
    );
    const letters = inputs.every((value) => typeof value === 'string' && [...value].length === 1);
    const size = block
      ? nextWidth < 480
        ? 25
        : 30
      : letters
        ? Math.min(
            180,
            nextWidth / (Math.max(candidate.sources.length, candidate.targets.length) * 1.8),
          )
        : Math.min(
            96,
            nextWidth / (Math.max(candidate.sources.length, candidate.targets.length) * 7),
          );
    const make = (group: InkOperation['sources']) =>
      group.map((value) =>
        typeof value !== 'string'
          ? value
          : fusionText(value, {
              size,
              maxWidth: block
                ? nextWidth - 36
                : Math.max(24, (nextWidth - 36 - (group.length - 1) * 48) / group.length),
              align: block ? 'left' : 'center',
            }),
      );
    const sources = make(candidate.sources),
      targets = make(candidate.targets),
      gap = block ? 68 : 48;
    const arrange = (group: FusionShape[]) => {
      const extents = group.map((shape) => (block ? shape.bounds.height : shape.bounds.width));
      let cursor = -(extents.reduce((a, b) => a + b, 0) + gap * (group.length - 1)) / 2;
      return extents.map((extent) => {
        const position = cursor + extent / 2;
        cursor += extent + gap;
        return block ? { x: 0, y: position } : { x: position, y: 0 };
      });
    };
    const height = block
      ? Math.max(
          ...[sources, targets].map(
            (group) =>
              group.reduce((n, shape) => n + shape.bounds.height, 0) + gap * (group.length - 1),
          ),
        ) + 64
      : Math.max(215, ...[...sources, ...targets].map((shape) => shape.bounds.height + 100));
    for (const shape of [...sources, ...targets])
      if (
        !shape.paths?.length ||
        ![shape.bounds?.width, shape.bounds?.height].every((v) => Number.isFinite(v) && v > 0) ||
        shape.paths.some(
          (path) =>
            path.length < 2 ||
            path.some(
              (point) => point.length !== 3 || !point.every(Number.isFinite) || point[2] < 0,
            ),
        )
      )
        throw new Error('Ink objects need finite visible strokes and positive bounds');
    const oldPoses = poses;
    poses = { sources: arrange(sources), targets: arrange(targets) };
    try {
      view.setShapes(sources, targets);
    } catch (error) {
      poses = oldPoses;
      throw error;
    }
    current = candidate;
    width = nextWidth;
    parent.style.height = `${height}px`;
    view.setSize(width, height);
    view.canvas.setAttribute(
      'aria-label',
      [current.sources, current.targets]
        .map((group) =>
          group.map((value) => (typeof value === 'string' ? value : 'форма')).join(' + '),
        )
        .join(' → '),
    );
    render(lastTime, lastCues);
  }
  function setOperation(next: InkOperation) {
    if (disposed) throw new Error('Ink morph has been disposed');
    if (
      !next.sources.length ||
      !next.targets.length ||
      [...next.sources, ...next.targets].some((value) => typeof value === 'string' && !value.trim())
    )
      throw new Error('Ink morph needs visible sources and targets');
    rebuild(next);
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
    parent.style.height = originalHeight;
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
      parent.style.height = originalHeight;
    },
  };
}
export const InkMorph = { mount };
