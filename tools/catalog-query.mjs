/** The gallery and CLI use the same vocabulary, ordering and search. */
export const exampleGroups = {
  explanations: 'Объяснения',
  techniques: 'Приёмы и API',
};

const normalize = (value) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');

export function selectExamples(catalog, { query = '', group = '', recommended = false } = {}) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return Object.entries(catalog)
    .map(([id, entry]) => ({ id, ...entry }))
    .filter((entry) => {
      const text = normalize(
        [
          entry.id,
          entry.title,
          entry.summary,
          entry.useFor,
          entry.visibleAction,
          entry.capabilities,
          entry.tags,
        ]
          .flat()
          .join(' '),
      );
      return (
        (!group || entry.group === group) &&
        (!recommended || entry.recommended) &&
        words.every((word) => text.includes(word))
      );
    })
    .sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
}
