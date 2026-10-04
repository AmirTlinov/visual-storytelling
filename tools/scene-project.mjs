import { access, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const execute = promisify(execFile);

/** New scenes and editable deliveries use the same immutable runtime dependency. */
export async function pinSceneProject(destination, { signal } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  signal?.throwIfAborted();
  if (
    await access(join(root, 'src/index.ts')).then(
      () => true,
      () => false,
    )
  ) {
    const { buildPackage } = await import('./build-package.mjs');
    await buildPackage();
  }
  signal?.throwIfAborted();
  const { stdout } = await execute(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', destination, '--json'],
    { cwd: root, signal },
  );
  const receipt = JSON.parse(stdout)[0];
  await writeFile(
    join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'visual-story-scene',
        private: true,
        type: 'module',
        scripts: {
          build: 'visual-story build .',
          dev: 'visual-story dev .',
          preview: 'visual-story preview dist',
          pack: 'visual-story pack dist --out artifacts/story.html',
          audio: 'visual-story audio .',
          export: 'visual-story export --directory dist',
          deliver: 'visual-story deliver .',
          review: 'visual-story review dist --out artifacts/review',
        },
        dependencies: { '@visual-storytelling/core': `file:./${receipt.filename}` },
      },
      null,
      2,
    ) + '\n',
  );
  return receipt;
}
