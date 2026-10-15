import { readFile, mkdir, access, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deliver } from '../tools/deliver.mjs';
import { snapshotProject, projectFiles, projectFile, digest } from '../tools/project-files.mjs';
import { writeJSON, readJSON } from '../tools/storage.mjs';
import { prepareEnvironment } from '../tools/environment.mjs';
import { updateSceneRuntime, preparedRuntimeFile } from '../tools/runtime-package.mjs';
import { migrateStoryDocument } from '../tools/migrate-story-document.mjs';
import { migrateAcceptedSpeech, acceptedAdapterForMigration } from '../tools/migrate-speech.mjs';
import { prepareProjectChanges, writeProjectChange } from './project-changes.mjs';
import { videoDimensions } from '../tools/video-dimensions.mjs';
import { creationCandidate } from './authored-candidate.mjs';
import { prepareBuild, buildPreparedSnapshot, unchangedInputs } from './build-preparation.mjs';
import { preparedBuildHTML } from './build-payload.mjs';
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

export const workflows = {
  async migrate(input, task) {
    const snapshot = join(input.data, 'snapshots', task.jobId);
    const changes = input.changes ?? [];
    const metadata = ['package.json', 'package-lock.json'];
    if (await readJSON(join(input.projectPath, preparedRuntimeFile)))
      metadata.push(preparedRuntimeFile);
    if (new Set([...metadata, ...changes.map((change) => change.path)]).size > 64)
      throw new Error(
        `Runtime migration supports ${64 - metadata.length} source files plus its runtime metadata.`,
      );
    // Validate against working paths first: snapshots deliberately flatten internal links.
    const edits = changes.length ? await prepareProjectChanges(input.projectPath, changes) : [];
    await snapshotProject(input.projectPath, snapshot, input.sourceRevision);
    const previousAdapter = await acceptedAdapterForMigration(snapshot);
    if (edits.length) {
      task.progress('Применяю исходники к новой библиотеке…');
      for (const edit of edits) {
        task.signal.throwIfAborted();
        await writeProjectChange(snapshot, edit);
      }
    }
    const documentChanges = await migrateStoryDocument(snapshot, { root, changes });
    if (
      new Set([
        ...metadata,
        ...changes.map((change) => change.path),
        ...documentChanges.map((change) => change.path),
      ]).size > 64
    )
      throw new Error('Runtime and document migration exceed the 64-file transaction limit.');
    task.progress('Подготавливаю новую библиотеку…');
    // ProjectStore history still references the previous pin. Keep its immutable archive
    // in both candidate and working sources so publication and a later undo agree.
    const updated = await updateSceneRuntime(snapshot, {
      root,
      build: false,
      signal: task.signal,
      retainPreviousArchive: true,
    });
    documentChanges.push(
      ...(await migrateAcceptedSpeech(snapshot, {
        ...task,
        previousAdapter,
        cache: join(input.data, 'speech'),
      })),
    );
    if (
      new Set([
        ...metadata,
        ...changes.map((change) => change.path),
        ...documentChanges.map((change) => change.path),
      ]).size > 64
    )
      throw new Error('Runtime and document migration exceed the 64-file transaction limit.');
    if (!updated.changed && !changes.length && !documentChanges.length) return { upToDate: true };
    const source = await projectFiles(snapshot);
    const voice = await readJSON(join(snapshot, 'voice.json'));
    const silent = voice?.enabled === false;
    const { prepared } = await buildPreparedSnapshot(input, task, {
      snapshot,
      source,
      preparedRevision: source.revision,
      preparation: { silent },
      silent,
    });
    task.signal.throwIfAborted();
    const path = updated.prepared ? undefined : updated.dependency.replace(/^file:(?:\.\/)?/, '');
    const bytes = path ? await readFile(join(snapshot, path)) : undefined;
    return {
      buildRevision: prepared.revision,
      sourceRevision: source.revision,
      snapshot,
      migration: {
        changes: [
          ...new Map(
            [
              ...changes,
              ...documentChanges,
              ...(await Promise.all(
                metadata.map(async (name) => ({
                  path: name,
                  content: await readFile(join(snapshot, name), 'utf8').catch((error) => {
                    if (error.code !== 'ENOENT') throw error;
                    return null;
                  }),
                })),
              )),
            ].map((change) => [change.path, change]),
          ).values(),
        ],
        assets: path ? [{ path, source: join(snapshot, path), hash: digest(bytes) }] : [],
      },
    };
  },
  async create(input, task) {
    task.progress('Создаю кандидата проекта…');
    const candidate = await creationCandidate(input.data, input.baseProject, {
      root,
      example: input.example,
      title: input.title,
      deferAudio: true,
      signal: task.signal,
    });
    const built = await workflows.build(
      {
        ...input,
        sourceRevision: candidate.sourceRevision,
        inputSnapshot: candidate.inputSnapshot,
        resumeFrom: undefined,
      },
      task,
    );
    return {
      ...built,
      creation: { changes: candidate.changes, assets: candidate.assets },
      runtime: candidate.created.runtime,
      entry: candidate.created.entry,
    };
  },
  async build(input, task) {
    const { snapshot, source, prepared } = await prepareBuild(input, task);
    return { buildRevision: prepared.revision, sourceRevision: source.revision, snapshot };
  },
  async produce(input, task) {
    const formats = input.options?.formats ?? ['html'];
    if (formats.includes('mp4')) videoDimensions(input.options);
    const { snapshot, source, silent, prepared } = await prepareBuild(input, task);
    await prepareEnvironment(input.data, {
      ...task,
      browser: formats.some((format) => ['png', 'svg', 'mp4', 'srt', 'vtt'].includes(format)),
      encoder: formats.includes('mp4'),
    });
    task.progress('Готовлю выпуск…');
    const output = join(input.projectPath, 'artifacts', task.jobId);
    const result = await deliver(snapshot, {
      ...input.options,
      silent: input.options?.silent ?? silent,
      out: output,
      prepareAudio: false,
      prepared: {
        ...prepared,
        ...(formats.includes('html') && { html: await preparedBuildHTML(input.data, prepared) }),
        directory: join(snapshot, 'dist'),
      },
      checkpoint: input.checkpoint,
      signal: task.signal,
      onProgress: (done, total) => task.progress('Собираю видео…', { done, total }),
    });
    return {
      ...result,
      sourceRevision: source.revision,
      buildRevision: prepared.revision,
      target: input.target,
      files: result.files.map((file) => join(output, file)),
    };
  },
  async review(input, task) {
    const { snapshot, source, preparedRevision, prepared } = await prepareBuild(input, task);
    const cli = join(snapshot, 'node_modules/@visual-storytelling/core/tools/scene.mjs');
    await access(cli).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(
        'The pinned project runtime has no review CLI. Migrate this project before reviewing it.',
      );
    });
    await unchangedInputs(snapshot, preparedRevision);
    await prepareEnvironment(input.data, { ...task, browser: true });
    const options = input.options ?? {};
    const args = [cli, 'review', join(snapshot, 'dist')];
    for (const key of [
      'cue',
      'from',
      'at',
      'radius',
      'seconds',
      'frames',
      'width',
      'height',
      'theme',
      'object',
    ])
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
      const files = [
        'path',
        'image',
        'timelineImage',
        'onionImage',
        'framesImage',
        'photometryImage',
      ]
        .map((key) => result[key])
        .filter((path) => typeof path === 'string' && path.startsWith(canonicalOutput + '/'));
      return {
        ...result,
        sourceRevision: source.revision,
        buildRevision: prepared.revision,
        target: { kind: 'build', projectId: input.projectId, buildRevision: prepared.revision },
        files,
      };
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
  },
};
