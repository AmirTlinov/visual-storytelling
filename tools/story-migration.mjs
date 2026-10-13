import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPreparedRuntime } from './runtime-package.mjs';
import { assertPreparedRuntimeRoot } from './prepared-runtime-trust.mjs';

const optional = (file) =>
  readFile(file, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
const withoutTitle = (html) => html.replace(/<title>.*?<\/title>/s, '<title></title>');

/** Explicit migration only: return candidate edits; ProjectStore publishes and undoes them. */
export async function legacyStoryChanges(directory, { root }) {
  const legacy = await optional(join(directory, 'explanation.json'));
  const story = await optional(join(directory, 'story.json'));
  if (legacy === null && story === null) return [];
  root = await assertPreparedRuntimeRoot(root, { modules: ['dist/story/document.js'] });
  const { normalizeStoryDocument, validateStoryDocument } = await import(
    pathToFileURL(join(root, 'dist/story/document.js')).href
  );
  if (legacy === null) {
    const previous = JSON.parse(story);
    if (previous.version !== undefined) {
      validateStoryDocument(previous);
      return [];
    }
    if (previous.models !== undefined || previous.views !== undefined)
      throw new Error(
        'An unversioned story already declares models or views. Supply a complete version 1 StoryDocument in migration changes.',
      );
    // Existing illustrated chapter modules retain their source and metadata. The
    // candidate build verifies those modules against the selected runtime.
    const document = validateStoryDocument({ version: 1, models: [], views: [], ...previous });
    return [{ path: 'story.json', content: JSON.stringify(document, null, 2) + '\n' }];
  }
  if (story !== null)
    throw new Error(
      'Migration found both story.json and explanation.json. Choose one authored document in the migration changes.',
    );
  const pin = await readPreparedRuntime(directory);
  if (!pin)
    throw new Error('Legacy explanation migration requires its original prepared runtime pin.');
  const [entry, template, page, templatePage, config] = await Promise.all([
    optional(join(directory, 'scene.js')),
    optional(join(pin.root, 'tools/explanation/scene.js')),
    optional(join(directory, 'index.html')),
    optional(join(pin.root, 'tools/explanation/index.html')),
    optional(join(directory, 'scene.json')),
  ]);
  if (
    !template ||
    !page ||
    !templatePage ||
    entry !== template ||
    withoutTitle(page) !== withoutTitle(templatePage) ||
    config
  )
    throw new Error(
      'The legacy explanation has custom source code. Supply the complete story.json, scene.js and explanation.json deletion as explicit migration changes.',
    );
  await assertPreparedRuntimeRoot(pin.root, { modules: ['dist/explanation/document.js'] });
  const { validateExplanation } = await import(
    pathToFileURL(join(pin.root, 'dist/explanation/document.js')).href
  );
  const previous = validateExplanation(JSON.parse(legacy));
  const base = normalizeStoryDocument({
    model: previous.model,
    ...(previous.title !== undefined && { title: previous.title }),
  });
  const document = validateStoryDocument({
    ...base,
    views: previous.views,
    ...(previous.score !== undefined && {
      chapters: [
        {
          id: 'division',
          title: previous.title ?? 'Деление с остатком',
          beats: previous.score.map((beat) => ({
            id: beat.id,
            say: '',
            seconds: beat.seconds ?? (beat.action === 'group' ? 4 : 2),
            ...(beat.text !== undefined && { text: beat.text }),
            ...(beat.hold && { hold: 'Рассмотрите состояние' }),
            ...((beat.action !== undefined || beat.focus !== undefined) && {
              staging: {
                model: previous.model.id,
                ...(beat.action !== undefined && { operation: beat.action }),
                ...(beat.focus !== undefined && { focus: beat.focus }),
              },
            }),
          })),
        },
      ],
    }),
  });
  const nextPage = await readFile(join(root, 'tools/story/index.html'), 'utf8');
  const title = page.match(/<title>.*?<\/title>/s)?.[0];
  return [
    { path: 'story.json', content: JSON.stringify(document, null, 2) + '\n' },
    { path: 'scene.js', content: await readFile(join(root, 'tools/story/scene.js'), 'utf8') },
    {
      path: 'index.html',
      content: title ? nextPage.replace(/<title>.*?<\/title>/s, () => title) : nextPage,
    },
    { path: 'explanation.json', content: null },
  ];
}
