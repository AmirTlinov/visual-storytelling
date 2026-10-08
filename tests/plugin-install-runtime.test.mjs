import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { installRelease } from '../plugin/install.mjs';
import { connectRuntime } from '../plugin/runtime/client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function wait(check) {
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error('Runtime did not reach the expected state.');
}
async function gone(pid) {
  return wait(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
  });
}
async function tool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}

test(
  'installed version flip keeps an active job and one session owner, then resumes without replay',
  { timeout: 20000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-installed-runtime-')),
      source = join(temporary, 'download'),
      directory = join(temporary, 'installation'),
      data = join(temporary, 'data'),
      clients = new Set(),
      kernels = new Set();
    await mkdir(data);
    t.after(async () => {
      await Promise.allSettled([...clients].map((c) => c.close()));
      for (const pid of kernels)
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      await Promise.all([...kernels].map(gone));
      async function unlock(path) {
        for (const item of await readdir(path, { withFileTypes: true }))
          if (item.isDirectory()) await unlock(join(path, item.name));
        await chmod(path, 0o700);
      }
      await unlock(temporary);
      await rm(temporary, { recursive: true, force: true });
    });
    for (const path of ['plugin/dist', 'runtime', 'dist', 'tools'])
      await mkdir(join(source, path), { recursive: true });
    await Promise.all(
      ['server', 'kernel'].map((name) =>
        build({
          entryPoints: [
            join(root, name === 'server' ? 'plugin/mcp/server.mjs' : 'plugin/runtime/kernel.mjs'),
          ],
          outfile: join(source, 'plugin/dist', name + '.mjs'),
          bundle: true,
          platform: 'node',
          target: 'node22',
          format: 'esm',
          ...(name === 'server'
            ? {
                banner: {
                  js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
                },
              }
            : {}),
        }),
      ),
    );
    for (const [name, value] of Object.entries({
      'plugin.json': JSON.stringify({ name: 'visual-storytelling', version: '1.0.0' }),
      'release.json': JSON.stringify({
        plugin: '1.0.0',
        platform: process.platform,
        arch: process.arch,
      }),
      'runtime/node': `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`,
      'dist/build-info.json': '{}',
      LICENSE: '0BSD',
      'plugin/dist/app.html': '<main>Install runtime test</main>',
      'plugin/dist/example.json': JSON.stringify({
        revision: 'fixture',
        title: 'Fixture',
        html: '<main>Ready</main>',
      }),
      'plugin/dist/catalog.json': JSON.stringify({ fixture: { title: 'Fixture' } }),
      'plugin/dist/value.mjs': `export const value='first';`,
      'tools/api.mjs': `export const describeAPI=async(root)=>({text:root,missing:[]});`,
      'tools/uv.lock': '# Isolated runtime fixture; voice is not prepared.\n',
      'plugin/dist/worker.mjs': `
import {appendFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
process.on('message',async(message)=>{
 if(message.type==='cancel')return;
 const {input}=message;
 await appendFile(join(input.data,'starts'),'worker started\\n');
 process.send({type:'authored',project:{id:input.projectId,path:input.projectPath,sourceRevision:'fixture'}});
 while(!await access(join(input.data,'finish')).then(()=>true,()=>false))await delay(20);
 const {value}=await import('./value.mjs');
 process.send({type:'result',result:{value}},()=>process.disconnect());
});`,
    }))
      await writeFile(join(source, name), value);
    await chmod(join(source, 'runtime/node'), 0o755);
    await cp(join(root, 'mcp.json'), join(source, 'mcp.json'));
    const spec = JSON.parse(await readFile(join(source, 'mcp.json'), 'utf8')).mcpServers[
      'visual-storytelling'
    ];
    async function stdio() {
      const client = new Client({ name: 'stable-install-test', version: '1' });
      clients.add(client);
      await client.connect(
        new StdioClientTransport({
          ...spec,
          cwd: data,
          stderr: 'inherit',
          env: {
            ...process.env,
            VISUAL_STORY_DATA_DIR: data,
            VISUAL_STORY_INSTALL_DIR: directory,
            PLUGIN_ROOT: '/removed/cache',
            PLUGIN_DATA: data,
          },
        }),
      );
      return client;
    }
    async function direct(release) {
      const previous = process.env.VISUAL_STORY_DATA_DIR;
      process.env.VISUAL_STORY_DATA_DIR = data;
      try {
        const client = await connectRuntime(join(release, 'plugin/dist'));
        clients.add(client);
        kernels.add((await client.call('hello')).pid);
        return client;
      } catch (error) {
        throw new Error(
          `${error.message}\n${await readFile(join(data, 'runtime.log'), 'utf8').catch(() => '')}`,
          { cause: error },
        );
      } finally {
        if (previous === undefined) delete process.env.VISUAL_STORY_DATA_DIR;
        else process.env.VISUAL_STORY_DATA_DIR = previous;
      }
    }
    const first = await installRelease(source, { directory, register: false }),
      a = await stdio(),
      runtime = await direct(first.release),
      hello = await runtime.call('hello');
    assert.equal((await tool(a, 'story_help', { query: 'Fixture' })).text, first.release);
    const opened = await tool(a, 'story_open'),
      renderer = randomUUID();
    const attached = await tool(a, 'story_view', {
      sessionId: opened.sessionId,
      renderer,
      action: 'attach',
    });
    const checkpoint = { time: 7, progress: 0.7, mode: 'explore', values: { x: 3 } };
    await tool(a, 'story_view', {
      sessionId: opened.sessionId,
      renderer,
      generation: attached.generation,
      action: 'exchange',
      wait: false,
      report: {
        stateRevision: 1,
        checkpoint,
        state: {
          time: 7,
          duration: 10,
          mode: 'explore',
          playing: false,
          parameters: [],
          capabilities: ['seek'],
        },
      },
    });
    const requestId = randomUUID(),
      input = {
        path: join(temporary, 'project'),
        title: 'Install job',
        example: 'fixture',
        requestId,
      };
    const created = await tool(a, 'story_create', input);
    assert.equal(created.job.status, 'running');
    await writeFile(join(source, 'plugin/dist/value.mjs'), `export const value='second';`);
    const next = await installRelease(source, { directory, register: false });
    await rm(source, { recursive: true, force: true });
    const b = await stdio();
    const conflict = await b.callTool({ name: 'story_open', arguments: {} });
    assert.equal(conflict.structuredContent.error.code, 'RUNTIME_VERSION_CONFLICT');
    assert.match(conflict.structuredContent.error.action, /reconnect/);
    assert.equal((await runtime.call('hello')).pid, hello.pid);
    runtime.close();
    await a.close();
    await delay(1700);
    process.kill(hello.pid, 0); // No clients remain; the active job still owns this runtime.
    await writeFile(join(data, 'finish'), 'finish');
    await gone(hello.pid);
    assert.equal(
      (await tool(b, 'story_help', { query: 'Fixture' })).text,
      next.release,
      'the same new MCP connection can retry after the previous owner exits',
    );
    const resumed = await tool(b, 'story_open', { sessionId: opened.sessionId });
    assert.notEqual(resumed.serverInstance, hello.serverInstance);
    const recovered = await tool(b, 'story_view', {
      sessionId: opened.sessionId,
      renderer,
      action: 'attach',
    });
    assert.equal(recovered.generation, attached.generation + 1);
    assert.deepEqual(recovered.checkpoint, checkpoint);
    const again = await tool(b, 'story_create', input);
    assert.equal(again.job.id, created.job.id);
    assert.equal(again.job.status, 'succeeded');
    assert.deepEqual(
      again.job.result,
      { value: 'first' },
      'late imports remain in the active release',
    );
    assert.equal(
      await readFile(join(data, 'starts'), 'utf8'),
      'worker started\n',
      'reconnecting does not replay the completed preparation',
    );
    await direct(next.release);
  },
);
