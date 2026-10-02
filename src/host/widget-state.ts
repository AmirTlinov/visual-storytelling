export interface WidgetSnapshot {
  modelContent?: unknown;
  privateContent?: unknown;
}
interface WidgetHost {
  widgetState?: WidgetSnapshot;
  setWidgetState?(snapshot: WidgetSnapshot): Promise<unknown> | void;
}
/** Same envelope in a host widget and an offline page; subjects own schema validation. */
export function widgetState(id: string, restore: (snapshot: WidgetSnapshot) => void) {
  const host = () => (window as Window & { openai?: WidgetHost }).openai;
  const key = `visual-story:${id}`,
    abort = new AbortController(),
    origin = crypto.randomUUID();
  function read(): WidgetSnapshot | undefined {
    if (host()) return host()!.widgetState;
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  }
  window.addEventListener(
    'openai:set_globals',
    (event) => {
      const snapshot = (event as CustomEvent<{ globals?: { widgetState?: WidgetSnapshot } }>).detail
        ?.globals?.widgetState;
      const meta = snapshot?.privateContent as { __visualStory?: { origin?: string } } | undefined;
      if (snapshot && meta?.__visualStory?.origin !== origin) restore(snapshot);
    },
    { signal: abort.signal },
  );
  return {
    read,
    save(snapshot: WidgetSnapshot) {
      if (abort.signal.aborted) return;
      const bridge = host();
      const content = snapshot.privateContent;
      if (content && typeof content === 'object' && !Array.isArray(content))
        snapshot = { ...snapshot, privateContent: { ...content, __visualStory: { origin } } };
      if (bridge?.setWidgetState) {
        try {
          Promise.resolve(bridge.setWidgetState(snapshot)).catch(() => {});
        } catch {
          /* Host may be detaching. */
        }
      } else {
        try {
          localStorage.setItem(key, JSON.stringify(snapshot));
        } catch {
          /* Private/offline hosts may disable storage. */
        }
      }
    },
    dispose() {
      abort.abort();
    },
  };
}
