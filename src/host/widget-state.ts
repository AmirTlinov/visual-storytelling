export interface WidgetSnapshot {
  modelContent?: unknown;
  privateContent?: unknown;
}
interface WidgetHost {
  widgetState?: WidgetSnapshot;
  setWidgetState?(snapshot: WidgetSnapshot): Promise<unknown> | void;
}
interface StoredContent {
  __visualStory: { origin: string; wrapped: true };
  value?: unknown;
}
/** Same envelope in a host widget and an offline page; subjects own schema validation. */
export function widgetState(id: string, restore: (snapshot: WidgetSnapshot) => void) {
  const host = () => (window as Window & { openai?: WidgetHost }).openai;
  const key = `visual-story:${id}`,
    abort = new AbortController(),
    origin = crypto.randomUUID();
  // Keep transport metadata outside the author's value, including primitive values.
  function envelope(snapshot?: WidgetSnapshot) {
    const content = snapshot?.privateContent as StoredContent | undefined;
    return content?.__visualStory?.wrapped === true &&
      typeof content.__visualStory.origin === 'string'
      ? content
      : undefined;
  }
  function unpack(snapshot?: WidgetSnapshot): WidgetSnapshot | undefined {
    const content = envelope(snapshot);
    if (!snapshot || !content) return snapshot;
    const { privateContent, ...publicContent } = snapshot;
    return Object.hasOwn(content, 'value')
      ? { ...publicContent, privateContent: content.value }
      : publicContent;
  }
  function read(): WidgetSnapshot | undefined {
    if (host()) return unpack(host()!.widgetState);
    try {
      return unpack(JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined);
    } catch {
      return undefined;
    }
  }
  window.addEventListener(
    'openai:set_globals',
    (event) => {
      const snapshot = (event as CustomEvent<{ globals?: { widgetState?: WidgetSnapshot } }>).detail
        ?.globals?.widgetState;
      if (snapshot && envelope(snapshot)?.__visualStory.origin !== origin)
        restore(unpack(snapshot)!);
    },
    { signal: abort.signal },
  );
  return {
    read,
    save(snapshot: WidgetSnapshot) {
      if (abort.signal.aborted) return;
      const bridge = host();
      snapshot = {
        ...snapshot,
        privateContent: {
          __visualStory: { origin, wrapped: true },
          ...(Object.hasOwn(snapshot, 'privateContent') ? { value: snapshot.privateContent } : {}),
        },
      };
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
