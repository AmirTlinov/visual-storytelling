import {
  Box3,
  Vector3,
  Group,
  Object3D,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicMaterial,
} from 'three';
import type { Viewport3D } from '../viewport/three.js';
import { quantityBounds, quantityStep } from './measure.js';
import { morphBody3D } from './body-3d.js';
import { mathBodies } from './math-bodies.js';
import { mathPlan } from './math.js';
import { mathNumber } from './numbers.js';
import { cellLayout, validateCellColumns } from './layout.js';
import { contentViewport } from '../layout/content.js';
import type { MathOperation, MathMorphPlan, MathPart } from './types.js';
import {
  morphTiming,
  mathMotionFrame,
  watchMotion,
  type MorphTime,
  type MorphCues,
} from './timing.js';

/** One shared field with attached inscriptions, for quantities and symbolic number cells. */
function mount(
  view: ReturnType<typeof Viewport3D.mount>,
  operation: MathOperation | MathMorphPlan,
  options: {
    /** Stable namespace when several mathematical operations share a viewport. */
    id?: string;
    pigment?: string;
    /** Embedded operations keep their host's authored size; standalone content fits its rows. */
    layout?: 'scene' | 'content';
    /** Maximum cells per row. Omit to adapt the row count to the viewport. */
    columns?: number;
  } = {},
) {
  validateCellColumns(options.columns);
  const prepared = mathPlan(operation);
  const object = new Group(),
    bounds = new Box3();
  const body = morphBody3D(view, options),
    volume = body.surface;
  object.add(volume.object);
  let plan: MathMorphPlan = prepared,
    disposed = false;
  let progress = 0;
  const stage = view.renderer.domElement.parentElement!;
  const viewport = options.layout === 'scene' ? undefined : contentViewport(stage);
  let arrangement: ReturnType<typeof cellLayout> | undefined,
    layoutWidth = 0;
  let lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  let currentFrame: ReturnType<typeof plan.sample> | undefined;
  let configured = operation;
  object.userData.visualReview = () => ({
    source: 'src/morph/three.ts',
    operation: configured,
    progress,
    frame: currentFrame,
  });
  const id = options.id ?? 'math-morph';
  const originIds = new Map<string, string>();
  const parts = new Map<
    string,
    { object: Object3D; part: MathPart; visible: boolean; dispose(): void }
  >();
  const rootMeaning = view.describe(
    object,
    id,
    {
      label: 'Математическое преобразование',
      value: () => currentFrame?.result,
      source: { file: 'src/morph/three.ts' },
      inputs: () => [...new Set(originIds.values())],
      provenance: () =>
        currentFrame && {
          formula: currentFrame.formula,
          stage: currentFrame.stage,
          phase: currentFrame.phase,
          result: currentFrame.result,
          sources: currentFrame.sources.map((part) => ({
            id: part.id && `${id}:${part.id}`,
            value: part.value,
            origins: part.origins,
          })),
          targets: currentFrame.targets.map((part) => ({
            id: part.id && `${id}:${part.id}`,
            value: part.value,
            origins: part.origins,
          })),
        },
    },
    { bounds: () => bounds.clone().applyMatrix4(object.matrixWorld) },
  );
  function clearParts() {
    for (const part of parts.values()) {
      part.dispose();
      part.object.removeFromParent();
    }
    parts.clear();
    originIds.clear();
  }
  function describeParts(frame: NonNullable<typeof currentFrame>) {
    for (const record of parts.values()) record.visible = false;
    const visible = new Set(
      (frame.morph < 0.5 ? frame.sources : frame.targets).map((part) => part.id),
    );
    for (const part of [...frame.sources, ...frame.targets]) {
      if (!part.id) continue;
      const key = `${id}:${part.id}`;
      if (!parts.has(key)) {
        const anchor = new Object3D();
        object.add(anchor);
        const record = { object: anchor, part, visible: false, dispose: () => {} };
        parts.set(key, record);
        for (const origin of part.origins ?? []) {
          const originKey = `${origin.operand}:${origin.index}`;
          if (!originIds.has(originKey) && part.origins?.length === 1)
            originIds.set(originKey, key);
        }
        record.dispose = view.describe(
          anchor,
          key,
          {
            get label() {
              return `Величина ${mathNumber(record.part.value)}`;
            },
            value: () => record.part.value,
            source: { file: 'src/morph/three.ts' },
            inputs: () => [
              ...new Set(
                (record.part.origins ?? []).flatMap((origin) => {
                  const source = originIds.get(`${origin.operand}:${origin.index}`);
                  return source && source !== key ? [source] : [];
                }),
              ),
            ],
            provenance: () => ({
              origins: record.part.origins ?? [],
              formula: currentFrame?.formula,
              stage: currentFrame?.stage,
            }),
          },
          {
            visible: () => record.visible,
            bounds: () => {
              const part = record.part,
                scale = part.scale ?? [1, 1, 1];
              const size = new Vector3(...part.size).multiply(new Vector3(...scale));
              return new Box3()
                .setFromCenterAndSize(new Vector3(...part.position), size)
                .applyMatrix4(object.matrixWorld);
            },
          },
        );
      }
      const record = parts.get(key)!;
      record.part = part;
      record.visible = visible.has(part.id);
      record.object.position.set(...part.position);
    }
  }
  const notes = new Map<string, { anchor: Object3D; label: ReturnType<typeof view.label> }>();
  const ruler = new LineSegments(
    new BufferGeometry(),
    view.ink(new LineBasicMaterial({ transparent: true, opacity: 0.3 }), 'ink'),
  );
  object.add(ruler);
  const formulaAnchor = new Object3D();
  object.add(formulaAnchor);
  // The equation is a reading aid above the material; the numbers on the body
  // remain physical strokes. Camera distance must not shrink the equation.
  const formula = view.label('', formulaAnchor, { tone: 'purple', size: 26 });
  formula.element.style.whiteSpace = 'normal';
  formula.element.style.textAlign = 'center';
  const dimensions = [new Object3D(), new Object3D()];
  dimensions.forEach((a) => object.add(a));
  const dimensionLabels = dimensions.map((a) => view.label('', a, { tone: 'ink', size: 20 }));
  const stepAnchor = new Object3D();
  object.add(stepAnchor);
  const stepLabel = view.label('', stepAnchor, { tone: 'ink', size: 17 });
  let rulerKey = '';
  function clear() {
    for (const { anchor, label } of notes.values()) {
      label.remove();
      anchor.removeFromParent();
    }
    notes.clear();
  }
  function setOperation(next: MathOperation | MathMorphPlan) {
    if (disposed) throw new Error('Math morph has been disposed');
    const prepared = mathPlan(next); // Validate before replacing the visible operation.
    clear();
    clearParts();
    plan = prepared;
    configured = next;
    layoutWidth = 0;
    prepare();
    render(0);
  }
  function prepare() {
    volume.prepare(
      Array.from({ length: plan.stages }, (_, stage) => {
        const frame = plan.sample(stage / plan.stages);
        return { sources: frame.sources.length, targets: frame.targets.length };
      }),
    );
  }
  function render(input: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const time = morphTiming(input, cues, plan.stages),
      p = time.progress;
    const widthAvailable = stage.clientWidth || layoutWidth || 640;
    if (plan.encoding !== 'quantity') {
      if (!arrangement || widthAvailable !== layoutWidth) {
        arrangement = cellLayout(plan, widthAvailable, options.columns);
        layoutWidth = widthAvailable;
        viewport?.resize(arrangement.height + 64);
      }
    } else {
      arrangement = undefined;
      viewport?.resize();
    }
    const frame = mathMotionFrame(plan, time, arrangement?.columns);
    formula.element.style.maxWidth = `${Math.max(160, widthAvailable - 64)}px`;
    formula.set(frame.formula);
    lastTime = input;
    lastCues = cues;
    currentFrame = frame;
    describeParts(frame);
    progress = p;
    const [min, max] = arrangement?.bounds ?? quantityBounds(plan, frame);
    bounds.set(new Vector3(...min), new Vector3(...max));
    const width = max[0] - min[0],
      height = max[1] - min[1],
      extent = Math.max(width, height),
      gap = plan.encoding !== 'quantity' ? 0.6 : Math.max(0.7, extent * 0.12);
    formulaAnchor.position.set((min[0] + max[0]) / 2, max[1] + gap * 1.4, 0);
    const key = [...min, ...max].join(',');
    if (plan.encoding === 'quantity' && key !== rulerKey) {
      const ticks: number[] = [],
        y = min[1] - gap / 2,
        step = Math.max(1, 10 ** Math.ceil(Math.log10(width / 32)));
      ticks.push(min[0], y, 0.52, max[0], y, 0.52);
      for (let x = Math.ceil(min[0] / step) * step; x <= max[0]; x += step)
        ticks.push(x, y - 0.06, 0.52, x, y + 0.06, 0.52);
      ruler.geometry.dispose();
      ruler.geometry = new BufferGeometry();
      ruler.geometry.setAttribute('position', new Float32BufferAttribute(ticks, 3));
      rulerKey = key;
    }
    const measured = plan.encoding === 'quantity';
    ruler.visible = measured;
    const active = measured ? (frame.morph < 0.5 ? frame.sources : frame.targets) : [];
    const steps = new Set<number>();
    for (const part of active) steps.add(quantityStep(part));
    const coarse = [...steps].some((step) => step > 1);
    stepLabel.show(coarse);
    if (coarse) {
      stepLabel.set(
        `${steps.size === 1 ? 'Шаг сетки' : 'Шаги сетки'}: ${[...steps]
          .sort((a, b) => a - b)
          .map(mathNumber)
          .join(', ')}`,
      );
      stepAnchor.position.set((min[0] + max[0]) / 2, min[1] - gap * 1.1, 0.52);
    }
    const single = active.length === 1 ? active[0] : undefined;
    dimensionLabels.forEach((l) => l.show(!!single && single.size[1] > 1.01));
    if (single && single.size[1] > 1.01) {
      dimensions[0]!.position.set(
        single.position[0],
        single.position[1] + single.size[1] / 2 + gap * 0.25,
        0.52,
      );
      dimensions[1]!.position.set(
        single.position[0] - single.size[0] / 2 - gap,
        single.position[1],
        0.52,
      );
      dimensionLabels[0]!.set(mathNumber(single.size[0]));
      dimensionLabels[1]!.set(mathNumber(single.size[1]));
    }
    bounds.min.y -= gap * (plan.encoding !== 'quantity' ? 0.2 : coarse ? 1.8 : 1);
    bounds.max.y += gap * 2.2;
    bounds.min.x -= gap * 1.6;
    bounds.max.x += gap * 0.6;
    body.render(mathBodies(frame, measured));
    const currentNotes = new Set((frame.notes ?? []).map((note) => note.id));
    for (const [id, note] of notes)
      if (!currentNotes.has(id)) {
        note.label.remove();
        note.anchor.removeFromParent();
        notes.delete(id);
      }
    for (const note of frame.notes ?? []) {
      if (!notes.has(note.id)) {
        const anchor = new Object3D();
        object.add(anchor);
        notes.set(note.id, {
          anchor,
          label: view.label('', anchor, {
            space: 'world',
            height: note.size[1],
            maxWidth: note.size[0],
          }),
        });
      }
      const entry = notes.get(note.id)!;
      entry.anchor.position.set(...note.position);
      entry.label.set(note.text);
      entry.label.opacity(note.opacity);
    }
    view.invalidate();
    return frame;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    unwatchMotion();
    resizeObserver.disconnect();
    viewport?.dispose();
    clear();
    clearParts();
    rootMeaning();
    volume.dispose();
    formula.remove();
    dimensionLabels.forEach((l) => l.remove());
    stepLabel.remove();
    ruler.geometry.dispose();
    ruler.material.dispose();
    object.removeFromParent();
    off();
    offRemove();
  }
  const off = view.onDispose(dispose);
  const refresh = () => render(lastTime, lastCues);
  const unwatchMotion = watchMotion(refresh);
  const resizeObserver = new ResizeObserver(refresh);
  resizeObserver.observe(stage);
  const offRemove = view.beforeRemove((root) => {
    for (let p: Object3D | null = object; p; p = p.parent)
      if (p === root) {
        dispose();
        break;
      }
  });
  try {
    prepare();
    render(0);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    object,
    bounds,
    render,
    setOperation,
    dispose,
    get surface() {
      return volume;
    },
    get plan() {
      return plan;
    },
    get progress() {
      return progress;
    },
  };
}
export const MathMorph3D = { mount };
