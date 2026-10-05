export interface WidgetSnapshot {
  modelContent?: unknown;
  privateContent?: unknown;
}

/** Host services are optional. The scene remains a normal offline document. */
export interface SceneHost {
  beforePlay?(request: {
    muted: boolean;
    hasAudio: boolean;
    signal: AbortSignal;
  }): void | Promise<void>;
  widgetState?: {
    read(id: string): WidgetSnapshot | undefined;
    save(id: string, snapshot: WidgetSnapshot): void | Promise<unknown>;
    subscribe?(id: string, listener: (snapshot: WidgetSnapshot) => void): () => void;
  };
}

interface OpenAIWidget {
  widgetState?: WidgetSnapshot;
  setWidgetState?(snapshot: WidgetSnapshot): void | Promise<unknown>;
}
const legacyWidget = () => (globalThis as typeof globalThis & { openai?: OpenAIWidget }).openai;
const legacyHost: SceneHost = {
  widgetState: {
    read: () => legacyWidget()?.widgetState,
    save: (_id, snapshot) => legacyWidget()?.setWidgetState?.(snapshot),
    subscribe(_id, listener) {
      const changed = (event: Event) => {
        const state = (event as CustomEvent<{ globals?: { widgetState?: WidgetSnapshot } }>).detail
          ?.globals?.widgetState;
        if (state !== undefined) listener(state);
      };
      addEventListener('openai:set_globals', changed);
      return () => removeEventListener('openai:set_globals', changed);
    },
  },
};
let connected: SceneHost | undefined;
const listeners = new Set<() => void>();

export const sceneHost = (): SceneHost | undefined =>
  connected ?? (legacyWidget() ? legacyHost : undefined);

/** One host connection per document; an obsolete disconnect cannot remove a newer host. */
export function connectSceneHost(host: SceneHost) {
  connected = host;
  for (const listener of listeners) listener();
  return () => {
    if (connected !== host) return;
    connected = undefined;
    for (const listener of listeners) listener();
  };
}

export function watchSceneHost(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
