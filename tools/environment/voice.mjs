import { withPreparationLock } from './lock.mjs';
import { readFile, mkdir, cp, access, statfs, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readJSON, writeJSON } from '../storage.mjs';
import { pythonEnvironment, pythonVersion, managedPython } from './python.mjs';

const tools = fileURLToPath(new URL('../../tools/', import.meta.url));
export const voiceRequirements = {
  platform: 'macOS Apple Silicon',
  python: pythonVersion,
  downloadBytes: 12_000_000_000,
  requiredDiskBytes: 18_000_000_000,
  recommendedMemoryBytes: 32_000_000_000,
};
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
async function paths(data) {
  const lock = createHash('sha256')
    .update(await readFile(join(tools, 'uv.lock')))
    .digest('hex');
  const directory = join(data, 'environment', `higgs-${lock.slice(0, 16)}`);
  return {
    lock,
    directory,
    python: join(directory, 'venv/bin/python'),
    // The model cache is shared with the authoring CLI and survives runtime upgrades.
    cache:
      process.env.SKETCH_AUDIO_CACHE ??
      join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'sketch-visualization'),
  };
}

/** Bind the installed runtime and each worker to the same prepared environment. No preparation. */
export async function configureVoiceEnvironment(data) {
  const selected = await paths(data);
  process.env.SKETCH_AUDIO_PYTHON = selected.python;
  process.env.SKETCH_AUDIO_CACHE = selected.cache;
  return selected;
}

export async function voiceEnvironmentStatus(data) {
  const selected = await paths(data);
  const receipt = await readJSON(join(selected.directory, 'receipt.json'));
  const resources = await readJSON(join(selected.cache, 'resources.json'));
  const models = resources?.verified
    ? JSON.parse(await readFile(join(tools, 'audio/models.json'), 'utf8'))
    : {};
  const modelsReady = (
    await Promise.all(
      Object.entries(models).map(async ([key, model]) => {
        const prepared = resources?.models?.[key];
        return (
          prepared?.repository === model.repository &&
          prepared?.revision === model.revision &&
          (
            await Promise.all(
              model.required.map((name) =>
                exists(join(selected.cache, 'models', model.directory, name)),
              ),
            )
          ).every(Boolean)
        );
      }),
    )
  ).every(Boolean);
  return {
    ready: Boolean(
      receipt?.lock === selected.lock &&
        receipt.managedPython &&
        resources?.verified &&
        modelsReady &&
        (await exists(selected.python)),
    ),
    requirements: voiceRequirements,
    stage: receipt?.lock === selected.lock ? 'models' : 'python',
  };
}

/** The worker owns the process group; cooperative cancellation stops this direct child. */
async function command(binary, args, { signal, progress, env, stage }) {
  signal.throwIfAborted();
  progress(stage);
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '',
      buffer = '',
      killTimer,
      last = 0;
    const cancel = () => {
      try {
        child.kill('SIGTERM');
      } catch {}
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 1500);
      killTimer.unref();
    };
    const report = (line) => {
      if (!line.trim()) return;
      tail = (tail + '\n' + line).slice(-3000);
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          if (event.done === event.total || Date.now() - last > 300) {
            progress(
              event.stage,
              event.total ? { done: event.done, total: event.total } : undefined,
            );
            last = Date.now();
          }
        }
      } catch {
        if (Date.now() - last > 500) {
          progress(`${stage} · ${line.replace(/\x1b\[[0-9;]*m/g, '').slice(-180)}`);
          last = Date.now();
        }
      }
    };
    child.stdout.on('data', (bytes) => {
      buffer += bytes.toString();
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop();
      lines.forEach(report);
    });
    child.stderr.on('data', (bytes) =>
      bytes
        .toString()
        .split(/[\r\n]+/)
        .forEach(report),
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const finish = (error) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve();
    };
    child.once('error', finish);
    child.once('close', (code) =>
      finish(code === 0 ? null : new Error(`${stage}: ${tail.trim() || `exit ${code}`}`)),
    );
  });
}

export async function prepareVoiceEnvironment(data, uv, task) {
  const selected = await configureVoiceEnvironment(data);
  return withPreparationLock(selected.directory + '.lock', task, async () => {
    await mkdir(selected.directory, { recursive: true });
    await mkdir(selected.cache, { recursive: true });
    const receipt = await readJSON(join(selected.directory, 'receipt.json'));
    const env = {
      ...process.env,
      ...pythonEnvironment(data),
      UV_PROJECT_ENVIRONMENT: join(selected.directory, 'venv'),
      TOKENIZERS_PARALLELISM: 'false',
    };
    if (
      receipt?.lock !== selected.lock ||
      !receipt.managedPython ||
      !(await exists(selected.python))
    ) {
      const disk = await statfs(selected.directory);
      // Existing models need no second copy. Fresh setup reports its complete footprint before download.
      const models = await exists(
        join(selected.cache, 'models/higgs-tts-3-bf16/model.safetensors'),
      );
      const needed = models ? 4_000_000_000 : voiceRequirements.requiredDiskBytes;
      if (Number(disk.bavail) * Number(disk.bsize) < needed)
        throw new Error(
          `Для подготовки голоса нужно ${Math.ceil(needed / 1e9)} ГБ свободного места.`,
        );
      if (!receipt?.managedPython)
        await rm(join(selected.directory, 'venv'), { recursive: true, force: true });
      await cp(join(tools, 'pyproject.toml'), join(selected.directory, 'pyproject.toml'));
      await cp(join(tools, 'uv.lock'), join(selected.directory, 'uv.lock'));
      await command(
        uv,
        [
          'sync',
          '--locked',
          '--no-dev',
          '--managed-python',
          '--python',
          pythonVersion,
          '--project',
          selected.directory,
        ],
        {
          ...task,
          env,
          stage: 'Подготавливаю Python и зависимости голоса',
        },
      );
      await managedPython(data, selected.python);
      await writeJSON(join(selected.directory, 'receipt.json'), {
        lock: selected.lock,
        python: pythonVersion,
        managedPython: true,
      });
    }
    await command(selected.python, [join(tools, 'audio/cli.py'), 'setup', '--progress-json'], {
      ...task,
      env,
      stage: 'Подготавливаю модели речи и разметки',
    });
    return selected;
  });
}
