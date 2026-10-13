import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const token = document.body.dataset.token;
const initialTarget = JSON.parse(decodeURIComponent(document.body.dataset.initial));
const call = async (name, args = {}) => {
  const response = await fetch('/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-token': token },
    body: JSON.stringify({ name, arguments: args }),
  });
  return response.json();
};
let bridge,
  iframe,
  inlineHeight = 730,
  opened,
  context,
  messages = [];
const resources = new Map();
let focusDelay = 0,
  focusRequests = 0;
const displayRequests = [];
let hostContext = {
  theme: 'light',
  displayMode: 'inline',
  availableDisplayModes: ['inline', 'fullscreen'],
};
async function mount(sessionId, result) {
  opened = result ?? (await call('story_open', sessionId ? { sessionId } : initialTarget));
  iframe = document.createElement('iframe');
  iframe.title = 'MCP App';
  iframe.style.cssText = 'border:0;width:100%;height:730px';
  document.body.append(iframe);
  bridge = new AppBridge(
    null,
    { name: 'Visual Storytelling contract host', version: '1' },
    {
      serverTools: {},
      serverResources: {},
      updateModelContext: {},
      message: {},
      experimental: { 'openai/modelContext': {}, 'openai/resource': {} },
    },
    { hostContext },
  );
  bridge.oncalltool = async ({ name, arguments: args }) => {
    if (name === 'story_view' && args.action === 'focus') {
      focusRequests++;
      if (focusDelay) await new Promise((resolve) => setTimeout(resolve, focusDelay));
    }
    return call(name, args);
  };
  bridge.onreadresource = async ({ uri }) => {
    if (!resources.has(uri)) throw new Error('Unknown host resource');
    return { contents: [{ uri, text: resources.get(uri), mimeType: 'application/json' }] };
  };
  bridge.onupdatemodelcontext = async (value) => {
    context = value;
    const updateId = crypto.randomUUID();
    bridge.setHostContext((hostContext = { ...hostContext, 'openai/modelContext': { updateId } }));
    return { _meta: { 'openai/modelContext': { updateId } } };
  };
  bridge.onmessage = async (message) => {
    messages.push(message);
    return {};
  };
  bridge.addEventListener('sizechange', ({ height }) => {
    if (hostContext.displayMode !== 'fullscreen' && Number.isFinite(height)) {
      inlineHeight = Math.ceil(height);
      iframe.style.height = `${inlineHeight}px`;
    }
  });
  bridge.onrequestdisplaymode = async ({ mode }) => {
    displayRequests.push(mode);
    if (!hostContext.availableDisplayModes.includes(mode)) return { mode: hostContext.displayMode };
    iframe.style.height = mode === 'fullscreen' ? '900px' : `${inlineHeight}px`;
    hostContext = { ...hostContext, displayMode: mode };
    bridge.setHostContext(hostContext);
    return { mode };
  };
  bridge.addEventListener('initialized', async () => {
    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult(opened);
  });
  await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
  iframe.src = '/app';
}
window.pluginTest = {
  call,
  partial(args) {
    return bridge.sendToolInputPartial({ arguments: args });
  },
  async result(result) {
    opened = result;
    await bridge.sendToolResult(result);
  },
  delayFocus(ms) {
    focusDelay = ms;
  },
  get focusRequests() {
    return focusRequests;
  },
  get displayRequests() {
    return displayRequests;
  },
  display(mode, availableDisplayModes) {
    iframe.style.height = mode === 'fullscreen' ? '900px' : `${inlineHeight}px`;
    bridge.setHostContext(
      (hostContext = { ...hostContext, displayMode: mode, availableDisplayModes }),
    );
  },
  async openFile(uri, text) {
    resources.set(uri, text);
    await bridge.sendToolInput({ arguments: { file: { name: 'story.vstory', resourceUri: uri } } });
  },
  get session() {
    return opened.structuredContent;
  },
  get context() {
    return context;
  },
  get messages() {
    return messages;
  },
  async openResult(result) {
    await bridge.teardownResource({});
    await bridge.close();
    iframe.remove();
    await mount(undefined, result);
  },
  async remount() {
    const id = opened.structuredContent.sessionId;
    await bridge.teardownResource({});
    await bridge.close();
    iframe.remove();
    await mount(id);
  },
  async removeContext() {
    bridge.setHostContext((hostContext = { ...hostContext, 'openai/modelContext': null }));
  },
  async theme(theme) {
    hostContext = { ...hostContext, theme };
    bridge.setHostContext({ theme });
  },
};
await mount();
if (document.body.dataset.webTools === 'true') {
  if (!document.modelContext) document.body.dataset.webMcp = 'unavailable';
  else {
    const publicTools = await fetch('/tools', { headers: { 'x-test-token': token } }).then((r) =>
      r.json(),
    );
    for (const tool of publicTools)
      await document.modelContext.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        async execute(args) {
          if (tool.name === 'story_create') await bridge.sendToolInputPartial({ arguments: args });
          const result = await call(tool.name, args);
          if (tool.name === 'story_create' || tool.name === 'story_open') {
            opened = result;
            await bridge.sendToolResult(result);
          }
          return result;
        },
      });
    if (document.body.dataset.authorTrial === 'true') {
      const trialCall = async (action, args) => {
        const value = await fetch('/author-trial', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-test-token': token,
          },
          body: JSON.stringify({ action, ...args }),
        }).then((r) => r.json());
        return {
          structuredContent: value,
          content: [{ type: 'text', text: JSON.stringify(value) }],
        };
      };
      await document.modelContext.registerTool({
        name: 'warm_author_start',
        description:
          'Start an unknown division authoring trial after the installed card is warm. Returns a brief, frozen scene context and start timestamp. No experience is authored by this tool.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          trialCall('start', { context: context?.structuredContent?.visualStory?.context }),
      });
      await document.modelContext.registerTool({
        name: 'warm_author_finish',
        description:
          'Record the end of an agent-checked authoring trial. Supply the first verified screenshot timestamp and factual observations. Does not change the scene.',
        inputSchema: {
          type: 'object',
          properties: { capturedAt: { type: 'number' }, observations: { type: 'object' } },
          required: ['capturedAt', 'observations'],
        },
        execute: (args) => trialCall('finish', args),
      });
    }
    document.body.dataset.webMcp = 'ready';
  }
}
