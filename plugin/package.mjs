import { readFile, writeFile, mkdir, cp, rm, chmod } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { buildAPI } from '../tools/api.mjs';
import { sourceDigest, writeBuildInfo } from '../tools/build-info.mjs';
const execute = promisify(execFile);
export const shippedExamples = [
  'explorer-svg',
  'explorer-3d',
  'product-walkthrough',
  'ink-story',
  'morph-story',
  'connected-diagram',
];

/** A distributable local beta: runtime, authoring tools, docs and licensed assets travel together. */
export async function packagePlugin(root) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This release profile targets macOS Apple Silicon.');
  const release = join(root, '.plugin-release');
  await rm(release, { recursive: true, force: true });
  await mkdir(release, { recursive: true });
  for (const name of [
    'plugin.json',
    'mcp.json',
    'LICENSE',
    'THIRD_PARTY.md',
    'PHILOSOPHY.md',
    'README.md',
    'AGENTS.md',
    'dist',
    'tools',
    'docs',
    'skills',
    'plugin',
  ]) {
    await cp(join(root, name), join(release, name), {
      recursive: true,
      filter: (path) =>
        !path.includes('/plugin/dist/scene') &&
        !path.includes('/tools/audio') &&
        !path.endsWith('/tools/sketch-audio') &&
        !path.includes('/dist/characters') &&
        !path.includes('/dist/assets/characters') &&
        !path.includes('/dist/assets/audio') &&
        !path.includes('/dist/book'),
    });
  }
  const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
  await mkdir(join(release, 'examples'));
  for (const id of shippedExamples)
    await cp(join(root, 'examples', id), join(release, 'examples', id), {
      recursive: true,
      filter: (path) =>
        !basename(path).startsWith('.') &&
        !/\.(wav|mp3|m4a|mp4)$/.test(path) &&
        !['dist', 'node_modules', 'artifacts', 'review'].includes(basename(path)),
    });
  await writeFile(
    join(release, 'examples/catalog.json'),
    JSON.stringify(Object.fromEntries(shippedExamples.map((id) => [id, catalog[id]])), null, 2),
  );
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  delete pkg.dependencies['@esotericsoftware/spine-webgl'];
  delete pkg.exports['./characters'];
  delete pkg.exports['./book'];
  delete pkg.bin['sketch-audio'];
  pkg.scripts = { build: 'visual-story build .', dev: 'visual-story dev .' };
  await writeFile(join(release, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await buildAPI(release, join(release, 'dist'));
  await execute('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: release,
    maxBuffer: 2_000_000,
  });
  await writeBuildInfo(release, join(release, 'dist'), await sourceDigest(release));
  // The user's project owns its runtime archive, while the app starts without a system Node install.
  const runtime = join(release, 'runtime');
  await mkdir(runtime);
  await cp(process.execPath, join(runtime, 'node'));
  await chmod(join(runtime, 'node'), 0o755);
  const installation = dirname(dirname(process.execPath));
  await cp(join(installation, 'LICENSE'), join(runtime, 'NODE-LICENSE'));
  await cp(join(installation, 'lib/node_modules/npm'), join(runtime, 'npm'), { recursive: true });
  // Tools invoking npm inherit the plugin's private, versioned runtime bin directory.
  await mkdir(join(runtime, 'bin'));
  await writeFile(
    join(runtime, 'bin/npm'),
    '#!/bin/sh\nexec "$(dirname "$0")/../node" "$(dirname "$0")/../npm/bin/npm-cli.js" "$@"\n',
    { mode: 0o755 },
  );
  await writeFile(join(runtime, 'bin/node'), '#!/bin/sh\nexec "$(dirname "$0")/../node" "$@"\n', {
    mode: 0o755,
  });
  await writeFile(
    join(release, 'release.json'),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        plugin: JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')).version,
        examples: shippedExamples,
        omitted: ['Spine/Chibi characters', 'Higgs provider', 'voice models'],
      },
      null,
      2,
    ) + '\n',
  );
  const version = JSON.parse(await readFile(join(release, 'plugin.json'), 'utf8')).version;
  const archive = join(
    root,
    'artifacts/plugin',
    `visual-storytelling-${version}-darwin-arm64.tar.gz`,
  );
  await mkdir(dirname(archive), { recursive: true });
  await execute('/usr/bin/tar', [
    '-czf',
    archive,
    '-C',
    root,
    '.agents/plugins/marketplace.json',
    '.plugin-release',
    '-C',
    join(root, 'plugin'),
    'INSTALL.md',
  ]);
  await writeFile(
    archive + '.sha256',
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') +
      '  ' +
      basename(archive) +
      '\n',
  );
  console.log(`Installable archive: ${archive}`);
  return release;
}
