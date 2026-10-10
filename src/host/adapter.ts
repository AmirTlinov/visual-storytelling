export interface WidgetSnapshot {
  modelContent?: unknown;
  privateContent?: unknown;
}

/** Host services are optional. The scene remains a normal offline document. */
export interface SceneHost {
  /** Actual host surface, independent of the subject camera and saved conditions. */
  presentation?: {
    read(): { mode: 'inline' | 'expanded'; canExpand: boolean };
    requestExpanded(): Promise<void>;
    subscribe(
      listener: (state: { mode: 'inline' | 'expanded'; canExpand: boolean }) => void,
    ): () => void;
  };
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
// SVG entries and their HTML shell can be bundled independently in the same realm.
// The host connection belongs to that document, not to an individual module copy.
const hostKey = Symbol.for('@visual-storytelling/scene-host');
const realm = globalThis as typeof globalThis & {
  [hostKey]?: { connected?: SceneHost; listeners: Set<() => void> };
};
const registry = (realm[hostKey] ??= { listeners: new Set() });

export const sceneHost = (): SceneHost | undefined =>
  registry.connected ?? (legacyWidget() ? legacyHost : undefined);

/** One host connection per document; an obsolete disconnect cannot remove a newer host. */
export function connectSceneHost(host: SceneHost) {
  registry.connected = host;
  for (const listener of registry.listeners) listener();
  return () => {
    if (registry.connected !== host) return;
    registry.connected = undefined;
    for (const listener of registry.listeners) listener();
  };
}

export function watchSceneHost(listener: () => void) {
  registry.listeners.add(listener);
  return () => registry.listeners.delete(listener);
}
