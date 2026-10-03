import { mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { buildAPI } from './api.mjs';
import { buildOutput } from './build-output.mjs';
export async function buildPackage() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = join(root, 'dist');
  await buildOutput(root, output, async (staging) => {
    execFileSync(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', staging],
      { stdio: 'inherit', cwd: root },
    );
    await mkdir(join(staging, 'assets'), { recursive: true });
    await cp(join(root, 'src/assets'), join(staging, 'assets'), { recursive: true });
    await cp(join(root, 'src/styles'), join(staging, 'styles'), { recursive: true });
    await cp(join(root, 'src/style.css'), join(staging, 'style.css'));
    await buildAPI(root, staging);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPackage();
