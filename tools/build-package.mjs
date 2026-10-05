import { mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { buildAPI } from './api.mjs';
import { buildOutput } from './build-output.mjs';
import { sourceDigest, writeBuildInfo } from './build-info.mjs';
import { embedRuntimeAssets } from './asset-urls.mjs';
import { buildBuiltinCharacters } from './characters/build-builtin.mjs';
import { buildSystemVoice } from './voice/build.mjs';
export async function buildPackage() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = join(root, 'dist');
  await buildBuiltinCharacters();
  let receipt;
  await buildOutput(root, output, async (staging) => {
    const source = await sourceDigest(root);
    execFileSync(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', staging],
      { stdio: 'inherit', cwd: root },
    );
    await mkdir(join(staging, 'assets'), { recursive: true });
    await cp(join(root, 'src/assets'), join(staging, 'assets'), { recursive: true });
    await cp(join(root, 'src/styles'), join(staging, 'styles'), { recursive: true });
    await cp(join(root, 'src/style.css'), join(staging, 'style.css'));
    await embedRuntimeAssets(staging);
    await buildAPI(root, staging);
    await buildSystemVoice(staging);
    if ((await sourceDigest(root)) !== source)
      throw new Error(
        'Library sources changed during the build. Run the build again; the previous package is preserved.',
      );
    receipt = await writeBuildInfo(root, staging, source);
  });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPackage();
