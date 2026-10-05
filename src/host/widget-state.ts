import { sceneHost, watchSceneHost, type WidgetSnapshot } from './adapter.js';
export type { WidgetSnapshot } from './adapter.js';
interface StoredContent {
  __visualStory: { origin: string; wrapped: true };
  value?: unknown;
}
/** Same envelope in a host widget and an offline page; subjects own schema validation. */
export function widgetState(id: string, restore: (snapshot: WidgetSnapshot) => void) {
  const key = `visual-story:${id}`,
    abort = new AbortController(),
    origin = crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint32Array(4))].join('-');
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
    if (sceneHost()?.widgetState) return unpack(sceneHost()!.widgetState!.read(id));
    try {
      return unpack(JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined);
    } catch {
      return undefined;
    }
  }
  const receive = (snapshot: WidgetSnapshot) => {
    if (!abort.signal.aborted && envelope(snapshot)?.__visualStory.origin !== origin)
      restore(unpack(snapshot)!);
  };
  let unsubscribe = sceneHost()?.widgetState?.subscribe?.(id, receive);
  const unwatch = watchSceneHost(() => {
    unsubscribe?.();
    unsubscribe = sceneHost()?.widgetState?.subscribe?.(id, receive);
    const saved = read();
    if (saved !== undefined) receive(saved);
  });
  return {
    read,
    save(snapshot: WidgetSnapshot) {
      if (abort.signal.aborted) return;
      const bridge = sceneHost()?.widgetState;
      snapshot = {
        ...snapshot,
        privateContent: {
          __visualStory: { origin, wrapped: true },
          ...(Object.hasOwn(snapshot, 'privateContent') ? { value: snapshot.privateContent } : {}),
        },
      };
      if (bridge) {
        try {
          Promise.resolve(bridge.save(id, snapshot)).catch(() => {});
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
      unsubscribe?.();
      unwatch();
    },
  };
}
