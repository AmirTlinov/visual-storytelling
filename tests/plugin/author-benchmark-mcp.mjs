import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { benchmarkRequest } from './benchmark-request.mjs';

// Test transport only. The same installed MCP, clocks, questions and browser evidence
// remain owned by authorBenchmark; this process authors no document or answer.
const endpoint = JSON.parse(await readFile(process.argv[2], 'utf8'));
async function request(action, args = {}) {
  return benchmarkRequest(endpoint, { action, ...args });
}
const ready = await request('ready');
const object = (properties = {}) => ({ type: 'object', properties, additionalProperties: false });
const testTools = [
  {
    name: 'benchmark_ready',
    description:
      'Read measurement environment and the live card context before starting a timed question.',
    inputSchema: object(),
  },
  {
    name: 'benchmark_start',
    description:
      'Start the next timed question. The clock includes every subsequent thought, retry and tool call until finish.',
    inputSchema: object(),
  },
  {
    name: 'benchmark_observe',
    description:
      'Read the actual completed model state and see its browser pixels. First must precede initial and changed; observations cannot be replaced.',
    inputSchema: {
      ...object({ label: { type: 'string', enum: ['first', 'initial', 'changed'] } }),
      required: ['label'],
    },
  },
  {
    name: 'benchmark_finish',
    description:
      'Finish the active question after authoring, initial/end inspection and a manual parameter change. Failures and retries remain in the dataset.',
    inputSchema: object({ comments: { type: 'string' }, error: { type: 'string' } }),
  },
];
const server = new Server(
  { name: 'visual-story-author-benchmark', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...ready.tools, ...testTools],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = params.arguments ?? {};
    if (ready.tools.some((tool) => tool.name === params.name))
      return await request('call', { name: params.name, arguments: args });
    let result;
    if (params.name === 'benchmark_ready') {
      const { tools, ...environment } = await request('ready');
      result = environment;
    } else if (params.name === 'benchmark_start') result = await request('start');
    else if (params.name === 'benchmark_finish') result = await request('finish', args);
    else if (params.name === 'benchmark_observe') {
      const { png, ...observation } = await request('observe', args);
      return {
        content: [
          { type: 'image', mimeType: 'image/png', data: png },
          { type: 'text', text: JSON.stringify(observation) },
        ],
        structuredContent: observation,
      };
    } else throw Error(`Unknown benchmark tool: ${params.name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
