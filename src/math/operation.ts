import * as T from '../viewport/engine.js';
import type { Viewport } from '../viewport/three.js';
import { TensorData, formatNumber } from './tensor-data.js';
import { TensorView, measureCells } from './tensor.js';
import { transfer } from './transfer.js';
export type VectorOperation = 'add' | 'multiply' | 'dot';
export function operationState(
  a: readonly number[],
  b: readonly number[],
  kind: VectorOperation,
  progress: number,
) {
  if (a.length !== b.length || !a.length || [...a, ...b, progress].some((v) => !Number.isFinite(v)))
    throw new Error('Operations need two equally sized finite vectors and finite progress');
  const p = Math.max(0, Math.min(1, progress)),
    index = Math.min(a.length - 1, Math.floor(p * a.length)),
    phase = p === 1 ? 1 : p * a.length - index;
  const contributions = a.map((v, i) => (kind === 'add' ? v + b[i]! : v * b[i]!));
  const arrived = phase >= 0.92,
    completed = index + Number(arrived);
  return {
    index,
    phase,
    completed,
    contributions,
    result: kind === 'dot' ? [contributions.reduce((s, v) => s + v, 0)] : contributions,
    partial: contributions.slice(0, completed).reduce((s, v) => s + v, 0),
  };
}
export interface OperationOptions {
  id: string;
  kind: VectorOperation;
  a: readonly number[];
  b: readonly number[];
  labels?: { a?: string; b?: string; result?: string };
}
const portion = (p: number, a: number, b: number) => {
  const q = Math.max(0, Math.min(1, (p - a) / (b - a)));
  return q * q * (3 - 2 * q);
};
/** Operands remain at their sources; one pair is explained in a reserved work area. */
export function vectorOperation(view: Viewport, options: OperationOptions) {
  const initial = operationState(options.a, options.b, options.kind, 0),
    n = options.a.length;
  const group = new T.Group();
  group.name = options.id;
  const partials = initial.contributions.map((_, i) =>
    initial.contributions.slice(0, i + 1).reduce((sum, v) => sum + v, 0),
  );
  const measure = measureCells(view.stage, [
    ...options.a,
    ...options.b,
    ...initial.result,
    ...initial.contributions,
    ...(options.kind === 'dot' ? partials : []),
  ]);
  const previousHeight = view.stage.style.minHeight;
  const make = (id: string, values: readonly number[], title: string, tone: string) => {
    const tensor = new TensorView(view, new TensorData([values.length], values, ['координата']), {
      id: `${options.id}:${id}`,
      title,
      tone,
      width: measure.width,
    });
    group.add(tensor.group);
    return tensor;
  };
  const a = make('a', options.a, options.labels?.a ?? 'первый вектор', 'blue');
  const b = make('b', options.b, options.labels?.b ?? 'второй вектор', 'orange');
  const output = make(
    'result',
    initial.result,
    options.labels?.result ?? (options.kind === 'dot' ? 'сумма вкладов' : 'результат'),
    'purple',
  );
  const widest = (values: readonly number[]) =>
    values.reduce((a, b) => (formatNumber(a).length >= formatNumber(b).length ? a : b), values[0]!);
  const left = make('left', [widest(options.a)], '', 'blue'),
    right = make('right', [widest(options.b)], '', 'orange');
  const product = make('product', [widest(initial.contributions)], '', 'purple');
  const stage = new T.Group();
  group.add(stage);
  const slot = (x: number) => {
    const m = new T.Mesh(
      new T.BoxGeometry(Math.max(left.cellWidth, right.cellWidth), 1, 0.05),
      new T.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 }),
    );
    m.position.x = x;
    m.userData.labelOccluder = false;
    stage.add(m);
    return m;
  };
  const spacing = measure.width / 2 + 0.45;
  const leftSlot = slot(-spacing),
    rightSlot = slot(spacing),
    productSlot = slot(0);
  productSlot.position.y = -2;
  const world = (object: T.Object3D) => object.getWorldPosition(new T.Vector3());
  let state = initial,
    lastProgress = 0,
    lastReduced = false;
  const trips = new Map<number, ReturnType<typeof transfer>[]>();
  const placement = new T.Matrix4();
  const symbol = view.label(options.kind === 'add' ? '+' : '×', () => world(stage), {
    id: `${options.id}:operator`,
    size: 30,
    placement: 'fixed',
    tone: 'ink',
    visible: () => group.visible && state.phase >= 0.35 && state.phase < 0.92,
    priority: () => 150,
  });
  const resultSign = view.label('=', () => world(stage).add(new T.Vector3(0, -1, 0.5)), {
    id: `${options.id}:equals`,
    size: 26,
    placement: 'fixed',
    visible: () => group.visible && state.phase >= 0.52 && state.phase < 0.92,
    priority: () => 150,
  });
  const arithmetic = view.label('', () => world(stage).add(new T.Vector3(0, -3.3, 0.5)), {
    id: `${options.id}:arithmetic`,
    size: 20,
    wrap: () => view.stage.clientWidth - 32,
    tone: 'purple',
    visible: () => group.visible && options.kind === 'dot' && state.phase >= 0.52,
    priority: () => 150,
  });
  const carriers = [...left.cells, ...right.cells, ...product.cells].map((c) => c.mesh);
  const aRoutes = a.cells.map((c) =>
    view.connect(c.mesh, leftSlot, {
      tone: 'blue',
      gap: 2,
      ignore: carriers,
      visible: () =>
        group.visible && c.index === state.index && state.phase >= 0.05 && state.phase < 0.35,
    }),
  );
  const bRoutes = b.cells.map((c) =>
    view.connect(c.mesh, rightSlot, {
      tone: 'orange',
      gap: 2,
      ignore: carriers,
      visible: () =>
        group.visible && c.index === state.index && state.phase >= 0.05 && state.phase < 0.35,
    }),
  );
  const routes = [...aRoutes, ...bRoutes];
  function layout() {
    trips.clear();
    const columns = Math.min(
      n,
      4,
      Math.max(1, Math.floor((view.stage.clientWidth - 56) / (2 * (measure.minimum + 12)))),
    );
    a.layout(columns);
    b.layout(columns);
    output.layout(options.kind === 'dot' ? 1 : columns * 2);
    const width = columns * (a.cellWidth + b.cellWidth) + 0.75,
      rows = Math.ceil(n / columns);
    a.group.position.set(-width / 2 + (columns * a.cellWidth) / 2, rows / 2 + 3.3, 0);
    b.group.position.set(width / 2 - (columns * b.cellWidth) / 2, rows / 2 + 3.3, 0);
    stage.position.set(0, 1.2, 0.3);
    const outRows = options.kind === 'dot' ? 1 : Math.ceil(n / (columns * 2));
    const accumulationSpace = options.kind === 'dot' ? 1.4 : 0;
    output.group.position.set(0, -2.9 - outRows / 2 - accumulationSpace, 0);
    const height = Math.ceil((rows + outRows + 6.2 + accumulationSpace) * 56 + 90);
    if (view.stage.style.minHeight !== `${height}px`) view.stage.style.minHeight = `${height}px`;
    render(lastProgress, lastReduced);
  }
  function render(progress: number, reduced = false) {
    lastProgress = progress;
    lastReduced = reduced;
    state = operationState(options.a, options.b, options.kind, progress);
    const { index, phase, completed } = state;
    a.highlight(index);
    b.highlight(index);
    output.highlight(phase >= 0.92 ? (options.kind === 'dot' ? 0 : index) : -1);
    left.setValues([options.a[index]!]);
    right.setValues([options.b[index]!]);
    product.setValues([state.contributions[index]!]);
    const move = portion(phase, 0, 0.35),
      leaving = portion(phase, 0.63, 0.92);
    group.updateWorldMatrix(true, true);
    if (!placement.equals(group.matrixWorld)) {
      placement.copy(group.matrixWorld);
      trips.clear();
    }
    const local = (p: T.Vector3) => group.worldToLocal(p);
    const destination = output.cells[options.kind === 'dot' ? 0 : index]!.mesh;
    if (!trips.has(index)) {
      const solids = [...a.cells, ...b.cells, ...output.cells].map((c) => c.mesh);
      const plan = (from: T.Object3D, to: T.Object3D) =>
        transfer(
          world(from).add(new T.Vector3(0, 0, 0.4)),
          world(to).add(new T.Vector3(0, 0, 0.4)),
          solids.filter((o) => o !== from && o !== to),
          measure.width,
        );
      trips.set(index, [
        plan(a.cells[index]!.mesh, leftSlot),
        plan(b.cells[index]!.mesh, rightSlot),
        plan(productSlot, destination),
      ]);
    }
    [left, right, product].forEach((actor, i) => {
      const pose = trips.get(index)![i]!(i === 2 ? (reduced ? 0 : leaving) : reduced ? 1 : move);
      actor.group.position.copy(local(pose.position));
      actor.group.scale.setScalar(pose.scale);
      actor.cells[0]!.lettering =
        reduced || (i === 2 ? phase < 0.63 || pose.lettering : pose.lettering);
    });
    left.show(phase > (reduced ? 0.35 : 0) && phase < 0.92);
    right.show(phase > (reduced ? 0.35 : 0) && phase < 0.92);
    product.show(phase >= 0.52 && phase < 0.92);
    if (options.kind === 'dot') {
      output.setValues([state.partial]);
      output.pendingCell(0, completed === 0 || (phase >= 0.84 && phase < 0.92));
      arithmetic.element.textContent = `${formatNumber(state.contributions.slice(0, index).reduce((s, v) => s + v, 0))} + (${formatNumber(state.contributions[index]!)})${phase >= 0.92 ? ` = ${formatNumber(state.partial)}` : ''}`;
    } else {
      output.cells.forEach((c) => output.pendingCell(c.index, c.index >= completed));
      arithmetic.element.textContent = `${formatNumber(options.a[index]!)} ${options.kind === 'add' ? '+' : '×'} (${formatNumber(options.b[index]!)}) = ${formatNumber(state.contributions[index]!)}`;
    }
    routes.forEach((r) => r.reveal(phase > 0 && !reduced ? 1 : 0));
    view.invalidate();
  }
  layout();
  const stopResize = view.onResize(layout);
  return {
    group,
    a,
    b,
    output,
    work: stage,
    framing: [a.framing, b.framing, output.framing, stage],
    render,
    snapshot: () => ({
      kind: options.kind,
      index: state.index,
      phase: state.phase,
      completed: state.completed,
      visibleResult:
        options.kind === 'dot'
          ? state.completed
            ? [state.partial]
            : []
          : initial.result.slice(0, state.completed),
    }),
    dispose() {
      stopResize();
      view.stage.style.minHeight = previousHeight;
      routes.forEach((r) => r.dispose());
      [symbol, resultSign, arithmetic].forEach((l) => l.remove());
      [a, b, output, left, right, product].forEach((t) => t.dispose());
      view.release(stage);
      stage.removeFromParent();
      group.removeFromParent();
    },
  };
}
