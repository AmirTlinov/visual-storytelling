import { basename, dirname, join, resolve } from 'node:path';
import { rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from './runtime/storage.mjs';
import { projectFiles, snapshotProject } from './project-files.mjs';
import { failure } from './errors.mjs';

/** Resolve and freeze a user's revision before queueing work. Jobs never follow working files. */
export async function revisionInput(data, projects, target) {
  const project = projects.get(target.projectId);
  const base = { projectId: project.id, projectPath: project.path, title: project.title, target };
  if (target.kind === 'build') {
    const build = await readJSON(join(data, 'builds', target.buildRevision + '.json'));
    if (
      build?.projectId !== project.id ||
      build.revision !== target.buildRevision ||
      !build.snapshot
    )
      throw failure(
        'build_unavailable',
        'The selected build has no editable snapshot. Prepare the project again.',
        { action: 'story_open' },
      );
    if (dirname(resolve(build.snapshot)) !== resolve(data, 'snapshots'))
      throw failure(
        'build_unavailable',
        'The selected build snapshot is outside preparation storage.',
      );
    return {
      ...base,
      sourceRevision: build.sourceRevision,
      inputSnapshot: basename(build.snapshot),
      buildRevision: build.revision,
    };
  }
  return projects.serial(project.id, async () => {
    const current = await projects.inspect(project.id);
    if (current.sourceRevision !== target.sourceRevision)
      throw failure(
        'source_conflict',
        'The working revision changed. Inspect it before preparing.',
        { current, action: 'story_inspect' },
      );
    return captureWorkingInput(data, project, target.sourceRevision);
  });
}

/** The worker freezes a newly authored scaffold before exposing it for editing. */
export async function captureWorkingInput(data, project, sourceRevision) {
  const target = { kind: 'working', projectId: project.id, sourceRevision };
  const base = { projectId: project.id, projectPath: project.path, title: project.title, target };
  const inputSnapshot = `input-${project.id}-${sourceRevision}`;
  const snapshot = join(data, 'snapshots', inputSnapshot);
  const receipt = await readJSON(join(snapshot, '.vstory-input.json'));
  if (receipt) {
    if (
      receipt.revision !== target.sourceRevision ||
      (await projectFiles(snapshot)).revision !== receipt.revision
    )
      throw failure(
        'snapshot_changed',
        'The captured source was modified. Prepare a new working revision.',
      );
  } else {
    const staging = `${snapshot}.capturing-${randomUUID()}`;
    try {
      const source = await snapshotProject(project.path, staging, target.sourceRevision);
      await writeJSON(join(staging, '.vstory-input.json'), source);
      await rename(staging, snapshot);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return { ...base, sourceRevision: target.sourceRevision, inputSnapshot };
}
