import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPreparedRuntime, assertPreparedDocument } from './runtime-package.mjs';
import { divisionStory } from '../dist/recipes/division-story.js';

const readOptional = (file) =>
  readFile(file, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: expected an object.`);
  return value;
};
const known = (source, keys, label) => {
  const extra = Object.keys(source).find((key) => !keys.includes(key));
  if (extra) throw new Error(`${label}.${extra}: migrate this custom field explicitly.`);
};

/** Old shapes are accepted only here, during an explicit migration on a source copy. */
export function convertLegacyStoryDocument(source, { explanation = false } = {}) {
  object(source, 'legacy document');
  if (!explanation) {
    known(source, ['version', 'title', 'chapters', 'narration'], 'legacy story');
    if (source.version !== undefined && source.version !== 1)
      throw new Error('Unsupported legacy story version.');
    return { ...source, version: 2, models: [], views: [] };
  }
  known(source, ['version', 'title', 'model', 'views', 'score'], 'legacy explanation');
  if (source.version !== undefined && source.version !== 1)
    throw new Error('Unsupported legacy explanation version.');
  const model = object(source.model, 'legacy model');
  known(model, ['id', 'kind', 'count', 'divisor'], 'legacy model');
  if (model.kind !== 'division') throw new Error('Migrate this custom model explicitly.');
  const modelId = model.id ?? 'division';
  const base = divisionStory({
    id: modelId,
    inputs: { count: model.count, divisor: model.divisor },
    ...(source.title !== undefined && { title: source.title }),
    ...(source.views !== undefined && { views: source.views }),
  });
  const views = base.views;
  const reference = (target) =>
    target === 'remainder'
      ? `${modelId}:remainder`
      : (views?.find((view) => view.kind === target)?.id ?? target);
  let chapters;
  if (source.score !== undefined) {
    if (!Array.isArray(source.score) || !source.score.length)
      throw new Error('legacy score: expected non-empty steps.');
    chapters = [
      {
        id: base.chapters[0].id,
        title: base.chapters[0].title,
        beats: source.score.map((beat) => {
          object(beat, 'legacy beat');
          known(beat, ['id', 'action', 'focus', 'hold', 'seconds', 'text'], 'legacy beat');
          if (beat.hold !== undefined && typeof beat.hold !== 'boolean')
            throw new Error('legacy beat.hold: expected a boolean.');
          return {
            id: beat.id,
            ...(beat.action !== undefined && { operation: { model: modelId, name: beat.action } }),
            ...(beat.focus !== undefined && { focus: beat.focus.map(reference) }),
            ...(beat.hold && { hold: 'Время для наблюдения или собственного прогноза' }),
            seconds: beat.seconds ?? (beat.action === 'group' ? 4 : 2),
            ...(beat.text !== undefined && { text: beat.text }),
          };
        }),
      },
    ];
  }
  return { ...base, ...(chapters !== undefined && { chapters }) };
}

const manualRepair = () =>
  Object.assign(
    new Error(
      'This legacy document has custom scene code. Supply the updated scene entry in migration changes; its source will be built and checked before publication.',
    ),
    { code: 'manual_scene_migration_required' },
  );

/** Mutates only the migration snapshot; the ProjectStore journal publishes accepted source and pin. */
export async function migrateStoryDocument(directory, { root, changes = [] } = {}) {
  const [story, explanation] = await Promise.all([
    readOptional(join(directory, 'story.json')),
    readOptional(join(directory, 'explanation.json')),
  ]);
  if (!explanation && !story) return [];
  if (!explanation && JSON.parse(story).version === 2) return migratePreparedEntry(directory);
  if (story && explanation) throw new Error('Choose one authored document before migration.');
  const source = JSON.parse(explanation ?? story);
  const { prepareStoryDocument } = await import(
    pathToFileURL(join(root, 'dist/story/document.js')).href
  );
  const document = prepareStoryDocument(
    convertLegacyStoryDocument(source, { explanation: Boolean(explanation) }),
  ).document;
  const entryChanged = changes.some(
    (change) => /^scene\.(?:js|mjs|ts)$/.test(change.path) && change.content !== null,
  );
  const result = [];
  if (
    !entryChanged &&
    !changes.some((change) => change.path === 'story-project.json' && change.content !== null)
  )
    throw manualRepair();
  const content = JSON.stringify(document, null, 2) + '\n';
  await writeFile(join(directory, 'story.json'), content);
  result.push({ path: 'story.json', content });
  if (explanation) {
    await rm(join(directory, 'explanation.json'));
    result.push({ path: 'explanation.json', content: null });
  }
  return result;
}

/** Explicit pin migration transfers a historically verified runtime-owned entry to the new manifest. */
async function migratePreparedEntry(directory) {
  if (!(await readPreparedRuntime(directory))) return [];
  let previous;
  try {
    previous = await assertPreparedDocument(directory);
  } catch (error) {
    if (['custom_scene_entry', 'runtime_migration_required'].includes(error.code)) return [];
    throw error;
  }
  if (previous.manifest) return [];
  const content = JSON.stringify({ version: 1, modules: [], resources: [] }, null, 2) + '\n';
  await writeFile(join(directory, 'story-project.json'), content);
  await rm(join(directory, 'scene.js'));
  await rm(join(directory, 'index.html'));
  return [
    { path: 'story-project.json', content },
    { path: 'scene.js', content: null },
    { path: 'index.html', content: null },
  ];
}
