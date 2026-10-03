import { buildPackage } from './build-package.mjs';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await buildPackage();
const catalog = JSON.parse(
  await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8'),
);
for (const [name, { generator }] of Object.entries(catalog))
  if (generator)
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./scene.mjs', import.meta.url)),
        'generate',
        fileURLToPath(new URL(`../examples/${name}`, import.meta.url)),
        '--example',
        name,
      ],
      { stdio: 'inherit' },
    );
