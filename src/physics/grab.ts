/** One pointer owner shared by SVG and Three; capture and cancellation survive fast gestures. */
export function pointerGrab<T>(
  element: Element,
  pick: (event: PointerEvent) => T | undefined,
  start: (
    target: T,
    event: PointerEvent,
  ) => { move(event: PointerEvent): void; release(): void } | undefined,
) {
  const abort = new AbortController();
  let active: ReturnType<typeof start>, pointer: number | undefined;
  function release() {
    active?.release();
    active = undefined;
    if (pointer !== undefined && element.hasPointerCapture(pointer))
      element.releasePointerCapture(pointer);
    pointer = undefined;
  }
  element.addEventListener(
    'pointerdown',
    ((event: PointerEvent) => {
      if (event.button !== 0) return;
      release();
      const target = pick(event);
      if (target === undefined) return;
      active = start(target, event);
      if (!active) return;
      pointer = event.pointerId;
      element.setPointerCapture(pointer);
      event.preventDefault();
      event.stopImmediatePropagation();
    }) as EventListener,
    { capture: true, signal: abort.signal },
  );
  element.addEventListener(
    'pointermove',
    ((event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      active?.move(event);
      event.preventDefault();
      event.stopImmediatePropagation();
    }) as EventListener,
    { capture: true, signal: abort.signal },
  );
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    element.addEventListener(
      name,
      ((event: PointerEvent) => {
        if (event.pointerId === pointer) release();
      }) as EventListener,
      { capture: true, signal: abort.signal },
    );
  return {
    release,
    dispose() {
      release();
      abort.abort();
    },
  };
}
