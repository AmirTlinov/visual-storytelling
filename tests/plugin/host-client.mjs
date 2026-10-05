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
  opened,
  context,
  messages = [];
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
      updateModelContext: {},
      message: {},
      experimental: { 'openai/modelContext': {} },
    },
    { hostContext },
  );
  bridge.oncalltool = ({ name, arguments: args }) => call(name, args);
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
  bridge.onrequestdisplaymode = async ({ mode }) => {
    iframe.style.height = mode === 'fullscreen' ? '900px' : '730px';
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
