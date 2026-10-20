import { MODEL, PRESETS } from './model.js';
import { defaults, views } from './selection.js';
import { options } from './presentation/format.js';
export function gptParameters(inputs = defaults) {
  return [
    { key: 'prompt', label: 'Своя фраза', type: 'text', commit: 'change', value: '' },
    {
      key: 'preset',
      label: 'Фраза',
      type: 'select',
      value: defaults.preset,
      options: PRESETS.map((p) => ({ value: p.id, label: p.label })),
    },
    ...['token', 'source', 'channel'].map((key) => ({
      key,
      label: key,
      value: defaults[key],
      min: 0,
      max: 7,
      step: 1,
    })),
    ...['block', 'head'].map((key) => ({ key, label: key, value: 0, min: 0, max: 1, step: 1 })),
    { key: 'view', label: 'Уровень', type: 'select', value: 'overview', options: options(views) },
    {
      key: 'perspective',
      label: 'Точка зрения',
      type: 'select',
      value: 'diagram',
      options: options(['diagram', 'algebra', 'geometry', 'hardware']),
    },
    {
      key: 'kind',
      label: 'Вычисление',
      type: 'select',
      value: 'score',
      options: options(['score', 'mix', 'residual', 'mlp', 'projection', 'logit']),
    },
    {
      key: 'projection',
      label: 'Проекция attention',
      type: 'select',
      value: 'q',
      options: options(['q', 'k', 'v']),
    },
    {
      key: 'normKind',
      label: 'Нормализация',
      type: 'select',
      value: 'ln1',
      options: options(['ln1', 'ln2']),
    },
    { key: 'phase', label: 'Ход вычисления', value: 0, min: 0, max: 1, step: 0.01 },
    { key: 'axis', label: 'Плоскость координат', value: 0, min: 0, max: 6, step: 1 },
    { key: 'term', label: 'Слагаемое', value: 0, min: 0, max: 31, step: 1 },
    { key: 'detailPage', label: 'Страница подробностей', value: -1, min: -1, max: 8, step: 1 },
    {
      key: 'candidate',
      label: 'Выходной токен',
      value: -1,
      min: -1,
      max: MODEL.vocab.length - 1,
      step: 1,
    },
    {
      key: 'guess',
      label: 'Прогноз',
      type: 'select',
      value: '',
      options: options(['', ...MODEL.vocab]),
    },
    ...['checked', 'generated', 'ablate'].map((key) => ({
      key,
      label: key,
      type: 'toggle',
      value: false,
    })),
  ].map((p) => ({ ...p, value: inputs[p.key] ?? p.value }));
}
