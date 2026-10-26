import { forward, rankingAt, tokenize, MODEL, PRESETS, CONFIG } from './model.js';
import { defaults, views } from './selection.js';
import { gptParameters } from './parameters.js';
import { kindFor, perspectives } from './presentation/format.js';
const initial = { ...defaults, prompt: '' };
const parameters = gptParameters(initial);
const fields = new Map(parameters.map((p) => [p.key, p]));
const traces = new Map();
function inputTokens(p) {
  return p.prompt ? tokenize(p.prompt) : PRESETS.find((item) => item.id === p.preset).tokens;
}
function traceFor(p) {
  let tokens = inputTokens(p);
  const intervention = p.ablate ? { ablateHead: { block: p.block, head: p.head } } : {};
  const run = (tokens) => {
    const key = JSON.stringify([tokens, intervention]);
    let trace = traces.get(key);
    if (!trace) {
      trace = forward(tokens, intervention);
      traces.set(key, trace);
      if (traces.size > 8) traces.delete(traces.keys().next().value);
    }
    return trace;
  };
  if (p.generated) tokens = [...tokens, run(tokens).next.token];
  return run(tokens);
}
export function gptInputs(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !Object.hasOwn(initial, k))
  )
    throw Error('Provide registered GPT inputs.');
  const p = { ...initial, ...value };
  for (const [key, field] of fields) {
    const v = p[key];
    if (field.options && !field.options.some((o) => o.value === v))
      throw Error(`Unknown GPT ${key}: ${v}`);
    if (typeof field.value === 'boolean' && typeof v !== 'boolean')
      throw Error(`GPT ${key} must be boolean.`);
    if (typeof field.value === 'string' && typeof v !== 'string')
      throw Error(`GPT ${key} must be text.`);
    if (
      typeof field.value === 'number' &&
      (!Number.isFinite(v) ||
        v < field.min ||
        v > field.max ||
        (field.step >= 1 && !Number.isSafeInteger(v)))
    )
      throw Error(`GPT ${key} is outside its disclosed range.`);
  }
  if (typeof p.prompt !== 'string' || p.prompt.length > 200)
    throw Error('Provide a short prompt from the disclosed teaching vocabulary.');
  if (p.guess && !MODEL.vocab.includes(p.guess))
    throw Error('Choose a prediction from the disclosed teaching vocabulary.');
  if (!perspectives(p.view).includes(p.perspective))
    throw Error(`View ${p.view} supports: ${perspectives(p.view).join(', ')}.`);
  traceFor(p);
  return p;
}
export function gptState(inputs) {
  const p = gptInputs(inputs),
    trace = traceFor(p),
    token = Math.min(p.token, trace.tokens.length - 1),
    source = Math.min(p.source, trace.tokens.length - 1),
    block = trace.blocks[p.block],
    head = block.attention.heads[p.head],
    ranking = rankingAt(trace, token),
    candidate = p.candidate < 0 ? ranking[0].id : p.candidate;
  return {
    ...p,
    detail: { values: p, trace, token, source, block, head, ranking, candidate, steps: {} },
  };
}
const scalarInputs = (state) => Object.fromEntries(Object.keys(initial).map((k) => [k, state[k]]));
const operationSteps = {
  'embed-token': 'embedding.word',
  'embed-position': 'embedding.position',
  'embed-sum': 'embedding.sum',
  'block-attention': 'block.attention',
  'block-mlp': 'block.mlp',
};
const operations = Object.fromEntries(
  [
    'overview',
    'block',
    'attention',
    'calculation',
    'residual',
    'mlp',
    'prediction',
    'output',
    ...Object.keys(operationSteps),
  ].map((name) => [
    name,
    (state, progress) => {
      const next = gptState({
        ...scalarInputs(state),
        phase: progress,
        detailPage: -1,
        checked: name === 'output',
        generated: false,
      });
      next.detail.steps = {
        ...state.detail.steps,
        ...(operationSteps[name] ? { [operationSteps[name]]: progress } : {}),
      };
      return next;
    },
  ]),
);
export const gptModel = {
  validateInputs: gptInputs,
  state: gptState,
  staticState: gptState,
  projectViews(state, selected) {
    if (selected.length !== 1) throw Error('Choose one GPT representation per authored chapter.');
    const kind = selected[0].kind,
      view = kind === 'calculation' ? 'attention' : kind;
    const next = gptState({
      ...scalarInputs(state),
      view,
      perspective: kind === 'calculation' ? 'algebra' : 'diagram',
      kind: kind === 'calculation' ? 'score' : kindFor(view, state.kind),
    });
    next.detail.steps = state.detail.steps;
    return next;
  },
  experimentState(inputs, authored) {
    const state = gptState(inputs);
    if (authored.view === 'output' && authored.checked && inputs.view === 'output')
      state.detail = { ...state.detail, values: { ...state.detail.values, checked: true } };
    return state;
  },
  operations,
  canContinue: (state) => state.checked === true,
  validateViews(selected) {
    if (!selected.length || selected.some((v) => ![...views, 'calculation'].includes(v.kind)))
      throw Error('Select a disclosed GPT representation.');
  },
  focusTargets: (model, selected) => [
    ...selected.map((v) => v.id),
    ...Array.from({ length: CONFIG.context }, (_, i) => `${model.id}:token-${i}`),
  ],
};
export default gptModel;
