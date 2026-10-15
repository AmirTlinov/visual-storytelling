import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { storyProjectOwner } from '../tools/story-project.mjs';
import { captureWorkingInput } from './revision-input.mjs';
import { digest } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { storyDocumentAPI, assertPreparedDocument } from '../tools/runtime-package.mjs';
import { payloadWork, preparedPresentation, writePreparedBuild } from './build-payload.mjs';

/** Prepared components and immutable authored inputs are one ordinary project build. */
export async function prepareLiveProject(data, project, toolchainRoot) {
  if (typeof toolchainRoot !== 'string')
    throw new Error('A live project needs its owned toolchain.');
  const input = await captureWorkingInput(data, project, project.sourceRevision);
  const snapshot = join(data, 'snapshots', input.inputSnapshot);
  const pin = await assertPreparedDocument(snapshot);
  const source = await readJSON(join(snapshot, 'story.json'));
  const document = pin.manifest?.modules.length
    ? source
    : (await storyDocumentAPI(snapshot)).prepareIllustratedDocument(source).document;
  const moduleRevision = pin.manifest ? await storyProjectOwner(snapshot) : undefined;
  const work = payloadWork();
  const presentation = await preparedPresentation(
    data,
    digest(JSON.stringify({ runtime: pin.build, moduleRevision })),
    async () =>
      pin.manifest?.modules.length || pin.manifest?.resources.length
        ? (
            await import(
              pathToFileURL(join(toolchainRoot, 'tools/prepare-story-project.mjs')).href
            ).then(({ preparedStoryTemplate }) => preparedStoryTemplate(snapshot))
          ).html
        : readFile(join(pin.root, 'plugin/dist/live.html'), 'utf8'),
    work,
  );
  const revision = digest(
    JSON.stringify({
      projectId: project.id,
      sourceRevision: project.sourceRevision,
      runtime: pin.build,
      presentation,
      document,
    }),
  );
  const prepared = {
    projectId: project.id,
    title: project.title,
    revision,
    sourceRevision: project.sourceRevision,
    snapshot,
    presentation,
    work: { payload: work },
    live: {
      runtimeBuild: pin.build,
      moduleRevision,
      document,
      ...(pin.manifest?.modules.length && { modules: pin.manifest.modules }),
    },
  };
  await writePreparedBuild(data, prepared);
  const receipt = await readJSON(join(snapshot, '.vstory-input.json'));
  await writeJSON(join(snapshot, '.vstory-input.json'), { ...receipt, buildRevision: revision });
  return prepared;
}
