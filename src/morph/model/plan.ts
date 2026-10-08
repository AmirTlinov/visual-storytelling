import { stagedConstruction } from '../construction/plan.js';
import { number } from '../construction/geometry.js';
import type {
  ConstructionPlan,
  DiagramPanel,
  DiagramPoint,
  DiagramLabel,
} from '../construction/types.js';
import type { MathValue } from '../../math/value.js';
import {
  contextFor,
  read,
  snapshot,
  checkOwner,
  type MathState,
  type ModelContext,
} from './values.js';
import type { Coordinate, Explanation, ModelObject } from './types.js';
import { curveParameters, interiorProbes } from './curve.js';

function finite(value: MathValue): void {
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value) && value.length) {
    value.forEach(finite);
    return;
  }
  throw new Error('A mathematical state needs finite numbers or nonempty tensors');
}
function interpolate(a: MathValue, b: MathValue, t: number): MathValue {
  if (typeof a === 'number' && typeof b === 'number') return a * (1 - t) + b * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    return a.map((v, i) => interpolate(v, b[i]!, t));
  throw new Error('A mathematical transition must preserve the shape of each parameter');
}
function coordinate(value: Coordinate): DiagramPoint {
  if (
    !Array.isArray(value) ||
    (value.length !== 2 && value.length !== 3) ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    (value.length === 3 && !Number.isFinite(value[2]))
  )
    throw new Error('A mathematical object must return two or three finite coordinates');
  return value.length === 2 ? [value[0]!, value[1]!] : [value[0]!, value[1]!, value[2]!];
}
const center = (points: readonly DiagramPoint[]): DiagramPoint =>
  Array.from(
    { length: points.some((p) => p.length === 3) ? 3 : 2 },
    (_, axis) => points.reduce((sum, point) => sum + (point[axis] ?? 0), 0) / points.length,
  ) as unknown as DiagramPoint;

