import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Development host uses the real SDK and stdio server; it does not claim native Codex acceptance. */
export async function pluginHost({
  port = 0,
  dataDirectory,
  serverCommand = process.execPath,
  serverEntry = fileURLToPath(new URL('../../plugin/dist/server.mjs', import.meta.url)),
} = {}) {
  const temporary = !dataDirectory;
  dataDirectory ??= await mkdtemp(join(tmpdir(), 'visual-story-host-'));
  const client = new Client({ name: 'story-contract-host', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: serverCommand,
      args: [serverEntry],
      stderr: 'inherit',
      env: { ...process.env, VISUAL_STORY_DATA_DIR: dataDirectory },
    }),
  );
  const { tools } = await client.listTools();
  const { contents } = await client.readResource({
    uri: tools.find((t) => t.name === 'story_open')._meta.ui.resourceUri,
  });
  const code = await build({
    entryPoints: [fileURLToPath(new URL('host-client.mjs', import.meta.url))],
    bundle: true,
    format: 'esm',
    write: false,
  });
  const token = randomUUID();
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/call' && req.method === 'POST' && req.headers['x-test-token'] === token) {
        let text = '';
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 2_000_000) throw new Error('Request too large');
        }
        const request = JSON.parse(text);
        const result = await client.callTool(request);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(403).end();
        return;
      }
      if (req.url === '/host.js')
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(code.outputFiles[0].text);
      else if (req.url === '/app')
        res
          .writeHead(200, {
            'content-type': 'text/html',
            'content-security-policy':
              "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src blob:",
          })
          .end(contents[0].text);
      else if (req.url === '/')
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            `<!doctype html><html><head><meta charset="utf-8"><title>Visual Storytelling · MCP contract host</title></head><body data-token="${token}" style="margin:0;max-width:820px;margin:auto"><script type="module" src="/host.js"></script></body></html>`,
          );
      else res.writeHead(404).end();
    } catch (error) {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    client,
    async close() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await client.close();
      if (temporary) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = await pluginHost({ port: Number(process.argv[2] ?? 0) });
  console.log(host.url);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await host.close();
      process.exit();
    });
}
