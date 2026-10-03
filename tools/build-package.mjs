import { rm, mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { buildAPI } from './api.mjs';
export async function buildPackage() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    stdio: 'inherit',
    cwd: root,
  });
  await mkdir(join(output, 'assets'), { recursive: true });
  await cp(join(root, 'src/assets'), join(output, 'assets'), { recursive: true });
  await cp(join(root, 'src/styles'), join(output, 'styles'), { recursive: true });
  await cp(join(root, 'src/style.css'), join(output, 'style.css'));
  await buildAPI(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPackage();
