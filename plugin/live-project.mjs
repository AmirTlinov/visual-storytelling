import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { storyProjectOwner } from '../tools/story-project.mjs';
import { captureWorkingInput } from './revision-input.mjs';
import { digest } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { storyDocumentAPI, assertPreparedDocument } from '../tools/runtime-package.mjs';

/** Prepared components and immutable authored inputs are one ordinary project build. */
export async function prepareLiveProject(data, project) {
  const input = await captureWorkingInput(data, project, project.sourceRevision);
  const snapshot = join(data, 'snapshots', input.inputSnapshot);
  const pin = await assertPreparedDocument(snapshot);
  const source = await readJSON(join(snapshot, 'story.json'));
  const document = pin.manifest?.modules.length
    ? source
    : (await storyDocumentAPI(snapshot)).prepareIllustratedDocument(source).document;
  const template = await readFile(join(pin.root, 'plugin/dist/live.html'), 'utf8');
  const setup = `<script>window.__visualStoryDocument=${JSON.stringify(document).replaceAll('<', '\\u003c')}</script>`;
  const html =
    pin.manifest?.modules.length || pin.manifest?.resources.length
      ? (
          await import(pathToFileURL(join(pin.root, 'tools/prepare-story-project.mjs')).href).then(
            ({ preparedStoryHTML }) => preparedStoryHTML(snapshot),
          )
        ).html
      : template.replace('</head>', () => setup + '</head>');
  const revision = digest(
    JSON.stringify({
      projectId: project.id,
      sourceRevision: project.sourceRevision,
      runtime: pin.build,
      html,
    }),
  );
  const prepared = {
    projectId: project.id,
    title: project.title,
    revision,
    sourceRevision: project.sourceRevision,
    snapshot,
    html,
    live: {
      runtimeBuild: pin.build,
      moduleRevision: pin.manifest ? await storyProjectOwner(snapshot) : undefined,
      document,
      ...(pin.manifest?.modules.length && { modules: pin.manifest.modules }),
    },
  };
  await writeJSON(join(data, 'builds', revision + '.json'), prepared);
  const receipt = await readJSON(join(snapshot, '.vstory-input.json'));
  await writeJSON(join(snapshot, '.vstory-input.json'), { ...receipt, buildRevision: revision });
  return prepared;
}
