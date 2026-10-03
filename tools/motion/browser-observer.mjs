/** Installs only observations; the application retains its clock and rendering. */
export function observeBrowser({ targets }) {
  const started = performance.now(),
    epoch = performance.timeOrigin;
  const data = {
    epoch,
    started,
    raf: [],
    elements: [],
    events: [],
    longFrames: [],
    layoutShifts: [],
    capabilities: [],
  };
  const observers = [],
    listeners = [];
  let active = true,
    raf;
  const name = (node) => (node?.id ? `#${node.id}` : (node?.tagName?.toLowerCase() ?? null));
  for (const type of ['event', 'long-animation-frame', 'layout-shift']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    data.capabilities.push(type);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < started) continue;
        if (type === 'event')
          data.events.push({
            type: entry.name,
            start: entry.startTime,
            duration: entry.duration,
            processingStart: entry.processingStart,
            processingEnd: entry.processingEnd,
            interactionId: entry.interactionId,
            target: name(entry.target),
          });
        if (type === 'long-animation-frame')
          data.longFrames.push({
            start: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            renderStart: entry.renderStart,
            styleAndLayoutStart: entry.styleAndLayoutStart,
            scripts: (entry.scripts ?? []).map((script) => ({
              duration: script.duration,
              sourceURL: script.sourceURL,
              sourceFunctionName: script.sourceFunctionName,
              sourceCharPosition: script.sourceCharPosition,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          });
        if (type === 'layout-shift')
          data.layoutShifts.push({
            start: entry.startTime,
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            sources: (entry.sources ?? []).map((source) => ({
              node: name(source.node),
              previous: source.previousRect.toJSON(),
              current: source.currentRect.toJSON(),
            })),
          });
      }
    });
    observer.observe({
      type,
      buffered: false,
      ...(type === 'event' ? { durationThreshold: 16 } : {}),
    });
    observers.push(observer);
  }
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'click', 'focusin']) {
    const listener = (event) =>
      data.events.push({
        type,
        start: event.timeStamp,
        observed: performance.now(),
        target: name(event.target),
        trusted: event.isTrusted,
      });
    document.addEventListener(type, listener, { capture: true, passive: true });
    listeners.push([type, listener]);
  }
  function elements(t) {
    for (const selector of targets) {
      const node = document.querySelector(selector);
      if (!node) {
        data.elements.push({ selector, time: t, missing: true });
        continue;
      }
      const box = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      data.elements.push({
        selector,
        time: t,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        opacity: Number(style.opacity),
        visible: style.visibility !== 'hidden' && style.display !== 'none',
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        focus: node === document.activeElement,
        scrollX,
        scrollY,
      });
    }
  }
  function tick() {
    if (!active) return;
    // Callback execution can lag behind the rAF frame timestamp under main-thread load.
    const observed = performance.now();
    data.raf.push(observed);
    elements(observed);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return {
    stop() {
      if (active) elements(performance.now());
      active = false;
      cancelAnimationFrame(raf);
      for (const observer of observers) observer.disconnect();
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
      data.ended = performance.now();
      return data;
    },
  };
}
