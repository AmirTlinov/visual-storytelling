import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readJSON } from '../tools/storage.mjs';
import { projectFiles } from '../tools/project-files.mjs';
import { readBuildMetadata } from './build-payload.mjs';

/** A prepared take belongs to the accepted build, never to editable author sources. */
export async function reuseAcceptedRecording(data, input, target) {
  if (!input.acceptedBuildRevision) return;
  const build = await readBuildMetadata(data, input.acceptedBuildRevision);
  if (
    build?.projectId !== input.projectId ||
    build.revision !== input.acceptedBuildRevision ||
    !build.snapshot ||
    dirname(resolve(build.snapshot)) !== resolve(data, 'snapshots')
  )
    throw new Error('The accepted recording build is unavailable.');
  const saved = await readJSON(join(build.snapshot, '.vstory-input.json'));
  if (!saved?.preparedRevision) return; // A live quiet frame has no recorded preparation.
  const source = await projectFiles(build.snapshot);
  if (source.revision !== saved.preparedRevision)
    throw new Error('The accepted recording snapshot changed.');
  if (!source.files['audio.wav'] || !source.files['timeline.json']) return;
  const reference = build.recordingBuildRevision
    ? await readBuildMetadata(data, build.recordingBuildRevision)
    : build;
  if (
    reference?.projectId !== input.projectId ||
    !reference.snapshot ||
    dirname(resolve(reference.snapshot)) !== resolve(data, 'snapshots') ||
    reference.recordingBuildRevision
  )
    throw new Error('The accepted recording source is unavailable.');
  const recordingSource = { directory: reference.snapshot, buildRevision: reference.revision };
  const authored = await projectFiles(target);
  // Explicit authored media wins; only snapshots receive inherited derived media.
  if (authored.files['audio.wav'] || authored.files['timeline.json']) return recordingSource;
  const recording = await readJSON(join(build.snapshot, 'timeline.json'));
  const stems = Object.keys(recording.stem_sha256 ?? {});
  if (stems.some((file) => !['voice.wav', 'music.wav'].includes(file) || !source.files[file]))
    throw new Error('The accepted recording stems are unavailable.');
  for (const file of ['audio.wav', 'timeline.json', ...stems])
    await copyFile(join(build.snapshot, file), join(target, file));
  return recordingSource;
}
