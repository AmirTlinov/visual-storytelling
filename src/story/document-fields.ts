export const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path}: expected an object.`);
  return value as Record<string, unknown>;
};
export const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`${path}.${extra}: unknown field.`);
};
export const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(value))
    throw new Error(`${path}: use a stable ID starting with a lowercase letter.`);
  return value;
};
export const text = (value: unknown, path: string, empty = false): string => {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 4000)
    throw new Error(`${path}: expected ${empty ? '' : 'non-empty '}text.`);
  return value;
};
export const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${path}: expected a list.`);
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(value, index)) throw new Error(`${path}: expected a dense list.`);
  return value;
};
export const seconds = (value: unknown, path: string, minimum = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    throw new Error(`${path}: expected finite seconds of at least ${minimum}.`);
  return value;
};
