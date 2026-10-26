import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { storyProjectOwner } from '../tools/story-project.mjs';
import { captureWorkingInput } from './revision-input.mjs';
import { digest, projectFiles } from '../tools/project-files.mjs';
import { failure } from './errors.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { storyDocumentAPI, assertPreparedDocument } from '../tools/runtime-package.mjs';
import { payloadWork, preparedPresentation, writePreparedBuild } from './build-payload.mjs';

/** Prepared components and immutable authored inputs are one ordinary project build. */
export async function prepareLiveProject(data, project, toolchainRoot, captured) {
  if (typeof toolchainRoot !== 'string')
    throw new Error('A live project needs its owned toolchain.');
  if (
    captured &&
    (captured.projectId !== project.id ||
      captured.sourceRevision !== project.sourceRevision ||
      typeof captured.inputSnapshot !== 'string' ||
      dirname(resolve(data, 'snapshots', captured.inputSnapshot)) !== resolve(data, 'snapshots') ||
      resolve(data, 'snapshots', captured.inputSnapshot) !== resolve(project.path))
  )
    throw new Error('Captured live inputs must belong to this project revision and snapshot.');
  const input = captured ?? (await captureWorkingInput(data, project, project.sourceRevision));
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
  if ((await projectFiles(snapshot)).revision !== project.sourceRevision)
    throw failure('snapshot_changed', 'The captured live inputs changed during preparation.');
  if (captured) {
    const identity = await readJSON(join(snapshot, 'story.vstory'));
    if (identity?.format !== 1 || identity.id !== project.id)
      throw failure('project_conflict', 'The captured live project identity changed.');
  }
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
  const receipt = await readJSON(join(snapshot, '.vstory-input.json'));
  await writeJSON(join(snapshot, '.vstory-input.json'), { ...receipt, buildRevision: revision });
  return writePreparedBuild(data, prepared);
}
