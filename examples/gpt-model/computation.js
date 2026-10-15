import { borrowSceneView, MathMorph, TensorData } from '@visual-storytelling/core';
import {
  calculationTiming,
  calculationFraming,
  MathMorph3D,
  Tensor3D,
  ThreeKit as T,
  Viewport3D,
} from '@visual-storytelling/core/three';
import { CONFIG, MODEL, VOCAB } from './model.js';

const clamp = (value) => Math.max(0, Math.min(1, value));
const format = (value) => Number(value.toPrecision(3)).toString().replace('-', '−');
const matrix = (id, values, axes) =>
  new TensorData({
    id,
    shape: [values.length, values[0].length],
    values: values.flat(),
    axes,
  });

function index(value, count, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= count)
    throw new Error(`Invalid ${name}: ${value}`);
  return value;
}

/** The same operands used by the real model, with their original token/channel addresses. */
export function computationPlan({
  trace,
  block = 0,
  token = trace.ids.length - 1,
  head = 0,
  source = 0,
  channel = 0,
  kind = 'score',
  projection = 'q',
  candidate = trace.next.id,
  compact = false,
}) {
  index(block, trace.blocks.length, 'block');
  index(token, trace.ids.length, 'token');
  index(head, CONFIG.heads, 'head');
  index(source, trace.ids.length, 'source');
  index(channel, CONFIG.modelWidth, 'channel');
  const layer = trace.blocks[block];
  const attention = layer.attention.heads[head];
  const root = `gpt:block-${block}`;
  const prefix = `${root}:head-${head}`;
  let operation, expected, inputs, title, resultLabel;
  const batching = { batchSize: compact ? 1 : 4 };
  if (kind === 'logit') {
    index(candidate, VOCAB.length, 'candidate');
    const x = matrix('gpt:final-norm', trace.finalNorm.output, ['токен', 'канал']).slice(0, token);
    const w = matrix('gpt:token-embedding', MODEL.weights.tokenEmbedding, [
      'слово словаря',
      'канал',
    ]).slice(0, candidate);
    operation = MathMorph.dot(x, w, batching);
    expected = trace.logits[token][candidate];
    inputs = { x, w };
    title = `Финальный LN(x[${token}]) · E(«${VOCAB[candidate]}»)`;
    resultLabel = `Оценка «${VOCAB[candidate]}»`;
  } else if (kind === 'projection') {
    const projectionIndex = ['q', 'k', 'v'].indexOf(projection);
    if (projectionIndex < 0) throw new Error(`Invalid Q/K/V projection: ${projection}`);
    const component = channel % (CONFIG.modelWidth / CONFIG.heads);
    const row = projection === 'q' ? token : source;
    const column =
      projectionIndex * CONFIG.modelWidth + head * (CONFIG.modelWidth / CONFIG.heads) + component;
    const x = matrix(`${root}:ln1`, layer.ln1.output, ['токен', 'канал']).slice(0, row);
    const w = matrix(`${root}:qkv-weight`, MODEL.weights.blocks[block].qkv.weight, [
      'входной канал',
      'канал Q/K/V',
    ]).slice(1, column);
    const bias = MODEL.weights.blocks[block].qkv.bias[column];
    operation = MathMorph.chain(MathMorph.dot(x, w, batching), { operator: 'add', value: bias });
    expected = attention[projection][row][component];
    inputs = { x, w };
    title = `LN(x[${row}]) · W${projection.toUpperCase()} + bias → канал ${component + 1}`;
    resultLabel = `${projection.toUpperCase()}[${row}], канал ${component + 1}`;
  } else if (kind === 'score') {
    const q = matrix(`${prefix}:q`, attention.q, ['токен', 'канал головы']).slice(0, token);
    const k = matrix(`${prefix}:k`, attention.k, ['токен', 'канал головы']).slice(0, source);
    const scale = new TensorData({
      id: `${prefix}:scale`,
      shape: [],
      values: [Math.sqrt(CONFIG.modelWidth / CONFIG.heads)],
    });
    operation = MathMorph.chain(MathMorph.dot(q, k, batching), {
      operator: 'divide',
      value: scale.values[0],
    });
    expected = attention.scaledScores[token][source];
    inputs = { q, k, scale };
    title = `Q[${token}] · K[${source}] / √${CONFIG.modelWidth / CONFIG.heads}`;
    resultLabel = source > token ? 'До причинной маски' : 'Оценка связи';
  } else if (kind === 'mix') {
    const component = channel % (CONFIG.modelWidth / CONFIG.heads);
    const a = matrix(`${prefix}:attention`, attention.probabilities, [
      'получатель',
      'источник',
    ]).slice(0, token);
    const v = matrix(`${prefix}:v`, attention.v, ['токен', 'канал головы']).slice(1, component);
    operation = MathMorph.dot(a, v, batching);
    expected = attention.output[token][component];
    inputs = { a, v };
    title = `Канал ${component + 1}: сумма взвешенных V`;
    resultLabel = attention.ablated ? 'До отключения головы' : 'Канал головы';
  } else if (kind === 'residual') {
    const row = matrix(`${root}:input`, layer.input, ['токен', 'канал']).slice(0, token);
    const update = matrix(`${root}:attention-update`, layer.attention.projected, [
      'токен',
      'канал',
    ]).slice(0, token);
    const x = compact ? row.slice(0, channel) : row;
    const delta = compact ? update.slice(0, channel) : update;
    operation = MathMorph.formula('x + delta', { x, delta }, { measure: 'value' });
    expected = compact ? layer.afterAttention[token][channel] : layer.afterAttention[token];
    inputs = { x, delta };
    title = `${compact ? `Канал ${channel + 1}: ` : ''}старое состояние + изменение`;
    resultLabel = 'После сложения';
  } else if (kind === 'mlp') {
    const a = matrix(`${root}:mlp-activation`, layer.mlp.activation, [
      'токен',
      'скрытый канал',
    ]).slice(0, token);
    const w = matrix(`${root}:mlp-contract-weight`, MODEL.weights.blocks[block].contract.weight, [
      'скрытый канал',
      'выходной канал',
    ]).slice(1, channel);
    const bias = MODEL.weights.blocks[block].contract.bias[channel];
    // The shared dot planner batches 32 pairs four at a time. Adding the bias
    // afterwards avoids materializing 65 simultaneous formula inputs.
    operation = MathMorph.chain(MathMorph.dot(a, w, batching), { operator: 'add', value: bias });
    expected = layer.mlp.output[token][channel];
    inputs = { a, w };
    title = `MLP: 32 вклада + bias → канал ${channel + 1}`;
    resultLabel = 'Изменение от MLP';
  } else throw new Error(`Unknown GPT calculation: ${kind}`);
  const plan = MathMorph.plan(operation);
  const error = Array.isArray(expected)
    ? Math.max(...expected.map((value, i) => Math.abs(value - plan.result[i])))
    : Math.abs(expected - plan.result);
  if (!(error < 1e-10))
    throw new Error('The visual calculation differs from the GPT forward pass.');
  return {
    operation,
    plan,
    expected,
    inputs,
    title,
    resultLabel,
    kind,
    projection,
    candidate,
    block,
    token,
    head,
    source,
    channel,
  };
}

