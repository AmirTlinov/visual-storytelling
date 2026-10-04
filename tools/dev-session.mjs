import { randomUUID } from 'node:crypto';

const endpoint = '/__visual_story_session';
/** Development-only bridge to the renderer already mounted in an open preview. */
export function previewSessions() {
  const views = new Map(),
    pending = new Map();
  let built = null,
    error = null;
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const status = () => ({
    built,
    error,
    views: [...views].map(([id, v]) => ({
      id,
      path: v.path,
      revision: v.revision,
      ready: v.ready,
    })),
  });
  const rejectView = (id) => {
    for (const [key, request] of pending)
      if (request.view === id) {
        clearTimeout(request.timer);
        pending.delete(key);
        request.reject(
          new Error('Preview disconnected; inspect the current session before retrying'),
        );
      }
  };
  return {
    publish(value) {
      built = value;
      error = null;
    },
    fail(message) {
      error = message;
    },
    status,
    connect(id, response) {
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid preview identity');
      const previous = views.get(id);
      if (previous) {
        previous.response.end();
        rejectView(id);
      }
      const view = { response, ready: false, revision: null, path: null };
      views.set(id, view);
      return () => {
        if (views.get(id) === view) {
          views.delete(id);
          rejectView(id);
        }
      };
    },
    async handle(req, res) {
      if (new URL(req.url, 'http://localhost').pathname !== endpoint) return false;
      // A web page on another origin cannot use localhost as a scene-control proxy.
      const host = new URL(`http://${req.headers.host}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
        reply(res, 403, { error: 'Use a loopback hostname' });
        return true;
      }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        reply(res, 403, { error: 'Use the same-origin preview or local CLI' });
        return true;
      }
      if (req.method === 'GET') {
        reply(res, 200, status());
        return true;
      }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) {
        reply(res, 415, { error: 'Send JSON' });
        return true;
      }
      try {
        let text = '';
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 2_000_000) throw new Error('Session message is too large');
        }
        const data = JSON.parse(text),
          view = views.get(data.view);
        if (!view) throw new Error('Open a preview and inspect its session ID');
        if (data.op === 'ready') {
          if (typeof data.revision !== 'string' || typeof data.path !== 'string')
            throw new Error('Invalid ready receipt');
          view.ready = true;
          view.revision = data.revision;
          view.path = data.path;
          reply(res, 200, { ok: true });
        } else if (data.op === 'result') {
          const request = pending.get(data.id);
          if (!request || request.view !== data.view) throw new Error('Expired preview request');
          clearTimeout(request.timer);
          pending.delete(data.id);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve({ view: data.view, revision: data.revision, result: data.result });
          reply(res, 200, { ok: true });
        } else {
          if (!['inspect', 'find', 'control'].includes(data.op))
            throw new Error('Session operations: inspect, find, control');
          if (!view.ready || data.revision !== view.revision)
            throw new Error('Shown revision changed; inspect the session before retrying');
          const id = randomUUID();
          const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(new Error('Preview did not answer within 10s'));
            }, 10_000);
            pending.set(id, { view: data.view, resolve, reject, timer });
            view.response.write(
              `event: request\ndata: ${JSON.stringify({ ...data, id, expiresAt: Date.now() + 10_000 })}\n\n`,
            );
          });
          reply(res, 200, result);
        }
      } catch (cause) {
        reply(res, 409, { error: cause.message });
      }
      return true;
    },
    dispose() {
      for (const id of views.keys()) rejectView(id);
      views.clear();
    },
  };
}

/** Resolve an unambiguous visible instance, then pin every command to its shown build. */
export async function requestSession(
  url,
  operation = 'inspect',
  { view, revision, query, commands } = {},
) {
  const address = new URL(endpoint, url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname))
    throw new Error('Development sessions use a loopback URL');
  const state = await fetch(address).then((r) => r.json());
  if (operation === 'status') return state;
  const choices = state.views.filter((v) => v.ready && (!view || v.id === view));
  if (choices.length !== 1)
    throw new Error(
      `Choose one ready view with --view; ${choices.length} match. Run session URL status.`,
    );
  const current = choices[0];
  const response = await fetch(address, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      op: operation,
      view: current.id,
      revision: revision ?? current.revision,
      query,
      commands,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
