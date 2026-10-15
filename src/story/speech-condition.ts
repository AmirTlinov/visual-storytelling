export interface SpeechModelCondition {
  model: string;
  inputs: Readonly<Record<string, unknown>>;
}
/** Authored code is conservative; declared model dependencies can follow live inputs. */
export interface SpeechConditions {
  basis: 'authored' | 'presented';
  models: readonly SpeechModelCondition[];
}
export function validateSpeechConditions(
  value: unknown,
  path = 'speech conditions',
): SpeechConditions {
  const condition = record(value, path);
  keys(condition, ['basis', 'models'], path);
  if (!['authored', 'presented'].includes(condition.basis as string))
    throw new Error(`${path}.basis: choose authored or presented.`);
  const ids = new Set<string>();
  const models = array(condition.models, `${path}.models`).map((raw) => {
    const model = record(raw, `${path}.models`);
    keys(model, ['model', 'inputs'], `${path}.models`);
    if (typeof model.model !== 'string' || !model.model || ids.has(model.model))
      throw new Error(`${path}: reference unique models.`);
    ids.add(model.model);
    const inputs = record(model.inputs, `${path}.inputs`);
    const json = (value: unknown): boolean =>
      value === null ||
      ['string', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'object' && value !== null && Object.values(value).every(json));
    if (!json(inputs)) throw new Error(`${path}.inputs: use finite JSON values.`);
    return { model: model.model, inputs: structuredClone(inputs) };
  });
  return { basis: condition.basis as SpeechConditions['basis'], models };
}
export const sameSpeechValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left),
    b = Object.keys(right);
  return (
    a.length === b.length &&
    a.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameSpeechValue(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
};

export function speechConditionsMatch(
  conditions: SpeechConditions,
  values: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
) {
  return conditions.models.every(({ model, inputs }) =>
    Object.entries(inputs).every(
      ([key, value]) => values[model] !== undefined && sameSpeechValue(values[model]![key], value),
    ),
  );
}
import { array, record, keys } from './document-fields.js';
