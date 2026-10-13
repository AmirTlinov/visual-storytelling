import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['src/recipes/index.ts', 'src/story/document.ts', 'src/story/cues.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  outdir: 'unused',
});
const load = async (index) =>
  import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[index].text).toString('base64')
  );
const {
  dependencyRoute,
  dependencyRouteModel,
  instructionalDependencyGraph: graph,
  tracePath,
} = await load(0);
const { prepareIllustratedDocument, documentModelsAt, documentTimeline, editStoryDocument } =
  await load(1);
const { cueSheet } = await load(2);
const input = { orderId: '417', reserve: 'none' };
test('one stable order traverses the model; a failed common provider blocks both entries', () => {
  const healthy = dependencyRoute(graph, input);
  assert.equal(healthy.status, 'delivered');
  assert.deepEqual(healthy.route, ['shop', 'gateway', 'provider', 'bank']);
  const shared = dependencyRoute(graph, { ...input, reserve: 'shared', 'disabled-provider': true });
  assert.equal(shared.status, 'blocked');
  assert.equal(shared.blocked, 'provider');
  assert.ok(shared.activeEdges.includes('shared-provider'));
  assert.deepEqual(shared.visits, ['shop', 'gateway']);
  assert.deepEqual(shared.events.at(-1), { kind: 'stop', node: 'provider', orderId: '417' });
  const independent = dependencyRoute(graph, {
    ...input,
    reserve: 'independent',
    'disabled-provider': true,
  });
  assert.equal(independent.status, 'delivered');
  assert.deepEqual(independent.route, ['shop', 'backup', 'independent', 'bank']);
  assert.ok(independent.events.every((event) => event.orderId === '417'));
});
test('two failures, origin failure, unreachable topology and repair have exact causes', () => {
  const both = dependencyRoute(graph, {
    ...input,
    reserve: 'independent',
    'disabled-provider': true,
    'disabled-independent': true,
  });
  assert.equal(both.status, 'blocked');
  assert.deepEqual(both.failedBoundary, ['provider', 'independent']);
  const origin = dependencyRoute(graph, { ...input, 'disabled-shop': true });
  assert.deepEqual(origin.visits, []);
  assert.equal(origin.blocked, 'shop');
  const disconnected = { ...graph, edges: graph.edges.filter((edge) => edge.to !== 'bank') };
  assert.equal(dependencyRoute(disconnected, input).status, 'unreachable');
  const module = dependencyRouteModel(graph);
  const failed = module.operations['disable-provider'](module.state(input), 1);
  const rerouted = module.operations['reconnect-independent'](failed, 1);
  assert.equal(rerouted.trace.status, 'delivered');
  const repaired = module.operations['enable-provider'](failed, 1);
  assert.deepEqual(repaired.trace, dependencyRoute(graph, input));
});
test('cycles and invalid graph/conditions cannot invent a successful route', () => {
  assert.equal(
    dependencyRoute(
      { ...graph, edges: [...graph.edges, { id: 'cycle', from: 'provider', to: 'shop' }] },
      input,
    ).status,
    'delivered',
  );
  for (const broken of [
    { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
    { ...graph, destination: 'absent' },
    { ...graph, edges: [{ id: 'wrong', from: 'shop', to: 'absent' }] },
  ])
    assert.throws(() => dependencyRoute(broken, input));
  for (const patch of [
    { reserve: 'magic' },
    { orderId: '' },
    { 'disabled-provider': 1 },
    { unknown: true },
  ])
    assert.throws(() => dependencyRoute(graph, { ...input, ...patch }));
});
test('authored operations and backward seek are pure replay of the same model', () => {
  const doc = prepareIllustratedDocument({
    recipe: 'dependency-route',
    inputs: input,
    chapters: [
      {
        id: 'story',
        title: 'Проверка маршрута',
        beats: [
          { id: 'healthy', operation: { model: 'route', name: 'trace' }, seconds: 2 },
          { id: 'failure', operation: { model: 'route', name: 'disable-provider' }, seconds: 1 },
          { id: 'blocked', operation: { model: 'route', name: 'trace' }, seconds: 2 },
          {
            id: 'repair',
            operation: { model: 'route', name: 'reconnect-independent' },
            seconds: 1,
          },
          { id: 'delivered', operation: { model: 'route', name: 'trace' }, seconds: 2 },
        ],
      },
    ],
  }).document;
  const sheet = cueSheet(documentTimeline(doc));
  const at = (time) => documentModelsAt(doc, sheet.at(time)).models.route;
  assert.equal(at(4).trace.status, 'blocked');
  assert.equal(at(7).trace.status, 'delivered');
  assert.deepEqual(at(4), at(4));
  assert.equal(at(1).trace.status, 'delivered');
  assert.equal(at(1)['disabled-provider'], false);
  const manual = documentModelsAt(
    doc,
    sheet.at(4),
    { route: { ...input, 'disabled-provider': false } },
    {},
    { mode: 'explore' },
  ).models.route;
  assert.equal(manual.trace.status, 'delivered', 'a viewer can repair an authored failure');
  const changed = editStoryDocument(doc, [
    { op: 'set-inputs', modelId: 'route', values: { 'disabled-bank': true } },
  ]);
  assert.equal(documentModelsAt(changed).models.route.trace.blocked, 'bank');
});
test('two registered owners cannot compete for the same module identity', () => {
  assert.throws(
    () =>
      prepareIllustratedDocument(
        { recipe: 'dependency-route', inputs: input },
        { modules: { 'dependency-route': dependencyRouteModel(graph) } },
      ),
    /already has an owner/,
  );
});
test('the shared path aid follows computed geometry without routing semantics', () => {
  const points = [
    [0, 0],
    [3, 0],
    [3, 4],
  ];
  assert.deepEqual(tracePath(points, 0).point, [0, 0]);
  assert.deepEqual(tracePath(points, 0.5).point, [3, 0.5]);
  assert.deepEqual(tracePath(points, 1).point, [3, 4]);
  assert.deepEqual(tracePath([[2, 3]], 0.5).point, [2, 3]);
  assert.throws(() => tracePath([], 0));
  assert.throws(() => tracePath(points, NaN));
});
