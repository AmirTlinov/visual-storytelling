import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureWorkingInput } from './revision-input.mjs';
import { digest } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import {
  storyDocumentAPI,
  assertPreparedDocument,
  linkPreparedRuntime,
} from '../tools/runtime-package.mjs';
import { inlineResources } from '../tools/inline-resources.mjs';
import { generatedNarrationHook, playbackHTML, checkNarration } from '../tools/narration.mjs';

/** Prepared components and immutable authored inputs are one ordinary project build. */
export async function prepareLiveProject(data, project) {
  const input = await captureWorkingInput(data, project, project.sourceRevision);
  const snapshot = join(data, 'snapshots', input.inputSnapshot);
  const pin = await assertPreparedDocument(snapshot);
  const { prepareIllustratedDocument } = await storyDocumentAPI(snapshot);
  const document = prepareIllustratedDocument(
    await readJSON(join(snapshot, 'story.json')),
  ).document;
  const template = await readFile(join(pin.root, 'plugin/dist/live.html'), 'utf8');
  const setup = `<script>window.__visualStoryDocument=${JSON.stringify(document).replaceAll('<', '\\u003c')}</script>`;
  let html = template.replace('</head>', () => setup + '</head>');
  const hook = generatedNarrationHook(await readFile(join(snapshot, 'index.html'), 'utf8'));
  if (hook) {
    if (!(await linkPreparedRuntime(snapshot)))
      throw Object.assign(
        new Error(
          'Narrated prepared documents need their pinned runtime link. Use the source build for extra dependencies.',
        ),
        { code: 'custom_scene_entry' },
      );
    await checkNarration(hook, snapshot);
    const media = await inlineResources(snapshot, { audio: true }).markup(playbackHTML(hook));
    html = html.replace('</body>', () => media + '</body>');
  }
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
    live: { runtimeBuild: pin.build, document },
  };
  await writeJSON(join(data, 'builds', revision + '.json'), prepared);
  const receipt = await readJSON(join(snapshot, '.vstory-input.json'));
  await writeJSON(join(snapshot, '.vstory-input.json'), { ...receipt, buildRevision: revision });
  return prepared;
}