/** Compiles relationships, not a catalogue of mathematical subjects. */
export function compileModel<S extends MathState>(
  initial: S,
  explanation: Explanation<S>,
  owner: symbol,
): ConstructionPlan {
  explanation = snapshot(explanation);
  if (!explanation.steps.length || !explanation.panels.length)
    throw new Error('An explanation needs at least one panel and one step');
  const states: Readonly<S>[] = [snapshot(initial)];
  Object.values(initial).forEach(finite);
  for (const step of explanation.steps) {
    for (const key of Object.keys(step.to)) {
      if (!(key in initial)) throw new Error(`Unknown mathematical parameter: ${key}`);
      finite(step.to[key]!);
      interpolate(initial[key]!, step.to[key]!, 0.5);
    }
    checkOwner(owner, step.formula);
    states.push(snapshot({ ...states.at(-1)!, ...step.to } as S));
  }
  checkOwner(owner, explanation.result);
  const stateAt = (stage: number, progress: number) =>
    snapshot(
      Object.fromEntries(
        Object.keys(initial).map((key) => [
          key,
          interpolate(states[stage]![key]!, states[stage + 1]![key]!, progress),
        ]),
      ) as S,
    );
  // Retain endpoints and midpoints, with nonuniform probes between them: a periodic
  // deformation must not disappear merely because its zeros coincide with key states.
  const moments = [
    0,
    ...Array.from({ length: 8 }, (_, i) =>
      [...interiorProbes, 1].map((fraction) => (i + fraction) / 8),
    ).flat(),
  ];
  const preparation = explanation.steps.flatMap((_, stage) =>
    moments.map((progress) => contextFor<S>(stateAt(stage, progress))),
  );
  const annotations: DiagramPanel[][] = preparation.map(() => []);
  const panels = explanation.panels.map((panel, index) => {
    if (panel.camera) {
      const { direction, up = [0, 1, 0] } = panel.camera;
      if (
        [direction, up].some(
          (v) => v.length !== 3 || !v.every(Number.isFinite) || Math.hypot(...v) === 0,
        )
      )
        throw new Error('A mathematical camera needs finite nonzero direction and up vectors');
    }
    if (!panel.objects.length) throw new Error('A mathematical panel needs visible objects');
    const ids = new Set<string>();
    for (const object of panel.objects) {
      if (ids.has(object.id))
        throw new Error('A mathematical object may appear only once in each panel');
      ids.add(object.id);
      checkOwner(owner, ...Object.values(object), ...Object.values(object.style));
      if (object.kind === 'polygon') {
        if (object.vertices.length < 3) throw new Error('A polygon needs at least three vertices');
        checkOwner(owner, ...object.vertices);
      }
      if (object.kind === 'curve') {
        const [a, b] = object.style.domain;
        if (
          object.style.domain.length !== 2 ||
          !Number.isFinite(a) ||
          !Number.isFinite(b) ||
          b <= a
        )
          throw new Error('A curve needs an increasing finite domain');
      }
      if (object.kind === 'material') {
        const [a, b] = object.style.domain;
        if (
          object.style.domain.length !== 2 ||
          !Array.isArray(a) ||
          !Array.isArray(b) ||
          a.length !== 2 ||
          b.length !== 2 ||
          ![...a, ...b].every(Number.isFinite) ||
          b.some((v, i) => v <= a[i]!)
        )
          throw new Error('A material needs an increasing finite 2D domain');
        if (
          object.style.grid &&
          (object.style.grid.length !== 2 ||
            object.style.grid.some((v) => !Number.isInteger(v) || v < 1 || v > 24))
        )
          throw new Error('A material grid needs two counts of 1…24 divisions');
      }
    }
    // Stable material/curve coordinates survive every frame. Authors never choose vertices or tessellation.
    const readers = panel.objects.map((object) =>
      prepare(object, preparation, panel.aspect !== 'free'),
    );
    let bounds: DiagramPoint[] = [],
      space = panel.space;
    const build = (context: ModelContext<S>, preparing = false): DiagramPanel => {
      const frame: DiagramPanel = {
        id: `panel-${index}`,
        title: panel.title,
        bounds: [bounds[0]!, bounds[1]!],
        aspect: panel.aspect,
        space,
        camera: panel.camera,
        paths: [],
        patches: [],
        labels: [],
        marks: [],
      };
      for (const reader of readers) reader(context, frame, preparing);
      return frame;
    };
    const locations = (frame: DiagramPanel) => [
      ...(frame.paths ?? []).flatMap((p) => p.points),
      ...(frame.marks ?? []).map((p) => p.at),
      ...(frame.labels ?? []).flatMap((p) => (p.to ? [p.at, p.to] : [p.at])),
      ...(frame.patches ?? []).flatMap((p) =>
        Array.from({ length: 13 }, (_, i) =>
          Array.from({ length: 13 }, (_, j) =>
            p.map([
              p.domain[0][0] + ((p.domain[1][0] - p.domain[0][0]) * i) / 12,
              p.domain[0][1] + ((p.domain[1][1] - p.domain[0][1]) * j) / 12,
            ]),
          ),
        ).flat(),
      ),
    ];
    const envelope: DiagramPoint[] = [];
    const prepared = preparation.map((context) => {
      const frame = build(context, true);
      envelope.push(...locations(frame));
      return frame;
    });
    const dimension = envelope.some((p) => p.length === 3) ? 3 : 2;
    space ??= dimension === 3 ? '3d' : '2d';
    if (space === '2d' && dimension === 3)
      throw new Error('Three-dimensional coordinates require a 3D panel');
    const extent = (points: readonly DiagramPoint[]) =>
      [0, 1].map(
        (end) =>
          Array.from({ length: space === '3d' ? 3 : 2 }, (_, axis) => {
            let value = end ? -Infinity : Infinity;
            for (const point of points)
              value = end ? Math.max(value, point[axis] ?? 0) : Math.min(value, point[axis] ?? 0);
            return value;
          }) as unknown as DiagramPoint,
      );
    bounds = extent(envelope);
    if (panel.bounds) {
      const [a, b] = panel.bounds.map(coordinate);
      if (a!.length !== b!.length || a!.some((v, i) => b![i]! <= v))
        throw new Error('A mathematical envelope needs increasing bounds');
      bounds = extent([...bounds, a!, b!]);
    }
    const frameBounds = (lo: DiagramPoint, hi: DiagramPoint): DiagramPanel['bounds'] => {
      const span = Math.max(...hi.map((v, i) => v - lo[i]!)) || 1;
      const padding = hi.map((v, i) => Math.max(span * 0.04, v - lo[i]!) * 0.12);
      return [
        lo.map((v, i) => v - padding[i]!),
        hi.map((v, i) => v + padding[i]!),
      ] as unknown as DiagramPanel['bounds'];
    };
    const preparedBounds = frameBounds(bounds[0]!, bounds[1]!);
    prepared.forEach((frame, i) =>
      annotations[i]!.push({
        ...frame,
        space,
        bounds: preparedBounds,
        paths: undefined,
        marks: undefined,
      }),
    );
    return (context: ModelContext<S>) => {
      const frame = build(context);
      const [lo, hi] = extent([...bounds, ...locations(frame)]);
      // Framing is independent of mathematical units.
      frame.bounds = frameBounds(lo!, hi!);
      if (panel.axes) {
        const paths = [...frame.paths!];
        for (let axis = 0; axis < (space === '3d' ? 3 : 2); axis++) {
          if (frame.bounds[0].some((v, i) => i !== axis && (v > 0 || frame.bounds[1][i]! < 0)))
            continue;
          const from = Array(space === '3d' ? 3 : 2).fill(0),
            to = [...from];
          from[axis] = frame.bounds[0][axis];
          to[axis] = frame.bounds[1][axis];
          paths.unshift({
            id: `axis-${axis}`,
            points: [coordinate(from), coordinate(to)],
            quiet: true,
            arrow: true,
          });
        }
        frame.paths = paths;
      }
      return frame;
    };
  });
  const result =
    explanation.result === undefined
      ? undefined
      : snapshot(read(explanation.result, contextFor<S>(states.at(-1)!)));
  if (result !== undefined) finite(result);
  return stagedConstruction(
    {
      stages: explanation.steps.length,
      result,
      sample(stage, progress) {
        const context = contextFor<S>(stateAt(stage, progress)),
          step = explanation.steps[stage]!;
        return {
          panels: panels.map((panel) => panel(context)),
          formula: step.formula === undefined ? '' : read(step.formula, context),
          explanation: step.explanation,
        };
      },
    },
    annotations,
  );
}

