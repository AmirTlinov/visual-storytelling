import { readFile, access, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { projectFiles, digest } from './project-files.mjs';
export const storyProjectFile = 'story-project.json';
export const storyProjectOwnerFiles = new Set([
  'story.json',
  storyProjectFile,
  'scene-runtime.json',
  'package.json',
  'package-lock.json',
  'voice.json',
]);
/** Code/resources own hot replacement; a document edit retains their identity. */
export async function storyProjectOwner(directory) {
  const { files } = await projectFiles(directory);
  const editorial = new Set([
    'story.json',
    'package.json',
    'package-lock.json',
    'scene-runtime.json',
  ]);
  return digest(
    JSON.stringify(
      Object.fromEntries(Object.entries(files).filter(([file]) => !editorial.has(file))),
    ),
  );
}
const local = (value) =>
  typeof value === 'string' &&
  value.length <= 200 &&
  !value.startsWith('.') &&
  !value.includes('\\') &&
  value.split('/').every((part) => part && part !== '.' && part !== '..') &&
  !value.includes(':');
/** Explicit entry ownership. Authored modules/resources never disappear behind a scaffold comparison. */
export async function readStoryProject(directory) {
  const text = await readFile(join(directory, storyProjectFile), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (text === null) return null;
  const value = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.version !== 1 ||
    Object.keys(value).some((key) => !['version', 'modules', 'resources'].includes(key)) ||
    !Array.isArray(value.modules) ||
    value.modules.length > 12 ||
    !Array.isArray(value.resources) ||
    value.resources.length > 64
  )
    throw new Error('story-project.json: provide version 1, modules and resources.');
  const ids = new Set();
  const ownFile = async (file, pattern) => {
    if (!local(file) || !pattern.test(file))
      throw new Error(`Invalid authored resource path: ${file}`);
    if (storyProjectOwnerFiles.has(file))
      throw new Error(`This file belongs to a project owner, not an authored resource: ${file}`);
    const physical = await realpath(join(directory, file));
    if (!physical.startsWith((await realpath(directory)) + sep))
      throw new Error('Authored resources must remain inside the project.');
  };
  for (const module of value.modules) {
    if (
      !module ||
      Object.keys(module).some((key) => !['id', 'model', 'subject'].includes(key)) ||
      typeof module.id !== 'string' ||
      !/^[a-z][a-z0-9.-]{0,79}$/.test(module.id) ||
      ids.has(module.id)
    )
      throw new Error(
        'story-project.json: modules need unique IDs, model and subject source files.',
      );
    ids.add(module.id);
    await ownFile(module.model, /\.[cm]?[jt]s$/);
    await ownFile(module.subject, /\.[cm]?[jt]s$/);
  }
  for (const resource of value.resources)
    await ownFile(resource, /\.(?:css|json|svg|png|jpg|jpeg|webp|woff2|wav|m4a|mp3|mp4|glb)$/);
  if (new Set(value.resources).size !== value.resources.length)
    throw new Error('Declared resources must be distinct.');
  for (const name of ['index.html', 'scene.js', 'scene.ts', 'scene.json'])
    if (
      await access(join(directory, name)).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      )
    )
      throw new Error(
        `story-project.json owns the entry. Remove competing ${name} or remove the manifest to author a source entry.`,
      );
  await access(join(directory, 'story.json'));
  return value;
}

export function storyModuleSource(manifest, directory) {
  const imports = manifest.modules
    .flatMap((module, index) => [
      `import model${index} from ${JSON.stringify(resolve(directory, module.model))};`,
      `import subject${index} from ${JSON.stringify(resolve(directory, module.subject))};`,
    ])
    .join('\n');
  return `${imports}\nexport const modules={${manifest.modules.map((module, index) => `${JSON.stringify(module.id)}:model${index}`).join(',')}};
export const subjects={${manifest.modules.map((module, index) => `${JSON.stringify(module.id)}:subject${index}`).join(',')}};`;
}

export function storyProjectSource(manifest, directory) {
  return `import {IllustratedStory} from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import storyDocument from ${JSON.stringify(join(directory, 'story.json'))};
${manifest.resources
  .filter((file) => file.endsWith('.css'))
  .map((file) => `import ${JSON.stringify(join(directory, file))};`)
  .join('\n')}
${storyModuleSource(manifest, directory)}
window.galleryReady=IllustratedStory.mount(document.querySelector('main'),{document:storyDocument,modules,subjects,audio:document.querySelector('[data-story-audio]')});`;
}
export function storyProjectPage(source, title = 'Визуальное объяснение') {
  const escaped = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaped}</title></head><body class="ve-standalone"><main class="ve-scene"></main><script type="module">${source.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