/** One bounded calculation, borrowed by the lesson's existing clocks and player. */
export function mountComputation(parent) {
  let latest;
  const view = Viewport3D.mount(parent, {
    label: 'Действительное вычисление учебной GPT: входы превращаются в результат',
  });
  const objects = new T.Group();
  const calculation = MathMorph3D.mount(view, MathMorph.calculate('add', 0, 0), {
    id: 'gpt-calculation',
    layout: 'scene',
    pigment: 'ink',
    formula: false,
    notes: 'operators',
    format,
    inputNames: (part) => (latest ? inputName(part) : undefined),
  });
  const receiver = Tensor3D.mount(
    view,
    new TensorData({ id: 'gpt-result', shape: [], values: [0] }),
    {
      id: 'gpt-result',
      title: 'Результат',
      pigment: 'ink',
      cellSize: 1.4,
      format,
      inputs: () => ['gpt-calculation'],
    },
  );
  objects.add(calculation.object, receiver.object);
  view.setObject(objects, { fitView: false });
  let condition,
    configuration,
    deliveryBounds,
    lastFrame,
    scalar = true,
    active = true,
    disposed = false;
  let lastProgress = 0,
    rendered;
  let listeners = [];

  function inputName(part) {
    const component = /^(?:left|right|pair):(\d+)$/.exec(part.id ?? '');
    if (component) {
      const i = Number(component[1]) + 1;
      if (part.id.startsWith('pair:')) return `вклад ${i}`;
      const side = part.id.startsWith('left:') ? 0 : 1;
      return ({
        projection: [`x${i}`, `w${i}`],
        logit: [`x${i}`, `e${i}`],
        score: [`q${i}`, `k${i}`],
        mix: [`вес ${i}`, `v${i}`],
        mlp: [`h${i}`, `w${i}`],
      }[latest.kind] ?? ['x', 'Δ'])[side];
    }
    if (part.id?.endsWith(':constant')) return latest.kind === 'score' ? '√4' : 'bias';
    if (/^(sum:|result)/.test(part.id ?? '')) return 'сумма';
    return part.origins?.[0]?.source?.tensor.includes('attention-update') ? 'Δ' : 'x';
  }

  function render(state) {
    if (disposed) throw new Error('GPT computation has been disposed.');
    // The drawing can be wide while its fitted CSS height is small. Use the
    // same one-pair explanation there; every operand remains in the shared plan.
    const displayHeight = parent.getBoundingClientRect().height;
    if (!state.compact && displayHeight > 0 && displayHeight < 360)
      state = { ...state, compact: true };
    const { trace, progress = 0, reduced = false } = state;
    if (!Number.isFinite(progress)) throw new Error('Calculation progress must be finite.');
    const key = [
      state.block ?? 0,
      state.token ?? trace.ids.length - 1,
      state.head ?? 0,
      state.source ?? 0,
      state.channel ?? 0,
      state.kind ?? 'score',
      state.projection ?? 'q',
      state.candidate ?? trace.next.id,
      !!state.compact,
    ].join('/');
    const stamp = [key, progress, reduced, parent.clientWidth, parent.clientHeight].join('/');
    if (condition === trace && rendered === stamp) return;

    if (condition !== trace || configuration !== key) {
      const next = computationPlan(state);
      calculation.setDelivery();
      calculation.setOperation(next.plan);
      scalar = typeof next.expected === 'number';
      receiver.setData(
        new TensorData({ id: 'gpt-result', shape: [], values: [scalar ? next.expected : 0] }),
      );
      receiver.titleLabel?.set(next.resultLabel);
      receiver.object.visible = scalar;
      // The receiver stays outside the calculation's complete motion envelope.
      const envelope = calculation.bounds;
      receiver.object.position.set(
        state.compact ? 3.4 : envelope.max.x + 3,
        state.compact ? 0 : (envelope.min.y + envelope.max.y) / 2,
        0,
      );
      objects.updateMatrixWorld(true);
      if (scalar) calculation.setDelivery({ to: receiver.cell().box });
      listeners.forEach((remove) => remove());
      listeners = [];
      for (const [name, tensor] of Object.entries(next.inputs)) {
        const anchor = new T.Object3D();
        objects.add(anchor);
        const forget = view.describe(anchor, tensor.id, {
          label: name,
          value: () => tensor.toValue(),
          provenance: () => ({
            tensor: tensor.id,
            shape: tensor.shape,
            origins: tensor.values.map((_, i) => tensor.origin(i)),
          }),
        });
        listeners.push(() => {
          forget();
          anchor.removeFromParent();
        });
      }
      condition = trace;
      configuration = key;
      latest = next;
      deliveryBounds = new T.Box3();
      for (const part of next.plan.sample(1).targets)
        deliveryBounds.union(
          new T.Box3().setFromCenterAndSize(
            new T.Vector3(...part.position),
            new T.Vector3(...part.size),
          ),
        );
      if (scalar) deliveryBounds.union(receiver.bounds);
    }
    const p = clamp(progress);
    lastProgress = p;
    // The calculation settles before the separate handoff begins. Direct and
    // reverse seeks go through these same two absolute progress values.
    const timing = calculationTiming(p, scalar);
    const calculate = timing.calculation,
      deliver = timing.delivery;
    lastFrame = calculation.render(
      { progress: calculate, reduced, duration: latest.kind === 'mlp' ? 24 : 7 },
      undefined,
      deliver,
    );
    receiver.object.visible = scalar && p >= 0.84;
    objects.updateMatrixWorld(true);
    // Fit the current complete stage, rather than reserving future operands and
    // the delivery destination during every multiplication. The final hold of
    // each stage opens the next envelope using absolute time, so reverse seek
    // cannot retain a different camera. Both envelopes contain the carried body.
    const bounds = calculationFraming(latest.plan, lastFrame, calculate, {
      annotationHeight: 1.15,
      arrangement: calculation.arrangement,
      reduced,
      ...(scalar && p >= 0.82
        ? { delivery: { bounds: deliveryBounds, progress: timing.framing } }
        : {}),
    });
    bounds.applyMatrix4(calculation.object.matrixWorld);
    view.shot({
      // The current envelope already reserves physical operands and their names.
      // Only the actual destination adds a screen label during delivery.
      target: scalar && p >= 0.82 ? receiver.object : bounds,
      bounds,
      direction: [0, 0, 1],
      padding: state.compact ? 4 : 20,
      reduced,
    });
    parent.setAttribute('aria-label', `${latest.title}. ${Math.round(p * 100)}%.`);
    view.invalidate();
    rendered = stamp;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.forEach((remove) => remove());
    listeners = [];
    calculation.dispose();
    receiver.dispose();
    view.dispose();
  }

  // The shell owns the complete presentation through this adapter. A hidden
  // calculation contributes no camera state or focus capability to a checkpoint.
  const sceneView = borrowSceneView(() => (active && !disposed ? view : undefined), dispose);

  return {
    render,
    dispose,
    view: sceneView,
    ready: (signal) => view.whenRendered(signal),
    setActive(value) {
      if (disposed) return;
      active = !!value;
      view.controls.enabled = active;
    },
    nextProgress() {
      if (!latest) return 0;
      const end = scalar ? 0.82 : 1;
      const stops = Array.from(
        { length: latest.plan.stages },
        (_, i) => (end * (i + 0.98)) / latest.plan.stages,
      );
      if (scalar) stops.push(0.82, 1);
      else stops.push(1);
      return stops.find((progress) => progress > lastProgress + 1e-6) ?? 0;
    },
    snapshot() {
      return (
        latest && {
          kind: latest.kind,
          projection: latest.projection,
          candidate: latest.candidate,
          block: latest.block,
          token: latest.token,
          head: latest.head,
          source: latest.source,
          channel: latest.channel,
          expected: latest.expected,
          result: calculation.plan.result,
          stages: calculation.plan.stages,
          frame: lastFrame,
          received: scalar && receiver.cell().box.visible,
          origins: Object.fromEntries(
            Object.entries(latest.inputs).map(([name, tensor]) => [
              name,
              tensor.values.map((_, i) => tensor.origin(i)),
            ]),
          ),
        }
      );
    },
  };
}
