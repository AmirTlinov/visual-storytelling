import type { ModelValues, ModelState, StoryModelModule } from '../story/model.js';

export interface DependencyNode {
  id: string;
  label: string;
  shortLabel?: string;
}
export interface DependencyEdge {
  id: string;
  from: string;
  to: string;
  reserve?: 'shared' | 'independent' | 'both';
}
export interface DependencyGraph {
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
  origin: string;
  destination: string;
}
export interface DependencyTrace {
  orderId: string;
  status: 'delivered' | 'blocked' | 'unreachable';
  /** Includes the attempted failed node; it is never counted as a successful visit. */
  route: readonly string[];
  edges: readonly string[];
  visits: readonly string[];
  blocked: string | null;
  failedBoundary: readonly string[];
  failedNodes: readonly string[];
  activeEdges: readonly string[];
  events: readonly { kind: 'visit' | 'stop' | 'deliver'; node: string; orderId: string }[];
}

/** Planned routing is distinct from the result visibly reached by the travelling order. */
export function dependencyObservation(trace: DependencyTrace, progress: number, present = true) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new Error('A dependency observation needs progress in [0, 1].');
  return {
    id: trace.orderId,
    present,
    progress,
    outcome: !present
      ? ('removed' as const)
      : progress === 1
        ? trace.status
        : ('travelling' as const),
  };
}

export function validateDependencyGraph(value: DependencyGraph): DependencyGraph {
  if (
    !value ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !value.nodes.length ||
    value.nodes.length > 32 ||
    value.edges.length > 128
  )
    throw new Error('dependency graph: provide 1–32 nodes and at most 128 edges.');
  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (
      !node ||
      !/^[a-z][a-z0-9-]{0,49}$/.test(node.id) ||
      ids.has(node.id) ||
      typeof node.label !== 'string' ||
      !node.label.trim() ||
      node.label.length > 100 ||
      (node.shortLabel !== undefined &&
        (typeof node.shortLabel !== 'string' ||
          !node.shortLabel.trim() ||
          node.shortLabel.length > 24))
    )
      throw new Error('dependency graph: nodes need unique stable IDs and bounded labels.');
    ids.add(node.id);
  }
  if (!ids.has(value.origin) || !ids.has(value.destination) || value.origin === value.destination)
    throw new Error('dependency graph: choose distinct existing origin and destination.');
  const edges = new Set<string>();
  for (const edge of value.edges) {
    if (
      !edge ||
      !/^[a-z][a-z0-9-]{0,49}$/.test(edge.id) ||
      edges.has(edge.id) ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      (edge.reserve !== undefined && !['shared', 'independent', 'both'].includes(edge.reserve))
    )
      throw new Error(
        'dependency graph: edges need unique IDs, existing endpoints and a valid reserve.',
      );
    edges.add(edge.id);
  }
  return structuredClone(value);
}

