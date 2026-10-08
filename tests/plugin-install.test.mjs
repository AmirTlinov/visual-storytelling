import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  rm,
  readdir,
  chmod,
  realpath,
  symlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { installRelease, releaseDigest } from '../plugin/install.mjs';
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'story-install-'));
  const source = join(root, 'download'),
    directory = join(root, 'installation'),
    data = join(root, 'projects');
  t.after(async () => {
    async function unlock(path) {
      for (const item of await readdir(path, { withFileTypes: true }))
        if (item.isDirectory()) await unlock(join(path, item.name));
      await chmod(path, 0o700);
    }
    await unlock(root);
    await rm(root, { recursive: true, force: true });
  });
  for (const path of ['runtime', 'plugin/dist', 'dist', 'skills/setup'])
    await mkdir(join(source, path), { recursive: true });
  await mkdir(data);
  await writeFile(join(data, 'author.txt'), 'User project survives installation.');
  for (const [name, content] of Object.entries({
    'plugin.json': JSON.stringify({ name: 'visual-storytelling', version: '1.0.0' }),
    'release.json': JSON.stringify({
      plugin: '1.0.0',
      platform: process.platform,
      arch: process.arch,
    }),
    'runtime/node': `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`,
    'plugin/dist/server.mjs': `console.log(JSON.stringify({entry:process.argv[1],cwd:process.cwd(),root:process.env.PLUGIN_ROOT}));process.stdin.on('data',async()=>{console.log(JSON.stringify((await import('./value.mjs')).value));process.exit()});`,
    'plugin/dist/value.mjs': `export const value='first';`,
    'plugin/dist/kernel.mjs': '// kernel',
    'plugin/dist/app.html': '<main>Example</main>',
    'dist/build-info.json': '{}',
    LICENSE: '0BSD',
    'skills/setup/SKILL.md': '---\nname: setup\ndescription: Start\n---\nStart',
  }))
    await writeFile(join(source, name), content);
  await chmod(join(source, 'runtime/node'), 0o755);
  await cp(new URL('../mcp.json', import.meta.url), join(source, 'mcp.json'));
  return { root, source, directory, data };
}
function start(
  directory,
  transport = { command: 'sh', args: ['-c', 'exec "$VISUAL_STORY_INSTALL_DIR/launch"'] },
) {
  const child = spawn(transport.command, transport.args, {
    cwd: '/',
    env: { ...process.env, VISUAL_STORY_INSTALL_DIR: directory },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    child,
    next: async () => JSON.parse((await lines.next()).value),
    end: () => child.stdin.end('finish\n'),
  };
}

test('stable launcher survives source removal; upgrades preserve late imports in an active process', async (t) => {
  const f = await fixture(t),
    first = await installRelease(f.source, { directory: f.directory, register: false });
  assert.equal((await stat(first.release)).mode & 0o222, 0, 'release directories are immutable');
  assert.equal((await stat(join(first.release, 'plugin/dist/server.mjs'))).mode & 0o222, 0);
  const same = await installRelease(f.source, { directory: f.directory, register: false });
  assert.equal(same.release, first.release, 'same bytes reuse the release');
  const old = start(f.directory);
  t.after(() => old.child.kill());
  const started = await old.next();
  assert.equal(started.entry, join(first.release, 'plugin/dist/server.mjs'));
  assert.equal(started.cwd, first.release);
  assert.equal(started.root, first.release);
  await writeFile(join(f.source, 'plugin/dist/value.mjs'), `export const value='second';`);
  const next = await installRelease(f.source, { directory: f.directory, register: false });
  assert.notEqual(
    next.release,
    first.release,
    'same version with changed bytes has another physical path',
  );
  await rm(f.source, { recursive: true, force: true });
  old.end();
  assert.equal(
    await old.next(),
    'first',
    'an active process retains late imports from its release',
  );
  const current = start(f.directory);
  t.after(() => current.child.kill());
  assert.equal((await current.next()).entry, join(next.release, 'plugin/dist/server.mjs'));
  current.end();
  assert.equal(await current.next(), 'second');
  assert.equal(
    await readFile(join(f.data, 'author.txt'), 'utf8'),
    'User project survives installation.',
  );
});

test('invalid or unregistered updates preserve the selected runtime and marketplace', async (t) => {
  const f = await fixture(t),
    first = await installRelease(f.source, { directory: f.directory, register: false });
  const manifest = join(f.directory, '.agents/plugins/marketplace.json'),
    before = await readFile(manifest, 'utf8');
  await writeFile(join(f.source, 'plugin/dist/value.mjs'), `export const value='changed';`);
  await assert.rejects(
    installRelease(f.source, { directory: f.directory, codex: '/usr/bin/false' }),
    /previous runtime selection is preserved/,
  );
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
  assert.equal(await readFile(manifest, 'utf8'), before);
  await symlink('/etc/passwd', join(f.source, 'outside'));
  await assert.rejects(
    installRelease(f.source, { directory: f.directory, register: false }),
    /escapes/,
  );
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
});

test('concurrent installations publish complete immutable releases without a split launcher', async (t) => {
  const f = await fixture(t),
    second = join(f.root, 'second');
  await cp(f.source, second, { recursive: true });
  await writeFile(join(second, 'plugin/dist/value.mjs'), `export const value='second';`);
  const releases = await Promise.all(
    [f.source, second].map((source) =>
      installRelease(source, { directory: f.directory, register: false }),
    ),
  );
  const selected = await realpath(join(f.directory, 'current'));
  assert.ok(releases.some((release) => release.release === selected));
  for (const release of releases)
    assert.equal(await releaseDigest(release.release), release.digest);
  const { mcpServers } = JSON.parse(
    await readFile(new URL('../mcp.json', import.meta.url), 'utf8'),
  );
  const server = mcpServers['visual-storytelling'];
  assert.equal(server.cwd, '${PLUGIN_DATA}');
  assert.equal(server.command, 'sh', 'portable plugins require a bare executable name');
  const cold = start(f.directory, server);
  t.after(() => cold.child.kill());
  assert.equal((await cold.next()).entry, join(selected, 'plugin/dist/server.mjs'));
  cold.end();
  assert.ok(['first', 'second'].includes(await cold.next()));
});

test('moving an existing Codex marketplace restores registration when MCP loading fails', async (t) => {
  const f = await fixture(t),
    first = await installRelease(f.source, { directory: f.directory, register: false }),
    prior = join(f.root, 'previous-marketplace'),
    state = join(f.root, 'codex-state.json'),
    codex = join(f.root, 'codex');
  await mkdir(prior);
  await writeFile(
    state,
    JSON.stringify({ root: await realpath(prior), rejectMcp: true, removed: 0 }),
  );
  await writeFile(
    codex,
    `#!${process.execPath}
import {readFileSync,writeFileSync} from 'node:fs';
const path=${JSON.stringify(state)},state=JSON.parse(readFileSync(path)),args=process.argv.slice(2);
const save=()=>writeFileSync(path,JSON.stringify(state));
if(args[0]==='mcp') {
  if(state.rejectMcp) {state.rejectMcp=false;save();process.exit(2)}
  const spec=JSON.parse(readFileSync(${JSON.stringify(join(f.source, 'mcp.json'))})).mcpServers['visual-storytelling'];
  console.log(JSON.stringify({enabled:true,transport:{...spec,cwd:'/stable-data',env:{PLUGIN_DATA:'/stable-data'}}}));
} else if(args[1]==='marketplace') {
  if(args[2]==='list') console.log(JSON.stringify({marketplaces:state.root?[{name:'visual-storytelling-local',root:state.root,marketplaceSource:{sourceType:'local',source:state.root}}]:[]}));
  else {if(args[2]==='remove'){state.root=null;state.removed++}else state.root=args[3];save();console.log('{}')}
} else {state.cachedFrom=state.root;save();console.log('{}')}
`,
  );
  await chmod(codex, 0o755);
  await writeFile(join(f.source, 'plugin/dist/value.mjs'), `export const value='update';`);
  await assert.rejects(
    installRelease(f.source, { directory: f.directory, codex }),
    /registration failed/,
  );
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
  const restored = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(restored.root, await realpath(prior));
  assert.equal(
    restored.cachedFrom,
    restored.root,
    'the previous plugin is installed again after restoring its source',
  );
  const installed = await installRelease(f.source, { directory: f.directory, codex });
  assert.equal(installed.registered, true);
  const accepted = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(accepted.root, await realpath(f.directory));
  await installRelease(f.source, { directory: f.directory, codex });
  assert.equal(
    JSON.parse(await readFile(state, 'utf8')).removed,
    accepted.removed,
    'subsequent updates retain the stable marketplace',
  );
});
