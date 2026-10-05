import {
  readFile,
  mkdir,
  mkdtemp,
  cp,
  symlink,
  access,
  rm,
  rename,
  realpath,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createScene } from '../tools/create-scene.mjs';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { deliver } from '../tools/deliver.mjs';
import { snapshotProject, projectFiles, projectFile, digest } from './project-files.mjs';
import { writeJSON, readJSON } from './runtime/storage.mjs';
import { prepareEnvironment } from './environment.mjs';
import { buildNarration } from '../tools/narration.mjs';
import { updateSceneRuntime } from '../tools/runtime-package.mjs';
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

async function dependencies(source, data, { signal, progress }) {
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const inputs = await projectFiles(source);
  if (!inputs.files['package-lock.json'])
    throw new Error(
      'This project needs package-lock.json. Run npm install --package-lock-only --ignore-scripts in its directory, then reopen it.',
    );
  const dependencyFiles = Object.fromEntries(
    Object.entries(inputs.files).filter(
      ([name]) => name === 'package.json' || name === 'package-lock.json' || name.endsWith('.tgz'),
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
  const original = input.resumeFrom && join(data, 'snapshots', input.resumeFrom);
  const receipt = original && (await readJSON(join(original, '.vstory-input.json')));
  if (original && !receipt && !sourceRevision)
    throw new Error(
      'The original preparation inputs expired. Open the project to prepare its current revision.',
    );
  const captured = receipt && (receipt.preparedRevision ?? receipt.revision);
  const reusable =
    receipt &&
    (!sourceRevision || receipt.revision === sourceRevision) &&
    (await projectFiles(original).then(
      (value) => value.revision === captured,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    ));
  let source;
  if (reusable) {
    await snapshotProject(original, snapshot, captured);
    source = { revision: receipt.revision, files: receipt.files };
  } else source = await snapshotProject(projectPath, snapshot, sourceRevision ?? receipt?.revision);
  await writeJSON(join(snapshot, '.vstory-input.json'), source);
  await dependencies(snapshot, data, task);
  const voice = await readJSON(join(snapshot, 'voice.json'));
  if (voice?.enabled) await buildNarration(snapshot, { ...task, cache: join(data, 'speech') });
  task.signal.throwIfAborted();
  const preparedRevision = (await projectFiles(snapshot)).revision;
  await writeJSON(join(snapshot, '.vstory-input.json'), { ...source, preparedRevision });
  return { snapshot, source, preparedRevision, silent: voice?.enabled === false };
}

async function unchangedInputs(snapshot, revision) {
  if ((await projectFiles(snapshot)).revision !== revision)
    throw new Error(
      'Preparation changed its source inputs. Generators must write only to VISUAL_STORY_OUTPUT. Fix the generator and prepare the new project revision.',
    );
}

export const workflows = {
  async migrate(input, task) {
    const snapshot = join(input.data, 'snapshots', task.jobId);
    await snapshotProject(input.projectPath, snapshot, input.sourceRevision);
    task.progress('Подготавливаю новую библиотеку…');
    const updated = await updateSceneRuntime(snapshot, { root, build: false, signal: task.signal });
    if (!updated.changed) return { upToDate: true };
    const preparedRevision = (await projectFiles(snapshot)).revision;
    await buildScene(snapshot, join(snapshot, 'dist'), { signal: task.signal });
    await unchangedInputs(snapshot, preparedRevision);
    const path = updated.dependency.replace(/^file:(?:\.\/)?/, '');
    const bytes = await readFile(join(snapshot, path));
    return {
      migration: {
        changes: await Promise.all(
          ['package.json', 'package-lock.json'].map(async (name) => ({
            path: name,
            content: await readFile(join(snapshot, name), 'utf8'),
          })),
        ),
        assets: [{ path, source: join(snapshot, path), hash: digest(bytes) }],
      },
    };
  },
  async create(input, task) {
    task.progress('Создаю проект…');
    const exists =
      input.resumeFrom &&
      (await access(join(input.projectPath, 'package.json')).then(
        () => true,
        () => false,
      ));
    const created = exists
      ? { directory: input.projectPath, example: input.example }
      : await createScene(input.projectPath, {
          root,
          example: input.example,
          deferAudio: true,
          signal: task.signal,
        });
    return {
      ...created,
      ...(await workflows.build(
        { ...input, resumeFrom: exists ? input.resumeFrom : undefined, sourceRevision: undefined },
        task,
      )),
    };
  },
  async build(input, task) {
    const { snapshot, source, preparedRevision, silent } = await prepare(input, task);
    const output = join(snapshot, 'dist');
    task.progress('Собираю объяснение…');
    await buildScene(snapshot, output, { signal: task.signal, silent });
    task.signal.throwIfAborted();
    const html = await packDirectory(output, 'index.html', {
      audio: 'original',
      signal: task.signal,
    });
    await unchangedInputs(snapshot, preparedRevision);
    const revision = digest(
      JSON.stringify({
        projectId: input.projectId,
        sourceRevision: source.revision,
        title: input.title,
        html,
      }),
    );
    const build = {
      title: input.title,
      projectId: input.projectId,
      sourceRevision: source.revision,
      revision,
      html,
      snapshot,
    };
    await writeJSON(join(input.data, 'builds', revision + '.json'), build);
    return { buildRevision: revision, sourceRevision: source.revision, snapshot };
  },
  async produce(input, task) {
    const { snapshot, source, silent } = await prepare(input, task);
    const formats = input.options?.formats ?? ['html'];
    await prepareEnvironment(input.data, {
      ...task,
      browser: formats.some((format) => ['mp4', 'srt', 'vtt'].includes(format)),
      encoder:
        formats.includes('mp4') ||
        (await access(join(snapshot, 'audio.wav')).then(
          () => true,
          () => false,
        )),
    });
    task.progress('Готовлю выпуск…');
    const output = join(input.projectPath, 'artifacts', task.jobId);
    const result = await deliver(snapshot, {
      ...input.options,
      silent: input.options?.silent ?? silent,
      out: output,
      prepareAudio: false,
      signal: task.signal,
      onProgress: (done, total) => task.progress('Собираю видео…', { done, total }),
    });
    return {
      ...result,
      sourceRevision: source.revision,
      files: result.files.map((file) => join(output, file)),
    };
  },
  async review(input, task) {
    const { snapshot, source, preparedRevision, silent } = await prepare(input, task);
    const cli = join(snapshot, 'node_modules/@visual-storytelling/core/tools/scene.mjs');
    await access(cli).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(
        'The pinned project runtime has no review CLI. Migrate this project before reviewing it.',
      );
    });
    task.progress('Собираю сцену для просмотра…');
    await buildScene(snapshot, join(snapshot, 'dist'), { signal: task.signal, silent });
    await unchangedInputs(snapshot, preparedRevision);
    await prepareEnvironment(input.data, { ...task, browser: true });
    const options = input.options ?? {};
    const args = [cli, 'review', join(snapshot, 'dist')];
    for (const key of ['cue', 'from', 'seconds', 'frames', 'width', 'height', 'theme', 'object'])
      if (options[key] !== undefined) args.push('--' + key, String(options[key]));
    if (options.reduced) args.push('--reduced');
    if (options.crop) {
      const { x, y, width, height } = options.crop;
      args.push('--crop', [x, y, width, height].join(','));
    }
    if (options.scenario) args.push('--scenario', await projectFile(snapshot, options.scenario));
    const parent = join(input.projectPath, 'artifacts');
    await mkdir(parent, { recursive: true });
    const output = join(parent, task.jobId + '-review');
    // Reports contain their own absolute inspection command. Keep that location stable,
    // claim a fresh directory, and expose it only after the complete review passes its guard.
    await mkdir(output);
    try {
      task.progress('Просматриваю сцену и сохраняю наблюдения…');
      const { stdout } = await execute(process.execPath, [...args, '--out', output], {
        cwd: snapshot,
        signal: task.signal,
        maxBuffer: 2_000_000,
      }).catch((error) => {
        // Exit 2 is a completed review that recorded an interaction error. Its evidence
        // is the result the author needs; only execution failure discards partial output.
        if (error.code === 2 && !task.signal.aborted) return { stdout: error.stdout };
        throw error;
      });
      const result = JSON.parse(stdout);
      task.signal.throwIfAborted();
      await unchangedInputs(snapshot, preparedRevision);
      const canonicalOutput = await realpath(output);
      for (const key of ['path', 'data', 'session', 'captureManifest']) {
        if (typeof result[key] !== 'string' || !result[key].startsWith(canonicalOutput + '/'))
          throw new Error(
            'The pinned review CLI did not return a complete report. Migrate the project before reviewing it.',
          );
        await access(result[key]);
      }
      const files = ['path', 'image', 'framesImage', 'photometryImage']
        .map((key) => result[key])
        .filter((path) => typeof path === 'string' && path.startsWith(canonicalOutput + '/'));
      return { ...result, sourceRevision: source.revision, files };
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
  },
};
