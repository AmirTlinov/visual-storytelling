import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('direct author measurement transport preserves installed tool calls and image evidence without authoring', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'author-mcp-'));
  const calls = [];
  const schema = {
    name: 'story_create',
    description: 'Real owner',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } } },
  };
  const server = createServer(async (req, res) => {
    assert.equal(req.headers['x-benchmark-token'], 'test');
    let body = '';
    for await (const chunk of req) body += chunk;
    const action = JSON.parse(body);
    calls.push(action);
    const result =
      action.action === 'ready'
        ? { tools: [schema], context: 'actual' }
        : action.action === 'observe'
          ? {
              png: Buffer.from('transport fixture').toString('base64'),
              path: '/retained/frame.png',
              state: { snapshot: { count: 17 } },
            }
          : action.action === 'call'
            ? {
                structuredContent: { accepted: action.arguments.document },
                content: [{ type: 'text', text: 'accepted' }],
              }
            : { index: 0 };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = join(out, 'endpoint.json');
  await writeFile(
    endpoint,
    JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token: 'test' }),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('tests/plugin/author-benchmark-mcp.mjs'), endpoint],
  });
  const client = new Client({ name: 'transport-test', version: '1' });
  t.after(async () => {
    await client.close();
    await new Promise((r) => server.close(r));
    await rm(out, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.find((t) => t.name === 'story_create').inputSchema, schema.inputSchema);
  const document = { recipe: 'division', inputs: { count: 17, divisor: 4 } };
  const result = await client.callTool({ name: 'story_create', arguments: { document } });
  assert.deepEqual(result.structuredContent.accepted, document);
  assert.deepEqual(calls.at(-1), { action: 'call', name: 'story_create', arguments: { document } });
  const observed = await client.callTool({
    name: 'benchmark_observe',
    arguments: { label: 'first' },
  });
  assert.equal(observed.content[0].type, 'image');
  assert.equal(observed.content[0].mimeType, 'image/png');
  assert.equal(observed.structuredContent.path, '/retained/frame.png');
  assert(!Object.hasOwn(observed.structuredContent, 'png'));
  const shell = async (request) => {
    const child = spawn(process.execPath, [
      resolve('tests/plugin/author-benchmark-client.mjs'),
      endpoint,
    ]);
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (bytes) => (stdout += bytes));
    child.stderr.on('data', (bytes) => (stderr += bytes));
    const finished = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    child.stdin.end(JSON.stringify(request));
    assert.equal(await finished, 0, stderr);
    return JSON.parse(stdout);
  };
  assert.deepEqual(
    (await shell({ action: 'call', name: 'story_create', arguments: { document } }))
      .structuredContent.accepted,
    document,
  );
  assert.deepEqual(calls.at(-1), { action: 'call', name: 'story_create', arguments: { document } });
  const retained = await shell({ action: 'observe', label: 'first' });
  assert.equal(retained.path, '/retained/frame.png');
  assert.deepEqual(retained.state.snapshot, { count: 17 });
  assert(!Object.hasOwn(retained, 'png'));
  const unknown = await client.callTool({ name: 'unknown', arguments: {} });
  assert.equal(unknown.isError, true);
});