function prepare<S extends MathState>(
  object: ModelObject<S>,
  contexts: readonly ModelContext<S>[],
  equalAspect: boolean,
) {
  let curve: ReturnType<typeof curveParameters> | undefined;
  const preparedIndices = new Map(contexts.map((context, i) => [context, i]));
  if (object.kind === 'curve') {
    const maps = contexts.map((context) => object.map.read(context));
    curve = curveParameters(
      object.style.domain,
      (t) => maps.map((map) => coordinate(map(t))),
      equalAspect,
    );
  }
  return (context: ModelContext<S>, panel: DiagramPanel, preparing = false) => {
    const { id, style } = object,
      pigment = style.pigment ?? 'blue';
    const opacity = style.visible === undefined ? 1 : read(style.visible, context);
    if (!Number.isFinite(opacity)) throw new Error('Visibility must be finite');
    const alpha = Math.max(0, Math.min(1, opacity));
    const paths = panel.paths as NonNullable<DiagramPanel['paths']> extends readonly (infer T)[]
      ? T[]
      : never;
    const patches = panel.patches as NonNullable<
      DiagramPanel['patches']
    > extends readonly (infer T)[]
      ? T[]
      : never;
    const labels = panel.labels as DiagramLabel[];
    const marks = panel.marks as {
      id: string;
      at: DiagramPoint;
      opacity: number;
      pigment: typeof pigment;
    }[];
    let anchor: DiagramPoint | undefined;
    if (object.kind === 'point' || object.kind === 'label') {
      anchor = coordinate(object.at.read(context));
      if (object.kind === 'point') marks.push({ id, at: anchor, pigment, opacity: alpha });
    } else if (object.kind === 'vector' || object.kind === 'segment' || object.kind === 'measure') {
      const a = coordinate(object.from.read(context)),
        b = coordinate(object.to.read(context));
      anchor = object.kind === 'vector' ? b : center([a, b]);
      if (object.kind === 'measure') {
        labels.push({
          id,
          text:
            style.label === undefined
              ? `${number(
                  Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)),
                )}${object.unit ? ` ${object.unit}` : ''}`
              : read(style.label, context),
          at: a,
          to: b,
          side: style.side ?? (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'bottom' : 'right'),
          pigment,
          opacity: alpha,
        });
        return;
      }
      paths.push({
        id,
        points: [a, b],
        pigment,
        opacity: alpha,
        arrow: object.kind === 'vector',
        quiet: style.quiet,
        dashed: style.dashed,
      });
    } else if (object.kind === 'polygon' || object.kind === 'curve') {
      const map = object.kind === 'curve' ? object.map.read(context) : undefined;
      const points =
        object.kind === 'polygon'
          ? object.vertices.map((p) => coordinate(p.read(context)))
          : preparing
            ? curve!.bounds[preparedIndices.get(context)!]!.map(coordinate)
            : curve!.parameters.map((t) => coordinate(map!(t)));
      anchor =
        object.kind === 'curve' && preparing
          ? coordinate(curve!.ends[preparedIndices.get(context)!]!)
          : points.at(-1)!;
      paths.push({
        id,
        points,
        pigment,
        opacity: alpha,
        closed: object.kind === 'polygon' || object.style.closed,
        fill: object.style.fill,
        quiet: style.quiet,
        dashed: style.dashed,
      });
    } else if (object.kind === 'material') {
      const domain = object.style.domain;
      const fn = object.map.read(context);
      const map = (uv: DiagramPoint) => coordinate(fn(uv));
      anchor = map([(domain[0][0] + domain[1][0]) / 2, (domain[0][1] + domain[1][1]) / 2]);
      patches.push({
        id,
        domain,
        map,
        pigment,
        opacity: alpha,
        grid: object.style.grid,
        text: object.style.text === undefined ? undefined : read(object.style.text, context),
        fill: object.style.fill,
      });
    }
    if (style.label !== undefined)
      labels.push({
        id,
        text: read(style.label, context),
        at: anchor!,
        side: style.side,
        pigment,
        opacity: alpha,
      });
  };
}
