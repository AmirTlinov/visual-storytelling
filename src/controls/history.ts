/* One scene history: live changes are grouped by the gesture that produced them. */

function mount<T>(
  root: HTMLElement,
  {
    read,
    restore,
    beforeTravel = () => {},
  }: { read: () => T; restore: (value: T) => void; beforeTravel?: () => void },
) {
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const past: T[] = [],
    future: T[] = [],
    copy = (value: T) => structuredClone(value);
  let current = copy(read()),
    pending = false;
  let field: HTMLElement | null = null;
  function record() {
    if (pending) return;
    const next = copy(read());
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    past.push(current);
    if (past.length > 100) past.shift();
    current = next;
    future.length = 0;
  }
  function begin() {
    pending = true;
  }
  function end() {
    pending = false;
    field = null;
    record();
  }
  function travel(back: boolean) {
    beforeTravel();
    end();
    const from = back ? past : future,
      to = back ? future : past;
    if (!from.length) return;
    to.push(current);
    current = from.pop()!;
    const focused = document.activeElement,
      keepFocus = root.contains(focused);
    restore(copy(current));
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
      travel(z && !event.shiftKey);
    },
    { ...listen, capture: true },
  );
  // Range drags and held arrow keys are each one undo step.
  root.addEventListener(
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
  root.addEventListener(
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
  root.addEventListener(
    'keyup',
    (event) => {
      if (event.target === field && (field as HTMLInputElement | null)?.type === 'range') end();
    },
    listen,
  );
  // Native text undo stays local; numeric edits belong to scene history.
  root.addEventListener(
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
  root.addEventListener(
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
    record,
    begin,
    end,
    undo: () => travel(true),
    redo: () => travel(false),
    dispose() {
      abort.abort();
    },
  };
}
export const SceneHistory = { mount };
