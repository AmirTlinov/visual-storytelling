import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const token = document.body.dataset.token;
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
let hostContext = {
  theme: 'light',
  displayMode: 'inline',
  availableDisplayModes: ['inline', 'fullscreen'],
};
async function mount(sessionId, result) {
  opened = result ?? (await call('story_open', sessionId ? { sessionId } : {}));
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
    iframe.style.height = mode === 'fullscreen' ? '900px' : `${inlineHeight}px`;
    bridge.setHostContext((hostContext = { ...hostContext, displayMode: mode }));
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
  delayFocus(ms) {
    focusDelay = ms;
  },
  get focusRequests() {
    return focusRequests;
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
    bridge.setHostContext((hostContext = { ...hostContext, theme }));
  },
};
await mount();