/** Deterministic breadth-first routing. Rendering never chooses a route or invents a cause. */
function route(
  graph: DependencyGraph,
  inputs: ModelValues,
  reserveAttempt = false,
): DependencyTrace {
  const reserve = String(inputs.reserve);
  const active = graph.edges.filter(
    (edge) =>
      edge.reserve === undefined ||
      edge.reserve === reserve ||
      (edge.reserve === 'both' && reserve !== 'none'),
  );
  const disabled = (id: string) => inputs[`disabled-${id}`] === true;
  type Visit = {
    node: string;
    reserved: boolean;
    from: string | null;
    edge: DependencyEdge | null;
  };
  const key = (node: string, reserved: boolean) => `${node}:${Number(reserved)}`;
  function search(ignoreFailures: boolean) {
    const parent = new Map<string, Visit>();
    if (!ignoreFailures && disabled(graph.origin)) return parent;
    const initial = key(graph.origin, false);
    parent.set(initial, { node: graph.origin, reserved: false, from: null, edge: null });
    const queue = [initial];
    for (let index = 0; index < queue.length; index++) {
      const previous = parent.get(queue[index]!)!;
      for (const edge of active) {
        const reserved = reserveAttempt && (previous.reserved || edge.reserve !== undefined);
        const next = key(edge.to, reserved);
        if (
          edge.from !== previous.node ||
          parent.has(next) ||
          (!ignoreFailures && disabled(edge.to))
        )
          continue;
        parent.set(next, { node: edge.to, reserved, from: queue[index]!, edge });
        queue.push(next);
      }
    }
    return parent;
  }
  function path(parent: Map<string, Visit>) {
    const destination = key(graph.destination, reserveAttempt);
    if (!parent.has(destination)) return { nodes: [] as string[], edges: [] as string[] };
    const nodes: string[] = [],
      edges: string[] = [];
    let current: string | null = destination;
    while (current !== null) {
      const visit: Visit = parent.get(current)!;
      nodes.unshift(visit.node);
      if (visit.edge) edges.unshift(visit.edge.id);
      current = visit.from;
    }
    return { nodes, edges };
  }
  const reachable = search(false),
    healthy = path(reachable);
  const reached = new Set([...reachable.values()].map((visit) => visit.node));
  const failedBoundary = graph.nodes
    .filter(
      (node) =>
        disabled(node.id) &&
        (node.id === graph.origin ||
          active.some((edge) => edge.to === node.id && reached.has(edge.from))),
    )
    .map((node) => node.id);
  const attempt = healthy.nodes.length ? healthy : path(search(true));
  const stop = attempt.nodes.findIndex(disabled);
  const route = stop < 0 ? attempt.nodes : attempt.nodes.slice(0, stop + 1);
  const blocked = stop < 0 ? null : attempt.nodes[stop]!;
  const visits = blocked ? route.slice(0, -1) : route;
  const status = healthy.nodes.length ? 'delivered' : blocked ? 'blocked' : 'unreachable';
  const orderId = String(inputs.orderId);
  return {
    orderId,
    status,
    route,
    edges: attempt.edges.slice(0, Math.max(0, route.length - 1)),
    visits,
    blocked,
    failedBoundary,
    failedNodes: graph.nodes.filter((node) => disabled(node.id)).map((node) => node.id),
    activeEdges: active.map((edge) => edge.id),
    events: [
      ...visits.map((node) => ({ kind: 'visit' as const, node, orderId })),
      ...(blocked
        ? [{ kind: 'stop' as const, node: blocked, orderId }]
        : status === 'delivered'
          ? [{ kind: 'deliver' as const, node: graph.destination, orderId }]
          : []),
    ],
  };
}

