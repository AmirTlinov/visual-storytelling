import { quantityBounds, quantityStep } from './measure.js';
import { surface } from '../ink/surface.js';
import { lettering } from '../ink/lettering.js';
import { paragraph } from '../ink/paragraph.js';
import { cellLayout, validateCellColumns } from './layout.js';
import { contentViewport } from '../layout/content.js';
import { mathPlan } from './math.js';
import { mathNumber } from './numbers.js';
import { morphBody2D } from './body-2d.js';
import { mathBodies } from './math-bodies.js';
import { mathSemantics } from './semantics.js';
import { describeObject } from '../scene-objects.js';
import { svg } from '../ink/dom.js';
import type { MathOperation, MathPart, MathMorphPlan } from './types.js';
import {
  morphTiming,
  mathMotionFrame,
  watchMotion,
  type MorphTime,
  type MorphCues,
} from './timing.js';

/** A flat section of the shared morph field, drawn by the existing pen and lettering owners. */
function mount(
  parent: HTMLElement,
  operation: MathOperation | MathMorphPlan,
  options: { id: string; pigment?: string; width?: number; height?: number; columns?: number },
) {
  validateCellColumns(options.columns);
  const prepared = mathPlan(operation);
  let width = options.width ?? 840,
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
  const viewport = contentViewport(parent);
  const formula = paragraph(sheet.layer, { size: 26 });
  formula.element.style.color = 'var(--ve-purple)';
  const stepLabel = lettering(sheet.layer, '', { size: 17, x: width / 2, y: height - 14 });
  const dimensions = [
    lettering(sheet.layer, '', { size: 20 }),
    lettering(sheet.layer, '', { size: 20 }),
  ];
  const notes = new Map<string, ReturnType<typeof lettering>>();
  const semantics = mathSemantics(options.id, 'src/morph/svg.ts', () => configured);
  // Transparent logical regions share the body coordinates and the common scene selection.
  // Sibling targets retain keyboard access instead of nesting buttons inside the root object.
  const semanticLayer = svg('g'),
    semanticRoot = svg('rect', { 'data-object': options.id, fill: 'transparent' });
  sheet.element.setAttribute('role', 'group');
  semanticLayer.append(semanticRoot);
  sheet.layer.append(semanticLayer);
  const rootMeaning = describeObject(semanticRoot, semantics.meaning);
  const parts = new Map<string, { element: SVGRectElement; dispose(): void }>();
  function clearParts() {
    for (const part of parts.values()) {
      part.dispose();
      part.element.remove();
    }
    parts.clear();
    semantics.clear();
  }
  function prepareSemantics() {
    for (let stage = 0; stage < plan.stages; stage++)
      semantics.update(plan.sample(stage / plan.stages));
  }
  let plan = prepared;
  let currentFrame: ReturnType<typeof plan.sample> | undefined;
  let configured = operation;
  const inspected = sheet.element as SVGSVGElement & { __visualReview?: () => unknown };
  inspected.setAttribute('data-review-id', options.id);
  inspected.__visualReview = () => ({
    source: 'src/morph/svg.ts',
    operation: configured,
    progress: latest,
    frame: currentFrame,
  });
  let scale = 1,
    disposed = false,
    latest = 0;
  let lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  let arrangement: ReturnType<typeof cellLayout> | undefined,
    layoutKey = '';
  let headingSpace = 36;
  function setOperation(next: MathOperation | MathMorphPlan) {
    if (disposed) throw new Error('Math morph has been disposed');
    const prepared = mathPlan(next);
    clearParts();
    plan = prepared;
    configured = next;
    layoutKey = '';
    prepareSemantics();
    render(0);
  }
  function render(input: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const time = morphTiming(input, cues, plan.stages),
      progress = time.progress;
    const available = Math.round(parent.getBoundingClientRect().width);
    if (plan.encoding !== 'quantity') {
      width = Math.max(180, available || width);
      if (!arrangement || `${width}` !== layoutKey) {
        arrangement = cellLayout(plan, width, options.columns);
        layoutKey = `${width}`;
        headingSpace = 36;
        for (let stage = 0; stage < plan.stages; stage++)
          for (const p of [0, 1 - 1e-12]) {
            const text = plan.sample((stage + p) / plan.stages).formula;
            headingSpace = Math.max(headingSpace, formula.render(text, width - 32, width / 2, 34));
          }
      }
    } else {
      arrangement = undefined;
      width = options.width ?? 840;
      height = options.height ?? 360;
    }
    const frame = mathMotionFrame(plan, time, arrangement?.columns);
    lastTime = input;
    lastCues = cues;
    currentFrame = frame;
    latest = progress;
    semantics.update(frame);
    for (const [id, record] of semantics.parts) {
      if (!parts.has(id)) {
        const element = svg('rect', { 'data-object': id, fill: 'transparent' });
        semanticLayer.append(element);
        parts.set(id, { element, dispose: describeObject(element, record.meaning) });
      }
      const element = parts.get(id)!.element;
      element.style.display = record.visible ? '' : 'none';
      element.setAttribute('aria-label', record.meaning.label);
    }
    if (!parent.getClientRects().length) return frame;
    formula.render(frame.formula, width - 32, width / 2, 34);
    const headingHeight = arrangement ? headingSpace : 36;
    if (arrangement) {
      height = arrangement.height + Math.max(0, headingHeight - 36);
    }
    sheet.resize(width, height);
    viewport.resize(arrangement ? height : undefined);
    const [min, max] = arrangement?.bounds ?? quantityBounds(plan, frame);
    const center = arrangement?.center ?? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    scale =
      arrangement?.scale ??
      Math.min((width - 72) / (max[0] - min[0]), (height - 150) / (max[1] - min[1]));
    const cy = height / 2 + headingHeight / 2;
    semanticRoot.setAttribute('width', String(width));
    semanticRoot.setAttribute('height', String(height));
    for (const [id, record] of semantics.parts) {
      if (!record.visible) continue;
      const part = record.part,
        size = [part.size[0] * (part.scale?.[0] ?? 1), part.size[1] * (part.scale?.[1] ?? 1)],
        element = parts.get(id)!.element;
      element.setAttribute(
        'x',
        String(width / 2 + (part.position[0] - center[0]! - size[0]! / 2) * scale),
      );
      element.setAttribute(
        'y',
        String(cy - (part.position[1] - center[1]! + size[1]! / 2) * scale),
      );
      element.setAttribute('width', String(size[0]! * scale));
      element.setAttribute('height', String(size[1]! * scale));
    }
    const transform = (part: MathPart) => ({
      x: width / 2 + (part.position[0] - center[0]! - part.size[0] / 2) * scale,
      y: cy - (part.position[1] - center[1]! + part.size[1] / 2) * scale,
      w: part.size[0] * scale,
      h: part.size[1] * scale,
    });
    const active =
      plan.encoding === 'quantity' ? (frame.morph >= 0.5 ? frame.targets : frame.sources) : [];
    body.render(
      mathBodies(frame, plan.encoding === 'quantity'),
      width / 2 - center[0]! * scale,
      cy + center[1]! * scale,
      scale,
    );
    const steps = new Set(active.map(quantityStep));
    stepLabel.at(width / 2, height - 14);
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
        `translate(${width / 2 + (note.position[0] - center[0]!) * scale - (label.width * fit) / 2} ${cy - (note.position[1] - center[1]!) * scale + 9 * fit}) scale(${fit})`,
      );
      label.element.style.opacity = String(note.opacity);
    }
    return frame;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    viewport.dispose();
    unwatchMotion();
    formula.dispose();
    stepLabel.dispose();
    dimensions.forEach((l) => l.dispose());
    notes.forEach((l) => l.dispose());
    body.dispose();
    clearParts();
    rootMeaning();
    sheet.dispose();
  }
  const refresh = () => render(lastTime, lastCues);
  const observer = new ResizeObserver(refresh);
  const unwatchMotion = watchMotion(refresh);
  observer.observe(parent);
  try {
    prepareSemantics();
    render(0);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    element: sheet.element,
    render,
    setOperation,
    dispose,
    get plan() {
      return plan;
    },
    get progress() {
      return latest;
    },
  };
}
export const MathMorph2D = { mount };
