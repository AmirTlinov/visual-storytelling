import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleGroups, selectExamples } from './catalog-query.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export function exampleDetails(entry) {
  const directory = resolve(workspace, 'examples', entry.id);
  return {
    ...entry,
    directory,
    source: resolve(directory, entry.source),
    page: resolve(workspace, 'site', entry.id, entry.page),
    preview: resolve(directory, 'preview.png'),
    guides: (entry.guides ?? []).map((path) => resolve(workspace, path)),
    create: `node ${quote(resolve(workspace, 'tools/scene.mjs'))} new ./my-story --example ${entry.id}`,
  };
}

export function describeExamples(catalog, { query = '', group, recommended, json = false } = {}) {
  if (group && !Object.hasOwn(exampleGroups, group))
    throw new Error(`Choose a group: ${Object.keys(exampleGroups).join(', ')}`);
  const entries = selectExamples(catalog, { query, group, recommended });
  const exact = entries.find((entry) => entry.id === query);
  if (json) return JSON.stringify((exact ? [exact] : entries).map(exampleDetails), null, 2);
  if (exact) {
    const entry = exampleDetails(exact);
    return [
      `${entry.title} (${entry.id})`,
      entry.summary,
      `${exampleGroups[entry.group]}${entry.recommended ? ' · Начать здесь' : ''}${entry.reference ? ' · Эталон оформления' : ''}`,
      '',
      `Кадр: ${entry.preview}`,
      `Исходник: ${entry.source}`,
      `Страница: ${entry.page}`,
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

/** Examples belong to the authoring workspace, never to the scene's runtime dependency. */
export async function readCatalog({ optional = false } = {}) {
  try {
    return JSON.parse(await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (optional) return undefined;
    throw new Error(
      'Examples live in the visual-explainer workspace. Create scenes with its tools/scene.mjs; the installed CLI builds and serves existing scene directories.',
    );
  }
}
