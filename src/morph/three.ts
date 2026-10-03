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
import { frameBounds, quantityGrid } from './measure.js';
import { VolumeMorph } from '../viewport/morph/surface.js';
import {
  mathPlan,
  mathNumber,
  type MathOperation,
  type MathMorphPlan,
  type MathPart,
} from './math.js';

/** A measured arithmetic operation: one volume field, attached inscriptions and a fixed unit scale. */
function mount(
  view: ReturnType<typeof Viewport3D.mount>,
  operation: MathOperation,
  options: { pigment?: string } = {},
) {
  mathPlan(operation);
  const object = new Group(),
    bounds = new Box3();
  const volume = VolumeMorph.mount(view, { pigment: options.pigment });
  object.add(volume.object);
  let plan: MathMorphPlan,
    disposed = false;
  let topology = '',
    progress = 0;
  const annotations: Array<{ anchor: Object3D; label: ReturnType<typeof view.label> }> = [];
  const ruler = new LineSegments(
    new BufferGeometry(),
    view.ink(new LineBasicMaterial({ transparent: true, opacity: 0.3 }), 'ink'),
  );
  object.add(ruler);
  const formulaAnchor = new Object3D();
  object.add(formulaAnchor);
  const formula = view.label('', formulaAnchor, { tone: 'purple', size: 26 });
  const dimensions = [new Object3D(), new Object3D()];
  dimensions.forEach((a) => object.add(a));
  const dimensionLabels = dimensions.map((a) => view.label('', a, { tone: 'ink', size: 20 }));
  const stepAnchor = new Object3D();
  object.add(stepAnchor);
  const stepLabel = view.label('', stepAnchor, { tone: 'ink', size: 17 });
  const gridGeometry = new BufferGeometry(),
    gridData = new Float32Array(10000 * 6);
  gridGeometry.setAttribute('position', new Float32BufferAttribute(gridData, 3));
  gridGeometry.setDrawRange(0, 0);
  const grid = new LineSegments(
    gridGeometry,
    view.ink(new LineBasicMaterial({ transparent: true, opacity: 0.2 }), 'ink'),
  );
  grid.frustumCulled = false;
  object.add(grid);
  let rulerKey = '';
  function clear() {
    annotations.splice(0).forEach(({ anchor, label }) => {
      label.remove();
      anchor.removeFromParent();
    });
    topology = '';
  }
  function setOperation(next: MathOperation) {
    if (disposed) throw new Error('Math morph has been disposed');
    const prepared = mathPlan(next); // Validate before replacing the visible operation.
    clear();
    plan = prepared;
    render(0);
  }
  function render(p: number) {
    if (disposed) return;
    const frame = plan.sample(p);
    progress = p;
    const parts = [...frame.sources, ...frame.targets];
    const [min, max] = frameBounds(plan, frame);
    bounds.set(new Vector3(...min), new Vector3(...max));
    const width = max[0] - min[0],
      height = max[1] - min[1],
      extent = Math.max(width, height),
      gap = Math.max(0.7, extent * 0.12);
    formulaAnchor.position.set((min[0] + max[0]) / 2, max[1] + gap * 1.4, 0);
    const key = [...min, ...max].join(',');
    if (key !== rulerKey) {
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
    const active = frame.morph < 0.5 ? frame.sources : frame.targets;
    const steps = new Set<number>();
    let at = 0;
    for (const part of active) {
      const grid = quantityGrid(part);
      steps.add(grid.step);
      for (const line of grid.lines) {
        gridData.set(line.from, at);
        gridData.set(line.to, at + 3);
        at += 6;
      }
    }
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
    const attribute = gridGeometry.attributes.position!;
    (attribute.array as Float32Array).set(gridData.subarray(0, at));
    attribute.needsUpdate = true;
    gridGeometry.setDrawRange(0, at / 3);
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
    bounds.min.y -= gap * (coarse ? 1.8 : 1);
    bounds.max.y += gap * 2.2;
    bounds.min.x -= gap * 1.6;
    bounds.max.x += gap * 0.6;
    const next = `${frame.sources.length}:${frame.targets.length}`;
    if (next !== topology) {
      annotations.splice(0).forEach(({ anchor, label }) => {
        label.remove();
        anchor.removeFromParent();
      });
      const box = VolumeMorph.box([1, 1, 1]);
      volume.setShapes(
        frame.sources.map(() => box),
        frame.targets.map(() => box),
      );
      parts.forEach(() => {
        const anchor = new Object3D();
        object.add(anchor);
        const label = view.label('', anchor, {
          space: 'world',
          height: 1,
        });
        annotations.push({ anchor, label });
      });
      topology = next;
    }
    const pose = (part: MathPart) => ({ position: part.position, scale: part.size });
    volume.render({
      sources: frame.sources.map(pose),
      targets: frame.targets.map(pose),
      morph: frame.morph,
      tension: 0,
    });
    parts.forEach((part, i) => {
      const { anchor, label } = annotations[i]!;
      anchor.position.set(
        part.position[0],
        part.position[1],
        part.position[2] + part.size[2] / 2 + 0.004,
      );
      const value = mathNumber(part.value);
      // One physical size follows the frame and fits the current face, including after growth.
      anchor.scale.setScalar(
        Math.min(
          Math.max(0.42, extent * 0.12),
          part.size[1] * 0.62,
          (part.size[0] * 0.88) / Math.max(0.7, value.length * 0.5),
        ),
      );
      label.set(value);
      label.opacity(i < frame.sources.length ? frame.sourceOpacity : frame.targetOpacity);
    });
    formula.set(frame.formula);
    view.invalidate();
    return frame;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
    volume.dispose();
    formula.remove();
    dimensionLabels.forEach((l) => l.remove());
    stepLabel.remove();
    gridGeometry.dispose();
    grid.material.dispose();
    ruler.geometry.dispose();
    ruler.material.dispose();
    object.removeFromParent();
    off();
    offRemove();
  }
  const off = view.onDispose(dispose);
  const offRemove = view.beforeRemove((root) => {
    for (let p: Object3D | null = object; p; p = p.parent)
      if (p === root) {
        dispose();
        break;
      }
  });
  setOperation(operation);
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
