import { record, keys, id, text, array } from './document-fields.js';
export interface StoryResource {
  id: string;
  title: string;
  kind: 'simulation' | 'model' | 'data' | 'method';
  description: string;
  limits?: readonly string[];
  url?: string;
}
/** Resource content is data. It cannot install code or alter the model's computations. */
export function validateStoryResources(value: unknown, identity = id): readonly StoryResource[] {
  if (value === undefined) return [];
  const entries = array(value, 'resources');
  if (entries.length > 32) throw new Error('Declare at most 32 resources.');
  const unique = new Set<string>();
  return entries.map((entry, index) => {
    const path = `resources[${index}]`,
      raw = record(entry, path);
    keys(raw, ['id', 'title', 'kind', 'description', 'limits', 'url'], path);
    const resourceId = identity(raw.id, `${path}.id`);
    if (unique.has(resourceId)) throw new Error(`${path}: duplicate resource ID.`);
    unique.add(resourceId);
    if (
      typeof raw.kind !== 'string' ||
      !['simulation', 'model', 'data', 'method'].includes(raw.kind)
    )
      throw new Error(`${path}.kind: name the origin.`);
    let url: string | undefined;
    if (raw.url !== undefined) {
      url = text(raw.url, `${path}.url`);
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error(`${path}.url: use a public HTTP(S) reference.`);
    }
    const limits =
      raw.limits === undefined
        ? undefined
        : array(raw.limits, `${path}.limits`).map((value) => text(value, `${path}.limits`));
    if (limits && limits.length > 16)
      throw new Error(`${path}.limits: keep at most 16 boundaries.`);
    return Object.freeze({
      id: resourceId,
      title: text(raw.title, `${path}.title`),
      kind: raw.kind as StoryResource['kind'],
      description: text(raw.description, `${path}.description`),
      ...(limits && { limits: Object.freeze(limits) }),
      ...(url && { url }),
    });
  });
}
