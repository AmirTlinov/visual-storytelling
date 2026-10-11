import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
// The official multi-architecture Node image fixes both the build OS and bundled runtime.
const image =
  'node:24.8.0-bookworm@sha256:82a1d74c5988b72e839ac01c5bf0f7879a8ffd14ae40d7008016bca6ae12852b';
const inputs = [
  'src',
  'tools',
  'plugin',
  'skills',
  'docs',
  'examples',
  'tests',
  'package.json',
  'package-lock.json',
  'plugin.json',
  'mcp.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'README.md',
  'PHILOSOPHY.md',
  'AGENTS.md',
  'LICENSE',
  'THIRD_PARTY.md',
  '.agents/plugins/marketplace.json',
];
const build = `
mkdir /work
tar -xzf /input/source.tar.gz -C /work
cd /work
npm ci --ignore-scripts --no-audit --no-fund
npm run plugin:release
npm run check
cp artifacts/plugin/*.tar.gz artifacts/plugin/*.sha256 /output/
if [ "$VERIFY" = 1 ]; then
  node node_modules/playwright/cli.js install-deps chromium > /output/linux-$TARGET_ARCH-system-deps.log 2>&1
  node --test --test-concurrency=1 tests/platform-storage.test.mjs tests/environment-profiles.test.mjs tests/linux-voice.test.mjs tests/plugin-install.test.mjs tests/plugin-install-runtime.test.mjs tests/plugin-generators.test.mjs
  node tests/plugin/linux-release.mjs .plugin-release /output/linux-$TARGET_ARCH-acceptance.json
fi
`;

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal ?? code}`)),
    );
  });
}

const { values } = parseArgs({
  options: {
    arch: { type: 'string', multiple: true },
    context: { type: 'string' },
    'skip-verification': { type: 'boolean' },
    output: { type: 'string' },
  },
});
const architectures = values.arch ?? ['x64', 'arm64'];
if (!architectures.length || architectures.some((arch) => !['x64', 'arm64'].includes(arch)))
  throw new Error('Use --arch x64 and/or --arch arm64.');
const output = resolve(values.output ?? join(root, 'artifacts/plugin'));
await mkdir(output, { recursive: true });
const input = await mkdtemp(join(output, '.linux-build-'));
let complete = false;
try {
  await run(
    'tar',
    [
      '--no-xattrs',
      '-czf',
      join(input, 'source.tar.gz'),
      '--exclude=node_modules',
      '--exclude=dist',
      '--exclude=site',
      '--exclude=artifacts',
      '--exclude=__pycache__',
      '--exclude=.venv',
      '-C',
      root,
      ...inputs,
    ],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  for (const arch of [...new Set(architectures)]) {
    console.log(`Building and verifying Linux ${arch} from the source snapshot.`);
    const name = `visual-story-build-${arch}-${input.split('-').at(-1).toLowerCase()}`;
    const docker = [...(values.context ? ['--context', values.context] : [])];
    await run('docker', [
      ...docker,
      'run',
      '--init',
      '--name',
      name,
      '--platform',
      `linux/${arch === 'x64' ? 'amd64' : 'arm64'}`,
      '--shm-size=1g',
      '--mount',
      `type=bind,source=${input},target=/input,readonly`,
      '--mount',
      `type=bind,source=${output},target=/output`,
      '--env',
      `TARGET_ARCH=${arch}`,
      '--env',
      `VERIFY=${values['skip-verification'] ? '0' : '1'}`,
      '--env',
      'npm_config_maxsockets=3',
      '--env',
      'npm_config_prefer_offline=true',
      '--env',
      'VISUAL_STORY_TEST_NPM_CACHE=/root/.npm',
      image,
      'sh',
      '-eu',
      '-c',
      build,
    ]).catch((error) => {
      console.error(`Build container retained for diagnosis: ${name}`);
      throw error;
    });
    await run('docker', [...docker, 'rm', name]);
  }
  console.log(`Linux archives and checksums: ${output}`);
  complete = true;
} finally {
  if (complete) await rm(input, { recursive: true, force: true });
  else console.error(`Source snapshot retained for diagnosis: ${input}`);
}
