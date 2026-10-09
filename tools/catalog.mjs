import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleGroups, selectExamples } from './catalog-query.mjs';
import { scenePage } from './scene-entry.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export function exampleDetails(entry, root = workspace) {
  const directory = resolve(root, 'examples', entry.id);
  const built = resolve(root, 'site', entry.id, entry.page ?? scenePage);
  return {
    ...entry,
    directory,
    source: resolve(directory, entry.source),
    page: existsSync(built) ? built : undefined,
    preview: resolve(directory, 'preview.png'),
    guides: (entry.guides ?? []).map((path) => resolve(root, path)),
    create: `node ${quote(resolve(root, 'tools/scene.mjs'))} new ./my-story --example ${entry.id}`,
  };
}

export function describeExamples(catalog, { query = '', group, recommended, json = false } = {}) {
  if (group && !Object.hasOwn(exampleGroups, group))
    throw new Error(`Choose a group: ${Object.keys(exampleGroups).join(', ')}`);
  const entries = selectExamples(catalog, { query, group, recommended });
  const exact = entries.find((entry) => entry.id === query);
  if (json)
    return JSON.stringify(
      (exact ? [exact] : entries).map((entry) => exampleDetails(entry)),
      null,
      2,
    );
  if (exact) {
    const entry = exampleDetails(exact);
    return [
      `${entry.title} (${entry.id})`,
      entry.summary,
      `${exampleGroups[entry.group]}${entry.recommended ? ' · Начать здесь' : ''}${entry.reference ? ' · Эталон оформления' : ''}`,
      '',
      `Кадр: ${entry.preview}`,
      `Исходник: ${entry.source}`,
      ...(entry.editing ?? []).map(({ file, purpose }) => `Правка: ${file} — ${purpose}`),
      ...(entry.page ? [`Страница: ${entry.page}`] : []),
      ...entry.guides.map((path) => `Справка: ${path}`),
      '',
      entry.create,
    ].join('\n');
  }
  if (!entries.length) return 'Совпадений нет. Попробуйте тему или приём: нейрон, 3d, морфинг.';
  return (
    Object.entries(exampleGroups)
      .flatMap(([id, title]) => {
        const groupEntries = entries.filter((entry) => entry.group === id);
        return groupEntries.length
          ? [
              title,
              ...groupEntries.flatMap((entry) => [
                `  ${entry.id.padEnd(22)} ${entry.title}${entry.recommended ? ' · Начать здесь' : ''}${entry.reference ? ' · Эталон оформления' : ''}`,
                `  ${''.padEnd(22)} ${entry.summary}`,
              ]),
              '',
            ]
          : [];
      })
      .join('\n')
      .trimEnd() + '\n\nexamples ИМЯ — кадр, исходник и команда создания; --json — для обработки.'
  );
}

/** The same versioned authoring catalog ships with the runtime and CLI. */
export async function readCatalog() {
  const catalog = JSON.parse(
    await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8'),
  );
  return Object.fromEntries(
    Object.entries(catalog).map(([id, entry]) => [id, { ...entry, page: scenePage }]),
  );
}
