import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applicationDirectory } from '../tools/storage.mjs';
const execute = promisify(execFile);

test('Linux application storage follows absolute XDG data home and preserves macOS paths', () => {
  const options = { home: '/home/author', environment: {}, platform: 'linux' };
  assert.equal(applicationDirectory(options), '/home/author/.local/share/visual-storytelling');
  assert.equal(applicationDirectory({ ...options, environment: { XDG_DATA_HOME: '/data with spaces' } }), '/data with spaces/visual-storytelling');
  assert.equal(applicationDirectory({ ...options, environment: { XDG_DATA_HOME: 'relative' } }), applicationDirectory(options));
  assert.equal(applicationDirectory({ ...options, platform: 'darwin' }), '/home/author/Library/Application Support/Visual Storytelling');
});

test('Linux MCP launcher resolves the same XDG path without a system Node install', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-linux-launch-'));
  try {
    const bin = join(directory, 'bin'), xdg = join(directory, 'data with spaces');
    await mkdir(bin);
    const uname = join(bin, 'uname');
    await writeFile(uname, '#!/bin/sh\nprintf Linux');
    await chmod(uname, 0o755);
    const installation = join(applicationDirectory({ platform: 'linux', environment: { XDG_DATA_HOME: xdg } }), 'installation');
    await mkdir(installation, { recursive: true });
    await writeFile(join(installation, 'launch'), '#!/bin/sh\nprintf "XDG launcher"');
    await chmod(join(installation, 'launch'), 0o755);
    const spec = JSON.parse(await readFile(new URL('../mcp.json', import.meta.url), 'utf8')).mcpServers['visual-storytelling'];
    assert.equal(spec.command, 'sh');
    const { stdout } = await execute('/bin/sh', spec.args, { env: {
      ...process.env, PATH: bin, XDG_DATA_HOME: xdg, VISUAL_STORY_INSTALL_DIR: '',
    } });
    assert.equal(stdout, 'XDG launcher');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
