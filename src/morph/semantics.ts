import type { ObjectMeaning } from '../scene-objects.js';
import type { MathMorphFrame, MathPart } from './types.js';
import { mathNumber } from './numbers.js';
import { sourceOf } from '../scene-source.js';

interface SemanticPart {
  part: MathPart;
  visible: boolean;
  meaning: ObjectMeaning;
}

/** Both renderers expose the identities and origins authored by the same math plan. */
export function mathSemantics(id: string, file: string, operation: () => unknown) {
  let frame: MathMorphFrame | undefined;
  const originIds = new Map<string, string>();
  const parts = new Map<string, SemanticPart>();
  const meaning: ObjectMeaning = {
    label: 'Математическое преобразование',
    value: () => frame?.result,
    get source() {
      return sourceOf(operation());
    },
    implementation: { file },
    inputs: () => [...new Set(originIds.values())],
    provenance: () =>
      frame && {
        formula: frame.formula,
        stage: frame.stage,
        phase: frame.phase,
        result: frame.result,
        sources: frame.sources.map((part) => ({
          id: part.id && `${id}:${part.id}`,
          value: part.value,
          origins: part.origins,
        })),
        targets: frame.targets.map((part) => ({
          id: part.id && `${id}:${part.id}`,
          value: part.value,
          origins: part.origins,
        })),
      },
  };
  return {
    parts,
    meaning,
    update(next: MathMorphFrame) {
      frame = next;
      for (const record of parts.values()) record.visible = false;
      const active = new Map(
        (frame.morph < 0.5 ? frame.sources : frame.targets).map((part) => [part.id, part]),
      );
      for (const part of [...frame.sources, ...frame.targets]) {
        if (!part.id) continue;
        const key = `${id}:${part.id}`;
        if (!parts.has(key)) {
          for (const origin of part.origins ?? []) {
            const originKey = `${origin.operand}:${origin.index}`;
            if (!originIds.has(originKey) && part.origins?.length === 1)
              originIds.set(originKey, key);
          }
          const record: SemanticPart = {
            part,
            visible: false,
            meaning: {
              get label() {
                return `Величина ${mathNumber(record.part.value)}`;
              },
              value: () => record.part.value,
              get source() {
                return sourceOf(operation());
              },
              implementation: { file },
              inputs: () => [
                ...new Set(
                  (record.part.origins ?? []).flatMap((origin) => {
                    const source = originIds.get(`${origin.operand}:${origin.index}`);
                    return source && source !== key ? [source] : [];
                  }),
                ),
              ],
              provenance: () => ({
                origins: record.part.origins ?? [],
                formula: frame?.formula,
                stage: frame?.stage,
              }),
            },
          };
          parts.set(key, record);
        }
        const record = parts.get(key)!;
        record.part = active.get(part.id) ?? part;
        record.visible = active.has(part.id);
      }
    },
    clear() {
      parts.clear();
      originIds.clear();
      frame = undefined;
    },
  };
}
