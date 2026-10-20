// Codex owns the available width and the fullscreen viewport. The inline card
// requests only its content height, without changing the layout to measure it.
export function cardSizing(app) {
  let active = false,
    mode = 'inline',
    pending = 0,
    lastHeight;
  const schedule = () => {
    if (!active || mode === 'fullscreen' || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!active || mode === 'fullscreen' || innerWidth <= 0) return;
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height <= 0 || height === lastHeight) return;
      lastHeight = height;
      void app.sendSizeChanged({ height }).catch(() => {
        // The host can close its transport before the document is torn down.
      });
    });
  };
  const observer = new ResizeObserver(schedule);
  return {
    start() {
      active = true;
      observer.observe(document.body);
      schedule();
    },
    displayMode(value) {
      if (value === mode) return;
      mode = value;
      lastHeight = undefined;
      schedule();
    },
    dispose() {
      active = false;
      observer.disconnect();
      cancelAnimationFrame(pending);
      pending = 0;
    },
  };
}
