/* One scene history: live changes are grouped by the gesture that produced them. */

function mount<T, R>(
  root: HTMLElement,
  {
    read,
    restore,
    beforeTravel = () => {},
    equal = (a, b) => JSON.stringify(a) === JSON.stringify(b),
    changed = () => {},
    onError = (error) => {
      console.error(error);
    },
    gestureRoot = root,
  }: {
    read: () => T;
    restore: (value: T) => R | Promise<R>;
    beforeTravel?: () => void;
    equal?: (a: T, b: T) => boolean;
    changed?: () => void;
    onError?: (error: unknown) => void;
    gestureRoot?: HTMLElement;
  },
) {
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const past: T[] = [],
    future: T[] = [],
    copy = (value: T) => structuredClone(value);
  let current = copy(read()),
    pending = false,
    applying = 0,
    disposed = false;
  let field: HTMLElement | null = null;
  function record() {
    if (pending || applying) return;
    const next = copy(read());
    if (equal(next, current)) return;
    past.push(current);
    if (past.length > 100) past.shift();
    current = next;
    future.length = 0;
    changed();
  }
  function begin() {
    if (applying || pending) return;
    current = copy(read());
    pending = true;
  }
  function end() {
    if (!pending) return;
    pending = false;
    field = null;
    record();
  }
  async function restoreState(value: T) {
    applying++;
    try {
      return await restore(copy(value));
    } finally {
      applying--;
      current = copy(read());
    }
  }
  let travelQueue: Promise<void> | undefined;
  function travel(back: boolean) {
    const next = travelQueue
      ? travelQueue.then(
          () => travelOnce(back),
          () => travelOnce(back),
        )
      : travelOnce(back);
    travelQueue = next;
    void next
      .finally(() => {
        if (travelQueue === next) travelQueue = undefined;
      })
      .catch(() => {});
    return next;
  }
  async function travelOnce(back: boolean) {
    if (disposed || applying) return;
    beforeTravel();
    end();
    const from = back ? past : future,
      to = back ? future : past;
    if (!from.length) return;
    const previous = current,
      target = from.at(-1)!;
    const focused = document.activeElement,
      keepFocus = root.contains(focused);
    await restoreState(target);
    to.push(previous);
    from.pop();
    changed();
    if (keepFocus && focused && !focused.isConnected)
      root.querySelector<HTMLElement>('[data-handle]')?.focus({ preventScroll: true });
  }
  function editable(target: EventTarget | null) {
    return (
      target instanceof Element &&
      target.closest(
        'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="range"]):not([type="number"]):not([type="checkbox"]):not([type="radio"])',
      )
    );
  }
  root.addEventListener(
    'keydown',
    (event) => {
      if (
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        editable(event.target)
      )
        return;
      const z = event.code === 'KeyZ' || event.key.toLowerCase() === 'z';
      const y = event.code === 'KeyY' || event.key.toLowerCase() === 'y';
      if (!z && !y) return;
      event.preventDefault();
      event.stopPropagation();
      void travel(z && !event.shiftKey).catch(onError);
    },
    { ...listen, capture: true },
  );
  // Range drags and held arrow keys are each one undo step.
  gestureRoot.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target as Element).matches('input[type="range"]')) return;
      end();
      begin();
      field = event.target as HTMLElement;
    },
    { ...listen, capture: true },
  );
  document.addEventListener(
    'pointerup',
    () => {
      if ((field as HTMLInputElement | null)?.type === 'range') end();
    },
    listen,
  );
  document.addEventListener(
    'pointercancel',
    () => {
      if ((field as HTMLInputElement | null)?.type === 'range') end();
    },
    listen,
  );
  gestureRoot.addEventListener(
    'keydown',
    (event) => {
      if (
        !(event.target as Element).matches('input[type="range"]') ||
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'PageUp',
          'PageDown',
        ].includes(event.key)
      )
        return;
      if (!field) {
        begin();
        field = event.target as HTMLElement;
      }
    },
    { ...listen, capture: true },
  );
  gestureRoot.addEventListener(
    'keyup',
    (event) => {
      if (event.target === field && (field as HTMLInputElement | null)?.type === 'range') end();
    },
    listen,
  );
  // Native text undo stays local; numeric edits belong to scene history.
  gestureRoot.addEventListener(
    'focusin',
    (event) => {
      if (editable(event.target) || (event.target as Element).matches('input[type="number"]')) {
        end();
        begin();
        field = event.target as HTMLElement;
      }
    },
    listen,
  );
  gestureRoot.addEventListener(
    'focusout',
    (event) => {
      if (event.target === field) end();
    },
    listen,
  );
  window.addEventListener(
    'blur',
    () => {
      beforeTravel();
      end();
    },
    listen,
  );
  return {
    get state() {
      return { undo: past.length > 0, redo: future.length > 0 };
    },
    restore: restoreState,
    change(work: () => void) {
      if (!pending && !applying) current = copy(read());
      work();
      record();
    },
    clear() {
      if (applying) return;
      past.length = 0;
      future.length = 0;
      pending = false;
      field = null;
      current = copy(read());
      changed();
    },
    record,
    begin,
    end,
    undo: () => travel(true),
    redo: () => travel(false),
    dispose() {
      disposed = true;
      abort.abort();
    },
  };
}
export const SceneHistory = { mount };
