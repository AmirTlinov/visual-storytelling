import { frameBounds, quantityStep } from './measure.js';
import { surface } from '../ink/surface.js';
import { lettering } from '../ink/lettering.js';
import { mathPlan } from './math.js';
import { mathNumber } from './numbers.js';
import { morphBody2D } from './body-2d.js';
import { mathBodies } from './math-bodies.js';
import type { MathOperation, MathPart } from './types.js';

/** A flat section of the shared morph field, drawn by the existing pen and lettering owners. */
function mount(
  parent: HTMLElement,
  operation: MathOperation,
  options: { id: string; pigment?: string; width?: number; height?: number },
) {
  const prepared = mathPlan(operation);
  const width = options.width ?? 840,
    height = options.height ?? 360;
  const sheet = surface(parent, {
    id: options.id,
    width,
    height,
    title: 'Математическое преобразование',
    description: 'Числа и формы следуют одной математической операции',
    grid: false,
  });
  const body = morphBody2D(sheet, options);
  const formula = lettering(sheet.layer, '', { size: 30, x: width / 2, y: 45 });
  formula.element.style.color = 'var(--ve-purple)';
  const stepLabel = lettering(sheet.layer, '', { size: 17, x: width / 2, y: height - 14 });
  const dimensions = [
    lettering(sheet.layer, '', { size: 20 }),
    lettering(sheet.layer, '', { size: 20 }),
  ];
  const notes = new Map<string, ReturnType<typeof lettering>>();
  let plan = prepared;
  let scale = 1,
    disposed = false,
    latest = 0;
  function setOperation(next: MathOperation) {
    if (disposed) throw new Error('Math morph has been disposed');
    plan = mathPlan(next);
    render(0);
  }
  function render(progress: number) {
    if (disposed) return;
    const frame = plan.sample(progress);
    latest = progress;
    if (!parent.getClientRects().length) return frame;
    const [min, max] = frameBounds(plan, frame, progress);
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    scale = Math.min((width - 72) / (max[0] - min[0]), (height - 150) / (max[1] - min[1]));
    const transform = (part: MathPart) => ({
      x: width / 2 + (part.position[0] - center[0]! - part.size[0] / 2) * scale,
      y: height / 2 + 20 - (part.position[1] - center[1]! + part.size[1] / 2) * scale,
      w: part.size[0] * scale,
      h: part.size[1] * scale,
    });
    const active =
      plan.encoding === 'quantity' ? (frame.morph >= 0.5 ? frame.targets : frame.sources) : [];
    body.render(
      mathBodies(frame, plan.encoding === 'quantity'),
      width / 2 - center[0]! * scale,
      height / 2 + 20 + center[1]! * scale,
      scale,
    );
    const steps = new Set(active.map(quantityStep));
    stepLabel.text(
      [...steps].some((step) => step > 1)
        ? `${steps.size === 1 ? 'Шаг сетки' : 'Шаги сетки'}: ${[...steps]
            .sort((a, b) => a - b)
            .map(mathNumber)
            .join(', ')}`
        : '',
    );
    const single = active.length === 1 ? active[0] : undefined;
    dimensions.forEach(
      (l) => (l.element.style.visibility = single && single.size[1] > 1.01 ? '' : 'hidden'),
    );
    if (single && single.size[1] > 1.01) {
      const b = transform(single);
      dimensions[0]!.text(mathNumber(single.size[0]));
      dimensions[0]!.at(b.x + b.w / 2, b.y - 12);
      dimensions[1]!.text(mathNumber(single.size[1]));
      dimensions[1]!.at(b.x - 25, b.y + b.h / 2);
    }
    const currentNotes = new Set((frame.notes ?? []).map((n) => n.id));
    for (const [id, note] of notes)
      if (!currentNotes.has(id)) {
        note.dispose();
        notes.delete(id);
      }
    for (const note of frame.notes ?? []) {
      if (!notes.has(note.id))
        notes.set(note.id, lettering(sheet.layer, '', { size: 26, anchor: 'start' }));
      const label = notes.get(note.id)!;
      label.text(note.text);
      const fit = Math.min(
        (note.size[0] * scale) / Math.max(1, label.width),
        (note.size[1] * scale) / 26,
      );
      label.element.setAttribute(
        'transform',
        `translate(${width / 2 + (note.position[0] - center[0]!) * scale - (label.width * fit) / 2} ${height / 2 + 20 - (note.position[1] - center[1]!) * scale + 9 * fit}) scale(${fit})`,
      );
      label.element.style.opacity = String(note.opacity);
    }
    formula.text(frame.formula);
    return frame;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    formula.dispose();
    stepLabel.dispose();
    dimensions.forEach((l) => l.dispose());
    notes.forEach((l) => l.dispose());
    body.dispose();
    sheet.dispose();
  }
  const observer = new ResizeObserver(() => render(latest));
  observer.observe(parent);
  render(0);
  return {
    element: sheet.element,
    render,
    setOperation,
    dispose,
    get plan() {
      return plan;
    },
  };
}
export const MathMorph2D = { mount };
