import { surface } from '../ink/surface.js';
import { morphBody2D } from './body-2d.js';
import { morphPlan, type MorphOperation } from './objects.js';
import {
  morphTiming,
  motionProgress,
  watchMotion,
  type MorphTime,
  type MorphCues,
} from './timing.js';

function mount(
  parent: HTMLElement,
  operation: MorphOperation,
  options: { id: string; pigment?: string; width?: number; height?: number },
) {
  let plan = morphPlan(operation),
    progress = 0,
    disposed = false;
  const width = options.width ?? 840,
    height = options.height ?? 420;
  const sheet = surface(parent, {
    id: options.id,
    width,
    height,
    title: 'Формы и надписи',
    description: 'Форма и её надпись превращаются вместе',
    grid: false,
  });
  const body = morphBody2D(sheet, options);
  let lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  function render(input: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const time = morphTiming(input, cues),
      p = time.progress;
    lastTime = input;
    lastCues = cues;
    const frame = plan.sample(motionProgress(time, plan.completeAt));
    progress = Math.max(0, Math.min(1, p));
    if (!parent.getClientRects().length) return frame;
    const [min, max] = plan.bounds;
    const scale = Math.min((width - 80) / (max[0] - min[0]), (height - 80) / (max[1] - min[1]));
    body.render(
      frame,
      width / 2 - ((min[0] + max[0]) * scale) / 2,
      height / 2 + ((min[1] + max[1]) * scale) / 2,
      scale,
    );
    return frame;
  }
  const refresh = () => render(lastTime, lastCues);
  const observer = new ResizeObserver(refresh);
  const unwatchMotion = watchMotion(refresh);
  observer.observe(parent);
  render(0);
  return {
    element: sheet.element,
    render,
    setOperation(next: MorphOperation) {
      if (disposed) throw new Error('Morph has been disposed');
      plan = morphPlan(next);
      render(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      unwatchMotion();
      body.dispose();
      sheet.dispose();
    },
    get plan() {
      return plan;
    },
    get progress() {
      return progress;
    },
  };
}
export const Morph2D = { mount };
