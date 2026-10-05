import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { connectRuntime } from '../runtime/client.mjs';
import { command, sessionId, read, changeView, viewReport, acknowledgement } from './schema.mjs';
import { presentSession, toolResult } from './presentation.mjs';
import { authoringTools } from './authoring-tools.mjs';
import manifest from '../../plugin.json' with { type: 'json' };

const directory = dirname(process.argv[1]);
process.env.PATH = join(directory, '../../runtime/bin') + ':' + process.env.PATH;
const html = await readFile(join(directory, 'app.html'), 'utf8');
const runtime = await connectRuntime(directory);
const request = (sessionId, request) => runtime.call('request', { sessionId, request });
const server = new McpServer({
  name: 'visual-storytelling',
  title: 'Visual Storytelling',
  version: manifest.version,
});
new OpenAIExtensions(server);
const uri = `ui://visual-storytelling/${manifest.version}/${createHash('sha256').update(html).digest('hex').slice(0, 12)}/app.html`;
const result = (value, text = JSON.stringify(value)) => ({
  content: [{ type: 'text', text }],
  structuredContent: value,
});
const safely = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
};
registerAppResource(server, 'Визуальное объяснение', uri, {}, async () => ({
  contents: [
    {
      uri,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
      _meta: {
        ui: {
          prefersBorder: false,
          csp: { connectDomains: [], resourceDomains: ['data:', 'blob:'], frameDomains: ['blob:'] },
        },
        'openai/ui': {
          availableDisplayModes: ['inline', 'fullscreen'],
          preferredDisplayMode: 'inline',
        },
      },
    },
  ],
}));

registerAppTool(
  server,
  'story_open',
  {
    title: 'Визуальное объяснение',
    description:
      'Open Visual Storytelling in chat. With no arguments opens a ready interactive example. Reuse sessionId to move the same live scene between views. Commands use the existing view and do not create another card.',
    inputSchema: {
      sessionId: sessionId.optional(),
      projectId: z.string().uuid().optional(),
      path: z.string().optional(),
      example: z.string().optional(),
    },
    annotations: changeView,
    _meta: {
      ui: { resourceUri: uri, visibility: ['model', 'app'] },
      'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
    },
  },
  safely(async (args) => toolResult(presentSession(await runtime.call('open', args)))),
);

server.registerTool(
  'story_inspect',
  {
    description:
      'Read the displayed scene, working project or persistent job. No IDs lists active sessions. For a project, returns sourceRevision and file hashes; add file to read its UTF-8 source. For a session, returns compact state and capabilities. Request model for object values and causal inputs, timeline for all cues, or presentation for geometry.',
    inputSchema: {
      sessionId: sessionId.optional(),
      projectId: z.string().uuid().optional(),
      file: z.string().optional(),
      jobId: z.string().uuid().optional(),
      detail: z.enum(['state', 'model', 'timeline', 'presentation']).default('state'),
    },
    annotations: read,
  },
  safely(async ({ sessionId, projectId, file, jobId, detail }) => {
    if (jobId) return result(await runtime.call('job', { jobId }));
    if (projectId) return result(await runtime.call('project', { projectId, file }));
    return sessionId
      ? toolResult(presentSession(await request(sessionId, { op: 'inspect', detail }), detail))
      : result({ sessions: (await runtime.call('list')).map((s) => presentSession(s)) });
  }),
);
server.registerTool(
  'story_find',
  {
    description:
      'Find moments by words in the narration, action or stable cue ID. Returns matching semantic cues from the live scene.',
    inputSchema: { sessionId, query: z.string().min(1).max(500) },
    annotations: read,
  },
  safely(async ({ sessionId, query }) =>
    toolResult(presentSession(await request(sessionId, { op: 'find', query }))),
  ),
);
server.registerTool(
  'story_control',
  {
    description:
      'Control the existing live scene through its SceneHandle. Supply the inspected buildRevision and stateRevision, plus a unique requestId. Retries of the same requestId reuse the result. Acknowledgement means the renderer completed two animation frames, not a screenshot or transition completion.',
    inputSchema: {
      sessionId,
      buildRevision: z.string(),
      stateRevision: z.number().int().nonnegative(),
      requestId: z.string().min(8).max(100),
      commands: z.array(command).min(1).max(32),
    },
    annotations: changeView,
  },
  safely(async ({ sessionId, ...args }) =>
    toolResult(presentSession(await request(sessionId, { op: 'control', ...args }))),
  ),
);

registerAppTool(
  server,
  'story_view',
  {
    description: 'Private MCP App lifecycle and delivery channel. Never call from the model.',
    inputSchema: {
      sessionId,
      renderer: z.string().uuid(),
      generation: z.number().int().optional(),
      action: z.enum(['attach', 'exchange', 'detach', 'candidate', 'replace']),
      buildRevision: z.string().optional(),
      report: viewReport.optional(),
      acknowledgements: z.array(acknowledgement).max(32).optional(),
      wait: z.boolean().optional(),
    },
    annotations: changeView,
    _meta: { ui: { visibility: ['app'] } },
  },
  safely(async ({ action, ...args }) => {
    if (action === 'attach' || action === 'candidate') {
      const { html, ...state } = await runtime.call(action, args);
      return { ...result(state), _meta: { sceneHTML: html } };
    }
    return result(await runtime.call(action, args));
  }),
);
authoringTools(server, runtime, uri, safely);
server.server.onclose = () => runtime.close();
process.on('exit', () => runtime.close());
await server.connect(new StdioServerTransport());
