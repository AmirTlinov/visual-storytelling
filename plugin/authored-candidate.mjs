import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, projectFile, projectFiles, snapshotProject } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { createScene } from '../tools/create-scene.mjs';
import { writeProjectChange } from './project-changes.mjs';

/** Freeze one proposal outside working sources. JobRunner owns its lease after enqueue. */
export async function authoredCandidate(data, project, proposal) {
  const snapshot = join(data, 'snapshots', 'candidate-' + randomUUID());
  await snapshotProject(project.path, snapshot, proposal.args.sourceRevision);
  try {
    for (const entry of proposal.edits) await writeProjectChange(snapshot, entry);
    for (const asset of proposal.assets) {
      if (digest(await readFile(asset.source)) !== asset.hash)
        throw new Error('Runtime archive integrity changed.');
      const target = await projectFile(snapshot, asset.path, { writable: true });
      await mkdir(dirname(target), { recursive: true });
      await copyFile(asset.source, target);
      if (digest(await readFile(target)) !== asset.hash)
        throw new Error('Runtime archive integrity changed.');
    }
    const source = await projectFiles(snapshot);
    await writeJSON(join(snapshot, '.vstory-input.json'), {
      ...source,
      acceptedBuildRevision: project.buildRevision,
    });
    return {
      snapshot,
      input: {
        projectId: project.id,
        projectPath: project.path,
        title: project.title,
        sourceRevision: source.revision,
        inputSnapshot: basename(snapshot),
        acceptedBuildRevision: project.buildRevision,
      },
    };
  } catch (error) {
    await rm(snapshot, { recursive: true, force: true });
    throw error;
  }
}

/** Collect a new scene's authored transition and immutable runtime asset for the same journal. */
export async function creationCandidate(data, project, options) {
  const snapshot = join(data, 'snapshots', 'candidate-' + randomUUID());
  try {
    const created = await createScene(snapshot, options);
    const manifest = await readJSON(join(project.path, 'story.vstory'));
    if (manifest?.format !== 1 || manifest.id !== project.id)
      throw new Error('Project identity changed before preparing its creation.');
    await writeJSON(join(snapshot, 'story.vstory'), manifest);
    const source = await projectFiles(snapshot);
    const changes = [],
      assets = [];
    for (const name of Object.keys(source.files)) {
      const file = await projectFile(snapshot, name);
      if (/^dependencies\/visual-storytelling-core-[a-f0-9]{64}\.tgz$/.test(name)) {
        assets.push({ path: name, source: file, hash: source.files[name] });
      } else {
        const bytes = await readFile(file),
          content = bytes.toString('utf8');
        if (bytes.length > 1_000_000 || bytes.includes(0) || !Buffer.from(content).equals(bytes))
          throw new Error(
            `Creation needs an authored file outside the transaction contract: ${name}`,
          );
        changes.push({ path: name, content });
      }
    }
    await writeJSON(join(snapshot, '.vstory-input.json'), source);
    return {
      created,
      snapshot,
      sourceRevision: source.revision,
      changes,
      assets,
      inputSnapshot: basename(snapshot),
    };
  } catch (error) {
    await rm(snapshot, { recursive: true, force: true });
    throw error;
  }
}
