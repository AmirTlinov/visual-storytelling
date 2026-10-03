import { volumeBox, volumeField } from '../viewport/morph/field.js';
import { fieldSection } from '../viewport/morph/section.js';
import { frameBounds, quantityGrid } from './measure.js';
import { surface, type Surface } from '../ink/surface.js';
import { lettering } from '../ink/lettering.js';
import { svg } from '../ink/dom.js';
import { mathPlan } from './math.js';
import { mathNumber } from './numbers.js';
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
  const shapes = svg('g', { color: `var(--ve-${options.pigment ?? 'blue'})` });
  sheet.layer.append(shapes);
  const lines = svg('g', { color: 'var(--ve-pencil)' });
  sheet.layer.append(lines);
  lines.style.opacity = '.3';
  const formula = lettering(sheet.layer, '', { size: 30, x: width / 2, y: 45 });
  formula.element.style.color = 'var(--ve-purple)';
  const stepLabel = lettering(sheet.layer, '', { size: 17, x: width / 2, y: height - 14 });
  const dimensions = [
    lettering(sheet.layer, '', { size: 20 }),
    lettering(sheet.layer, '', { size: 20 }),
  ];
  const notes = new Map<string, ReturnType<typeof lettering>>();
  let field: ReturnType<typeof volumeField>,
    topology = '';
  const labels: Array<ReturnType<typeof lettering>> = [];
  let plan = prepared,
    strokes: Array<ReturnType<Surface['pen']['path']>> = [],
    seams: Array<ReturnType<Surface['pen']['path']>> = [];
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
    const [min, max] = frameBounds(plan, frame);
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
    const next = `${frame.sources.length}:${frame.targets.length}`;
    if (next !== topology) {
      const box = volumeBox([1, 1, 1]);
      field = volumeField(
        frame.sources.map(() => box),
        frame.targets.map(() => box),
      );
      topology = next;
    }
    const pose = (part: MathPart) => ({ position: part.position, scale: part.size });
    field.update({
      sources: frame.sources.map(pose),
      targets: frame.targets.map(pose),
      morph: frame.morph,
      tension: 0,
    });
    const contours = fieldSection(field);
    while (strokes.length > contours.length) strokes.pop()!.dispose();
    contours.forEach((contour, i) => {
      const points = contour.map(([x, y]) => [
        width / 2 + (x - center[0]!) * scale,
        height / 2 + 20 - (y - center[1]!) * scale,
      ]);
      const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
      const xs = points.map((p) => p[0]!),
        ys = points.map((p) => p[1]!);
      const bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      if (!strokes[i])
        strokes[i] = sheet.pen.path(shapes, `quantity-${i}`, d, { fill: 'marker', stroke: 'ink' });
      else strokes[i]!.update(d, bounds);
    });
    const parts = [...frame.sources, ...frame.targets];
    while (labels.length > parts.length) labels.pop()!.dispose();
    parts.forEach((part, i) => {
      const box = transform(part);
      labels[i] ??= lettering(sheet.layer, '', { size: 26, anchor: 'start' });
      const label = labels[i]!;
      label.text(mathNumber(part.value));
      const fit = Math.min(
        plan.encoding === 'cells' ? Infinity : 1,
        Math.max(1, plan.encoding === 'cells' ? box.w * 0.88 : box.w - 8) /
          Math.max(1, label.width),
        Math.max(1, plan.encoding === 'cells' ? box.h * 0.62 : box.h - 8) / 26,
      );
      label.element.setAttribute(
        'transform',
        `translate(${box.x + (box.w - label.width * fit) / 2} ${box.y + box.h / 2 + 9 * fit}) scale(${fit})`,
      );
      const opacity = i < frame.sources.length ? frame.sourceOpacity : frame.targetOpacity;
      label.element.style.opacity = String(opacity);
    });
    const marks: Array<[number, number, number, number]> = [];
    const steps = new Set<number>();
    for (const part of active) {
      const grid = quantityGrid(part);
      steps.add(grid.step);
      for (const line of grid.lines)
        marks.push([
          width / 2 + (line.from[0] - center[0]!) * scale,
          height / 2 + 20 - (line.from[1] - center[1]!) * scale,
          width / 2 + (line.to[0] - center[0]!) * scale,
          height / 2 + 20 - (line.to[1] - center[1]!) * scale,
        ]);
    }
    stepLabel.text(
      [...steps].some((step) => step > 1)
        ? `${steps.size === 1 ? 'Шаг сетки' : 'Шаги сетки'}: ${[...steps]
            .sort((a, b) => a - b)
            .map(mathNumber)
            .join(', ')}`
        : '',
    );
    while (seams.length > marks.length) seams.pop()!.dispose();
    marks.forEach((m, i) => {
      const d = `M${m[0]} ${m[1]}L${m[2]} ${m[3]}`;
      if (!seams[i]) seams[i] = sheet.pen.path(lines, `measure-${i}`, d, { width: 1 });
      else seams[i]!.update(d);
    });
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
    labels.forEach((l) => l.dispose());
    notes.forEach((l) => l.dispose());
    strokes.forEach((s) => s.dispose());
    seams.forEach((s) => s.dispose());
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
