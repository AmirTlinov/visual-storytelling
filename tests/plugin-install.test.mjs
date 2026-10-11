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
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
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

async function codexFixture(f, initial = {}) {
  const state = join(f.root, 'codex-state.json'),
    codex = join(f.root, 'codex');
  await writeFile(
    state,
    JSON.stringify({
      root: null,
      sourceType: 'local',
      installed: true,
      removed: 0,
      added: 0,
      pluginInstalls: 0,
      calls: [],
      ...initial,
    }),
  );
  await writeFile(
    codex,
    `#!${process.execPath}
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const path=${JSON.stringify(state)},state=JSON.parse(readFileSync(path)),args=process.argv.slice(2);
const save=()=>writeFileSync(path,JSON.stringify(state));
state.calls.push(args);save();
if(args[0]==='mcp') {
  assert.deepEqual(args,['mcp','get','visual-storytelling','--json']);
  if(state.rejectMcp) {state.rejectMcp=false;save();process.exit(2)}
  const spec=JSON.parse(readFileSync(${JSON.stringify(join(f.source, 'mcp.json'))})).mcpServers['visual-storytelling'];
  console.log(JSON.stringify({enabled:true,transport:{...spec,cwd:'/stable-data',env:{PLUGIN_DATA:'/stable-data'}}}));
} else if(args[1]==='list') {
  assert.deepEqual(args,['plugin','list','--marketplace','visual-storytelling-local','--available','--json']);
  const entries=state.root?[{pluginId:'visual-storytelling@visual-storytelling-local',marketplaceName:'visual-storytelling-local',name:'visual-storytelling',marketplaceSource:{sourceType:state.sourceType,source:state.root}}]:[];
  console.log(JSON.stringify({installed:state.installed?entries:[],available:state.installed?[]:entries}));
} else if(args[1]==='marketplace') {
  if(args[2]==='list') throw new Error('An unrelated marketplace has a missing manifest');
  if(args[2]==='remove') {
    assert.equal(args[3],'visual-storytelling-local');state.root=null;state.removed++;
  } else {
    assert.equal(args[2],'add');state.root=args[3];state.sourceType='local';state.added++;
  }
  save();console.log('{}');
} else {
  assert.deepEqual(args,['plugin','add','visual-storytelling@visual-storytelling-local','--json']);
  const marketplace=JSON.parse(readFileSync(join(state.root,'.agents/plugins/marketplace.json')));
  state.cachedFrom=state.root;state.cachedRelease=resolve(state.root,marketplace.plugins[0].source.path);
  state.cachedSkill=readFileSync(join(state.cachedRelease,'skills/setup/SKILL.md'),'utf8');
  state.installed=true;state.pluginInstalls++;save();console.log('{}');
}
`,
  );
  await chmod(codex, 0o755);
  return { codex, state, read: async () => JSON.parse(await readFile(state, 'utf8')) };
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

test('an immutable installed release can be installed elsewhere without changing its source', async (t) => {
  const f = await fixture(t),
    first = await installRelease(f.source, { directory: f.directory, register: false }),
    directory = join(f.root, 'relocated-installation');
  async function modes(root, relative = '') {
    const path = join(root, relative),
      entries = [[relative, (await stat(path)).mode & 0o777]];
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = join(relative, item.name);
      if (item.isDirectory()) entries.push(...(await modes(root, name)));
      else entries.push([name, (await stat(join(root, name))).mode & 0o777]);
    }
    return entries;
  }
  const before = await modes(first.release),
    receipt = await readFile(join(first.release, '.installation.json'), 'utf8');
  assert(
    before.every(([, mode]) => (mode & 0o222) === 0),
    'the source is read-only',
  );
  const copied = await installRelease(first.release, { directory, register: false });
  assert.notEqual(copied.release, first.release);
  assert.equal(copied.digest, first.digest);
  assert.equal(await releaseDigest(copied.release), first.digest);
  assert.equal(await releaseDigest(first.release), first.digest, 'source bytes are unchanged');
  assert.deepEqual(await modes(first.release), before, 'source permissions are unchanged');
  assert.deepEqual(await modes(copied.release), before, 'the new release is immutable too');
  assert.equal(await readFile(join(first.release, '.installation.json'), 'utf8'), receipt);
  assert.equal(await readFile(join(copied.release, '.installation.json'), 'utf8'), receipt);
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
  const current = start(directory);
  t.after(() => current.child.kill());
  assert.equal((await current.next()).entry, join(copied.release, 'plugin/dist/server.mjs'));
  current.end();
  assert.equal(await current.next(), 'first');
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

test('stale installation contenders preserve the new lock owner and publish complete releases', async (t) => {
  const f = await fixture(t),
    second = join(f.root, 'second');
  await cp(f.source, second, { recursive: true });
  await writeFile(join(second, 'plugin/dist/value.mjs'), `export const value='second';`);
  const holder = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {acquireDirectoryLock} from ${JSON.stringify(new URL('../tools/file-lock.mjs', import.meta.url).href)};
    await acquireDirectoryLock(process.argv[1]);
    process.send('ready');setInterval(()=>{},1000);
  `,
      join(f.directory, '.install-lock'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  t.after(() => {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL');
  });
  await once(holder, 'message');
  const stopped = once(holder, 'exit');
  holder.kill('SIGKILL');
  await stopped;
  const releases = await Promise.all(
    [f.source, second].map(async (source) =>
      JSON.parse(
        (
          await promisify(execFile)(process.execPath, [
            '--input-type=module',
            '-e',
            `
        import {installRelease} from ${JSON.stringify(new URL('../plugin/install.mjs', import.meta.url).href)};
        console.log(JSON.stringify(await installRelease(process.argv[1],{directory:process.argv[2],register:false})));
      `,
            source,
            f.directory,
          ])
        ).stdout,
      ),
    ),
  );
  assert.ok(!(await readdir(f.directory)).some((name) => name.startsWith('.install-lock')));
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
    prior = join(f.root, 'previous-marketplace');
  await mkdir(join(prior, '.agents/plugins'), { recursive: true });
  await writeFile(
    join(prior, '.agents/plugins/marketplace.json'),
    JSON.stringify({ plugins: [{ source: { source: 'local', path: first.release } }] }),
  );
  const cli = await codexFixture(f, { root: await realpath(prior), rejectMcp: true }),
    { codex } = cli;
  await writeFile(join(f.source, 'plugin/dist/value.mjs'), `export const value='update';`);
  await assert.rejects(
    installRelease(f.source, { directory: f.directory, codex }),
    /registration failed/,
  );
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
  const restored = await cli.read();
  assert.equal(restored.root, await realpath(prior));
  assert.equal(
    restored.cachedFrom,
    restored.root,
    'the previous plugin is installed again after restoring its source',
  );
  const installed = await installRelease(f.source, { directory: f.directory, codex });
  assert.equal(installed.registered, true);
  const accepted = await cli.read();
  assert.equal(accepted.root, await realpath(f.directory));
  await installRelease(f.source, { directory: f.directory, codex });
  assert.equal(
    (await cli.read()).removed,
    accepted.removed,
    'subsequent updates retain the stable marketplace',
  );
});

test('registration refreshes its own cached skill without scanning unrelated marketplaces', async (t) => {
  const f = await fixture(t),
    cli = await codexFixture(f),
    options = { directory: f.directory, codex: cli.codex };
  const first = await installRelease(f.source, options);
  const initial = await cli.read();
  assert.equal(initial.added, 1, 'first installation registers its marketplace');
  assert.equal(initial.cachedRelease, first.release);
  const skill = '---\nname: setup\ndescription: Updated\n---\nUpdated authoring guidance';
  await writeFile(join(f.source, 'skills/setup/SKILL.md'), skill);
  const updated = await installRelease(f.source, options);
  const registered = await cli.read();
  assert.notEqual(updated.release, first.release);
  assert.equal(registered.cachedRelease, updated.release);
  assert.equal(registered.cachedSkill, skill, 'plugin add refreshes the installed skill');
  assert.equal(registered.added, 1, 'the stable root is reused');
  assert.equal(registered.removed, 0);
  await writeFile(cli.state, JSON.stringify({ ...registered, installed: false }));
  await installRelease(f.source, options);
  const available = await cli.read();
  assert.equal(available.added, 1, 'a configured but uninstalled plugin is found in available');
  assert.equal(available.removed, 0);
  assert.equal(available.installed, true);
});

test('failed stable-root updates restore both the selected release and the cached skill', async (t) => {
  const f = await fixture(t),
    cli = await codexFixture(f),
    options = { directory: f.directory, codex: cli.codex };
  const first = await installRelease(f.source, options),
    before = await cli.read();
  await writeFile(join(f.source, 'skills/setup/SKILL.md'), 'Updated authoring guidance');
  await writeFile(cli.state, JSON.stringify({ ...before, rejectMcp: true }));
  await assert.rejects(installRelease(f.source, options), /registration failed/);
  const restored = await cli.read();
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
  assert.equal(restored.root, await realpath(f.directory));
  assert.equal(restored.cachedRelease, first.release);
  assert.equal(restored.cachedSkill, before.cachedSkill);
  assert.equal(restored.pluginInstalls, before.pluginInstalls + 2);
  assert.equal(restored.added, before.added);
  assert.equal(restored.removed, before.removed);
});

test('registration preserves a non-local marketplace with the same name', async (t) => {
  const f = await fixture(t),
    first = await installRelease(f.source, { directory: f.directory, register: false }),
    cli = await codexFixture(f, { root: 'https://example.com/marketplace.git', sourceType: 'git' });
  await writeFile(join(f.source, 'plugin/dist/value.mjs'), `export const value='update';`);
  await assert.rejects(
    installRelease(f.source, { directory: f.directory, codex: cli.codex }),
    /non-local source/,
  );
  const after = await cli.read();
  assert.equal(await realpath(join(f.directory, 'current')), first.release);
  assert.equal(after.added, 0);
  assert.equal(after.removed, 0);
  assert.equal(after.pluginInstalls, 0);
});