/** Ordinary model factory; authored source modules can supply a different instructional graph. */
export function dependencyRouteModel(source: DependencyGraph): StoryModelModule {
  const graph = validateDependencyGraph(source);
  const allowed = new Set([
    'orderId',
    'reserve',
    ...graph.nodes.map((node) => `disabled-${node.id}`),
  ]);
  const validateInputs = (value: unknown): ModelValues => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('route.inputs: expected conditions.');
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some((key) => !allowed.has(key)) ||
      typeof input.orderId !== 'string' ||
      !input.orderId.trim() ||
      input.orderId.length > 24 ||
      !['none', 'shared', 'independent'].includes(String(input.reserve))
    )
      throw new Error(
        'route.inputs: choose a bounded orderId and reserve none/shared/independent.',
      );
    for (const node of graph.nodes)
      if (
        input[`disabled-${node.id}`] !== undefined &&
        typeof input[`disabled-${node.id}`] !== 'boolean'
      )
        throw new Error(`route.inputs.disabled-${node.id}: expected boolean.`);
    return {
      orderId: input.orderId,
      reserve: String(input.reserve),
      ...Object.fromEntries(
        graph.nodes.map((node) => [`disabled-${node.id}`, input[`disabled-${node.id}`] ?? false]),
      ),
    };
  };
  const compute = (
    input: ModelValues,
    progress: number,
    present = true,
    reserveAttempt = false,
  ): ModelState => ({
    ...input,
    progress,
    present,
    reserveAttempt,
    graph,
    trace: route(graph, input, reserveAttempt),
  });
  const conditions = (state: ModelState) =>
    validateInputs(Object.fromEntries([...allowed].map((key) => [key, state[key]])));
  const change = (state: ModelState, patch: ModelValues) =>
    compute(validateInputs({ ...conditions(state), ...patch }), 0, state.present !== false);
  return {
    validateInputs,
    state: (inputs) => compute(validateInputs(inputs), 0),
    staticState: (inputs) => compute(validateInputs(inputs), 1),
    experimentState: (inputs, authored) =>
      compute(
        validateInputs(inputs),
        Number(authored.progress),
        authored.present !== false,
        authored.reserveAttempt === true,
      ),
    operations: {
      trace: (state, progress) => ({ ...state, progress }),
      'try-reserve': (state, progress) =>
        compute(conditions(state), progress, state.present !== false, true),
      finish: (state) => ({ ...state, progress: 1 }),
      reset: (state) => compute(conditions(state), 0),
      'remove-order': (state) => ({ ...state, present: false }),
      'restore-order': (state) => ({ ...state, present: true }),
      ...Object.fromEntries(
        graph.nodes.flatMap((node) => [
          [
            `disable-${node.id}`,
            (state: ModelState) => change(state, { [`disabled-${node.id}`]: true }),
          ],
          [
            `enable-${node.id}`,
            (state: ModelState) => change(state, { [`disabled-${node.id}`]: false }),
          ],
        ]),
      ),
      ...Object.fromEntries(
        ['none', 'shared', 'independent'].map((reserve) => [
          `reconnect-${reserve}`,
          (state: ModelState) => change(state, { reserve }),
        ]),
      ),
    },
    validateViews(views) {
      if (
        !views.length ||
        views.length > 2 ||
        !views.some((v) => v.kind === 'dependency-network') ||
        views.some((v) => !['dependency-network', 'order-status'].includes(v.kind)) ||
        new Set(views.map((v) => v.kind)).size !== views.length
      )
        throw new Error('route.views: one dependency-network and optionally one order-status.');
    },
    focusTargets: (model, views) => [
      ...views.map((view) => view.id),
      `${model.id}:order:${model.inputs.orderId}`,
      ...graph.nodes.map((node) => `${model.id}:node:${node.id}`),
    ],
  };
}

/** Validated public query; a mounted module retains its graph and uses the same pure algorithm. */
export function dependencyRoute(graph: DependencyGraph, inputs: ModelValues): DependencyTrace {
  return dependencyRouteModel(graph).staticState!(inputs).trace as DependencyTrace;
}

/** Explicit teaching topology. It does not describe any real company's infrastructure. */
export const instructionalDependencyGraph: DependencyGraph = {
  origin: 'shop',
  destination: 'bank',
  nodes: [
    { id: 'shop', label: 'Магазин' },
    { id: 'gateway', label: 'Оплата' },
    { id: 'backup', label: 'Резерв' },
    { id: 'provider', label: 'Провайдер А', shortLabel: 'А' },
    { id: 'independent', label: 'Провайдер Б', shortLabel: 'Б' },
    { id: 'bank', label: 'Банк' },
  ],
  edges: [
    { id: 'primary-entry', from: 'shop', to: 'gateway' },
    { id: 'primary-provider', from: 'gateway', to: 'provider' },
    { id: 'primary-bank', from: 'provider', to: 'bank' },
    { id: 'reserve-entry', from: 'shop', to: 'backup', reserve: 'both' },
    { id: 'shared-provider', from: 'backup', to: 'provider', reserve: 'shared' },
    { id: 'independent-provider', from: 'backup', to: 'independent', reserve: 'independent' },
    { id: 'independent-bank', from: 'independent', to: 'bank', reserve: 'independent' },
  ],
};
export const instructionalRouteModel = dependencyRouteModel(instructionalDependencyGraph);
