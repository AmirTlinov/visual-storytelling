import { readFile, mkdir, mkdtemp, cp, symlink, access, rm, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { snapshotProject, projectFiles, digest } from '../tools/project-files.mjs';
import { writeJSON, readJSON } from '../tools/storage.mjs';
import { prepareEnvironment } from '../tools/environment.mjs';
import { buildNarration } from '../tools/narration.mjs';
import { narrationProvider } from '../tools/voice/settings.mjs';
import {
  linkPreparedRuntime,
  assertPreparedDocument,
  storyDocumentAPI,
} from '../tools/runtime-package.mjs';
import { readPreparedRuntime, preparedRuntimeFile } from '../tools/runtime-reference.mjs';
import { contentDigest } from '../tools/build-info.mjs';
import { readStoryProject, storyProjectOwner } from '../tools/story-project.mjs';
import { renderer } from '../tools/render.mjs';
import { reuseAcceptedRecording } from './accepted-recording.mjs';
import { writePreparedBuild, readPreparedBuild, payloadWork } from './build-payload.mjs';
const execute = promisify(execFile);

async function dependencies(source, data, { signal, progress }) {
  if (await linkPreparedRuntime(source)) return;
  const preparedPin = await readPreparedRuntime(source);
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const inputs = await projectFiles(source);
  if (!inputs.files['package-lock.json'])
    throw new Error(
      'This project needs package-lock.json. Run npm install --package-lock-only --ignore-scripts in its directory, then reopen it.',
    );
  const dependencyFiles = Object.fromEntries(
    Object.entries(inputs.files).filter(
      ([name]) =>
        name === 'package.json' ||
        name === 'package-lock.json' ||
        name === preparedRuntimeFile ||
        name.endsWith('.tgz'),
    ),
  );
  const key = digest(
    JSON.stringify({
      files: dependencyFiles,
      platform: process.platform,
      arch: process.arch,
      abi: process.versions.modules,
    }),
  );
  const target = join(data, 'dependencies', key);
  if (
    !(await access(join(target, 'node_modules')).then(
      () => true,
      () => false,
    ))
  ) {
    progress('Подготавливаю зависимости…');
    await mkdir(dirname(target), { recursive: true });
    const staging = await mkdtemp(target + '.preparing-');
    try {
      for (const name of Object.keys(dependencyFiles)) {
        await mkdir(dirname(join(staging, name)), { recursive: true });
        await cp(join(source, name), join(staging, name));
      }
      for (const entries of [
        pkg.dependencies,
        pkg.devDependencies,
        pkg.optionalDependencies,
        pkg.peerDependencies,
      ])
        for (const value of Object.values(entries ?? {}))
          if (
            typeof value === 'string' &&
            value.startsWith('file:') &&
            value !== preparedPin?.dependency &&
            (!value.endsWith('.tgz') ||
              value.includes('\\') ||
              value.slice(5).split('/').includes('..') ||
              value.slice(5).startsWith('/'))
          )
            throw new Error('Use a pinned archive inside the project for local dependencies.');
      await execute(
        'npm',
        [
          'ci',
          '--include=dev',
          '--include=optional',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        { cwd: staging, signal, maxBuffer: 2_000_000 },
      );
      await mkdir(join(staging, 'node_modules'), { recursive: true });
      if ((await projectFiles(staging)).revision !== digest(JSON.stringify(dependencyFiles)))
        throw new Error(
          'Dependency inputs changed during installation. Inspect the lockfile before retrying.',
        );
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  await symlink(join(target, 'node_modules'), join(source, 'node_modules'), 'dir');
}

async function prepare(input, task) {
  const { data, projectPath, sourceRevision } = input;
  const snapshot = join(data, 'snapshots', task.jobId);
  task.progress('Сохраняю исходники…');
  let original, receipt, captured;
  const preparation = { silent: input.options?.silent === true };
  for (const id of new Set([input.resumeFrom, input.inputSnapshot].filter(Boolean))) {
    const candidate = join(data, 'snapshots', id);
    const saved = await readJSON(join(candidate, '.vstory-input.json'));
    if (!saved || (sourceRevision && saved.revision !== sourceRevision)) continue;
    // An explicitly selected build is immutable, including its audio. A working
    // retry can only reuse preparation made for the same narration choice.
    if (
      !input.buildRevision &&
      saved.preparedRevision &&
      (saved.preparation?.silent ?? false) !== preparation.silent
    )
      continue;
    const revision = saved.preparedRevision ?? saved.revision;
    const valid = await projectFiles(candidate).then(
      (value) => value.revision === revision,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (valid) {
      original = candidate;
      receipt = saved;
      captured = revision;
      break;
    }
  }
  if (input.resumeFrom && !receipt && !sourceRevision)
    throw new Error(
      'The original preparation inputs expired. Open the project to prepare its current revision.',
    );
  const reusable = Boolean(receipt);
  let source;
  if (reusable) {
    await snapshotProject(original, snapshot, captured);
    source = { revision: receipt.revision, files: receipt.files };
  } else {
    if (input.inputSnapshot)
      throw new Error(
        'The selected immutable inputs are unavailable or changed. Choose a new revision.',
      );
    source = await snapshotProject(projectPath, snapshot, sourceRevision ?? receipt?.revision);
  }
  await writeJSON(join(snapshot, '.vstory-input.json'), {
    ...source,
    preparation,
    acceptedBuildRevision: input.acceptedBuildRevision,
  });
  await dependencies(snapshot, data, task);
  const voice = await readJSON(join(snapshot, 'voice.json'));
  if (voice?.enabled && !preparation.silent && !(reusable && receipt.preparedRevision)) {
    await reuseAcceptedRecording(data, input, snapshot);
    const localHiggs = narrationProvider(voice) === 'higgs';
    await prepareEnvironment(data, {
      ...task,
      voice: localHiggs,
      encoder: true,
    });
    await buildNarration(snapshot, {
      ...task,
      cache: join(data, 'speech'),
      managedProcessGroup: Boolean(task.jobId),
    });
  }
  task.signal.throwIfAborted();
  const preparedRevision = (await projectFiles(snapshot)).revision;
  let prepared;
  const buildRevision = input.buildRevision ?? (reusable && receipt.buildRevision);
  if (buildRevision) {
    prepared = await readPreparedBuild(data, buildRevision);
    // A live receipt identifies the same immutable sources. Produce compiles their
    // ordinary entry for the first time; there is no per-operation dist archive.
    if (prepared?.live && prepared.sourceRevision === source.revision && reusable) {
      prepared = undefined;
    } else {
      if (
        !prepared ||
        prepared.sourceRevision !== source.revision ||
        !prepared.outputDigest ||
        !reusable ||
        (await contentDigest(join(original, 'dist'), ['.'])) !== prepared.outputDigest
      )
        throw new Error(
          'The selected prepared build is unavailable or changed. Prepare a new revision.',
        );
      await cp(join(original, 'dist'), join(snapshot, 'dist'), { recursive: true });
    }
  }
  await writeJSON(join(snapshot, '.vstory-input.json'), {
    ...source,
    preparedRevision,
    buildRevision: prepared?.revision,
    preparation,
    acceptedBuildRevision: input.acceptedBuildRevision,
  });
  return {
    snapshot,
    source,
    preparedRevision,
    prepared,
    preparation,
    silent: preparation.silent || voice?.enabled === false,
  };
}

export async function unchangedInputs(snapshot, revision) {
  if ((await projectFiles(snapshot)).revision !== revision)
    throw new Error(
      'Preparation changed its source inputs. Generators must write only to VISUAL_STORY_OUTPUT. Fix the generator and prepare the new project revision.',
    );
}

/** Build once; live preview, review and delivery consume the same verified artifact. */
export async function buildPreparedSnapshot(input, task, result) {
  if (result.prepared) return result;
  const { snapshot, source, preparedRevision, silent } = result;
  const output = join(snapshot, 'dist');
  task.progress('Собираю объяснение…');
  await buildScene(snapshot, output, {
    data: input.data,
    progress: task.progress,
    signal: task.signal,
    silent,
  });
  const documentProject = await readStoryProject(snapshot);
  let preparedDocument;
  if (documentProject) {
    // Authored modules execute in the existing Chromium renderer, never in the MCP/store process.
    const render = await renderer({
      directory: output,
      width: 960,
      controls: true,
      signal: task.signal,
    });
    try {
      preparedDocument = await render.page.evaluate(
        () => document.querySelector('main').scene.authoring.document,
      );
      const diagnostics = await render.capture.evaluate((scene) => scene.diagnostics());
      if (diagnostics.length) throw new Error(diagnostics.join('\n'));
    } finally {
      await render.close();
    }
  }
  task.signal.throwIfAborted();
  const html = await packDirectory(output, 'index.html', {
    audio: 'original',
    signal: task.signal,
  });
  await unchangedInputs(snapshot, preparedRevision);
  const outputDigest = await contentDigest(output, ['.']);
  const revision = digest(
    JSON.stringify({
      projectId: input.projectId,
      sourceRevision: source.revision,
      title: input.title,
      html,
      outputDigest,
    }),
  );
  const prepared = {
    title: input.title,
    projectId: input.projectId,
    sourceRevision: source.revision,
    revision,
    html,
    snapshot,
    outputDigest,
  };
  const preparedPin = await readPreparedRuntime(snapshot);
  if (preparedPin) {
    const recipe = await assertPreparedDocument(snapshot).catch((error) => {
      // The pinned package already owns a complete source-built artifact.
      // New document metadata is optional; authoring still requires explicit migration.
      if (!['custom_scene_entry', 'runtime_migration_required'].includes(error.code)) throw error;
      return null;
    });
    if (recipe)
      prepared.live = {
        runtimeBuild: recipe.build,
        moduleRevision: recipe.manifest ? await storyProjectOwner(snapshot) : undefined,
        document:
          preparedDocument ??
          (await storyDocumentAPI(snapshot)).prepareIllustratedDocument(
            await readJSON(join(snapshot, 'story.json')),
          ).document,
        ...(recipe.manifest?.modules.length && { modules: recipe.manifest.modules }),
      };
  }
  const work = payloadWork();
  prepared.work = { payload: work };
  const stored = await writePreparedBuild(input.data, prepared, work);
  await writeJSON(join(snapshot, '.vstory-input.json'), {
    ...source,
    preparedRevision,
    buildRevision: revision,
    preparation: result.preparation,
  });
  const accepted = await readJSON(join(stored.snapshot, '.vstory-input.json'));
  return {
    ...result,
    snapshot: stored.snapshot,
    preparedRevision: accepted?.preparedRevision ?? accepted?.revision,
    prepared: stored,
  };
}

export async function prepareBuild(input, task) {
  return buildPreparedSnapshot(input, task, await prepare(input, task));
}
