import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePackage } from './build-info.mjs';

/** One declaration drives preparation and execution. Node generators declare Python use. */
export async function sceneGenerator(source) {
  let config;
  try {
    config = JSON.parse(await readFile(join(source, 'scene.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const { generator } = config;
  if (!generator) return;
  if (
    !['node', 'python3', 'uv'].includes(generator.runner) ||
    typeof generator.file !== 'string' ||
    (generator.python !== undefined && typeof generator.python !== 'boolean')
  )
    throw new Error('scene.json needs a local generator and runner node, python3 or uv');
  const file = resolve(source, generator.file);
  if (!file.startsWith(resolve(source) + '/'))
    throw new Error('scene.json needs a local generator and runner node, python3 or uv');
  return {
    file,
    runner: generator.runner,
    python: generator.runner !== 'node' || !!generator.python,
  };
}

/** A scene owns its generator; the builder owns its output and runtime dependencies. */
export async function generateScene(source, output, { signal, sourceRoot = source } = {}) {
  const generator = await sceneGenerator(source);
  if (!generator) return;
  const { file } = generator;
  const runners = {
    node: process.execPath,
    python3: process.env.VISUAL_STORY_PYTHON ?? 'python3',
    uv: process.env.VISUAL_STORY_UV ?? 'uv',
  };
  const runtime = await resolvePackage('@visual-storytelling/core', source);
  await mkdir(output, { recursive: true });
  await promisify(execFile)(
    runners[generator.runner],
    generator.runner === 'uv'
      ? ['run', '--no-project', '--python', process.env.VISUAL_STORY_PYTHON ?? '3.12', file]
      : [file],
    {
      cwd: source,
      env: {
        ...process.env,
        VISUAL_STORY_TOOLS: runtime
          ? join(runtime, 'tools')
          : fileURLToPath(new URL('.', import.meta.url)),
        VISUAL_STORY_OUTPUT: resolve(output),
        VISUAL_STORY_SOURCE: resolve(sourceRoot),
      },
      signal,
      maxBuffer: 4_000_000,
    },
  );
}
