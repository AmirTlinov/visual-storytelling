import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePackage } from './build-info.mjs';

/** A scene owns its generator; the builder owns its output and runtime dependencies. */
export async function generateScene(source, output, { signal, sourceRoot = source } = {}) {
  let config;
  try {
    config = JSON.parse(await readFile(join(source, 'scene.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const { generator } = config;
  if (!generator) return;
  const runners = { node: process.execPath, python3: 'python3', uv: 'uv' };
  const runner = runners[generator.runner];
  const file = resolve(source, generator.file);
  if (!runner || !file.startsWith(resolve(source) + '/'))
    throw new Error('scene.json needs a local generator and runner node, python3 or uv');
  const runtime = await resolvePackage('@visual-storytelling/core', source);
  await mkdir(output, { recursive: true });
  await promisify(execFile)(
    runner,
    generator.runner === 'uv' ? ['run', '--python', '3.12', file] : [file],
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
