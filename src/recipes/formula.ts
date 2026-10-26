import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Pigment } from '../ink/palette.js';
import type { ObjectMeaning } from '../scene-objects.js';

export interface Term<K extends string> {
  id: K;
  text: string | number;
  pigment?: Pigment;
  /** A formula may represent the same measured object as the drawing. */
  objectId?: string;
  meaning?: ObjectMeaning;
}
export function formula<K extends string>(
  parent: SVGElement,
  id: string,
  terms: readonly Term<K>[],
  size = 30,
) {
  const mark = object(parent, id);
  const ids = new Set<string>();
  const entries = terms.map((term) => {
    if (ids.has(term.id)) throw new Error(`Duplicate formula term: ${term.id}`);
    ids.add(term.id);
    const part = object(mark.content, term.objectId ?? `${id}:${term.id}`, term.pigment);
    if (term.meaning) part.describe(term.meaning);
    const label = lettering(part.content, term.text, { size, anchor: 'start', tabular: true });
    return { term, part, label };
  });
  const layout = () => {
    const total =
      entries.reduce((sum, entry) => sum + entry.label.width, 0) +
      Math.max(0, entries.length - 1) * size * 0.32;
    let x = -total / 2;
    for (const entry of entries) {
      entry.part.at(x, 0);
      x += entry.label.width + size * 0.32;
    }
  };
  const get = (id: K) => {
    const entry = entries.find((entry) => entry.term.id === id);
    if (!entry) throw new Error(`Unknown formula term: ${id}`);
    return entry;
  };
  layout();
  return {
    ...mark,
    write(progress: number | ((id: K) => number)) {
      for (const entry of entries)
        entry.label.write(typeof progress === 'number' ? progress : progress(entry.term.id));
    },
    substitute(id: K, value: string | number) {
      get(id).label.text(value);
      layout();
    },
    get width() {
      return (
        entries.reduce((sum, entry) => sum + entry.label.width, 0) +
        Math.max(0, entries.length - 1) * size * 0.32
      );
    },
    dispose() {
      for (const entry of entries) {
        entry.label.dispose();
        entry.part.dispose();
      }
      mark.dispose();
    },
  };
}
