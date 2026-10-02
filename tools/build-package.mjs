import { rm, mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
export async function buildPackage() {
  await rm('dist', { recursive: true, force: true });
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    stdio: 'inherit',
  });
  await mkdir('dist/assets', { recursive: true });
  await cp('src/assets', 'dist/assets', { recursive: true });
  await cp('src/styles', 'dist/styles', { recursive: true });
  await cp('src/style.css', 'dist/style.css');
}
