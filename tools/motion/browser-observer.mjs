/** Installs only observations; the application retains its clock and rendering. */
export function observeBrowser({ targets, drainBinding }) {
  const started = performance.now(),
    epoch = performance.timeOrigin;
  const data = {
    epoch,
    started,
    raf: [],
    scene: [],
    elements: [],
    events: [],
    longFrames: [],
    layoutShifts: [],
    capabilities: [],
  };
  const tracked = new Map(targets.map((selector) => [selector, null]));
  const identities = new WeakMap();
  let identity = 0;
  const remember = (node) => {
    if (!(node instanceof Element) || tracked.size >= targets.length + 12) return;
    let id = node.id ? '#' + CSS.escape(node.id) : identities.get(node);
    if (!id) {
      id = '@node:' + identity++;
      identities.set(node, id);
    }
    tracked.set(id, node);
  };
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      const node = record.target instanceof Element ? record.target : record.target.parentElement;
      if (node && !['SCRIPT', 'STYLE', 'HTML', 'BODY'].includes(node.tagName)) {
        remember(node);
        for (const child of [...node.children].slice(0, 4)) remember(child);
      }
      if (node?.closest('[role="dialog"],[role="menu"],[aria-live]'))
        remember(node.closest('[role="dialog"],[role="menu"],[aria-live]'));
      for (const added of record.addedNodes)
        if (
          added instanceof Element &&
          added.matches('[role="dialog"],[role="menu"],[aria-live],dialog')
        )
          remember(added);
    }
  });
  mutations.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'aria-expanded', 'open', 'class', 'style'],
  });
  const lastElements = new Map();
  let lastScene = -Infinity;
  const observers = [],
    listeners = [];
  let active = true,
    raf;
  const name = (node) =>
    node?.id
      ? '#' + CSS.escape(node.id)
      : (identities.get(node) ?? node?.tagName?.toLowerCase() ?? null);
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
  for (const type of [
    'pointerdown',
    'pointerup',
    'keydown',
    'click',
    'focusin',
    'input',
    'wheel',
  ]) {
    const listener = (event) => {
      remember(event.target);
      data.events.push({
        type,
        start: event.timeStamp,
        observed: performance.now(),
        target: name(event.target),
        trusted: event.isTrusted,
        x: event.clientX,
        y: event.clientY,
        key: event.target?.closest?.('input[type=password],[data-private]') ? undefined : event.key,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      // Input may destroy this document before the next polling round.
      if (drainBinding && event.isTrusted && typeof window[drainBinding] === 'function')
        window[drainBinding](JSON.stringify(drain()));
    };
    document.addEventListener(type, listener, { capture: true, passive: true });
    listeners.push([type, listener]);
  }
  function elements(t) {
    for (const [selector, trackedNode] of tracked) {
      const node = trackedNode?.isConnected
        ? trackedNode
        : selector.startsWith('@')
          ? null
          : document.querySelector(selector);
      if (!node) {
        if (lastElements.get(selector) !== 'missing')
          data.elements.push({ selector, time: t, missing: true });
        lastElements.set(selector, 'missing');
        continue;
      }
      const box = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      // Common accessible-only styles deliberately paint no pixels. Keep their
      // observations, but do not report their 1px box as accidentally clipped text.
      const clippedAway =
        style.clipPath === 'inset(50%)' ||
        (['absolute', 'fixed'].includes(style.position) &&
          /^rect\(0px[, ]+0px[, ]+0px[, ]+0px\)$/.test(style.clip));
      const observation = {
        selector,
        text: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 160),
        textSource: node.hasAttribute('aria-label') ? 'accessible-name' : 'dom-text-content',
        owner: node.getAttribute('data-review-owner') ?? undefined,
        coordinates: 'css-viewport',
        viewport: { width: innerWidth, height: innerHeight },
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        opacity: Number(style.opacity),
        visible:
          !clippedAway && node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        focus: node === document.activeElement,
        scrollX,
        scrollY,
      };
      const signature = JSON.stringify(observation);
      if (lastElements.get(selector) !== signature) data.elements.push({ ...observation, time: t });
      lastElements.set(selector, signature);
    }
  }
  function tick() {
    if (!active) return;
    // Callback execution can lag behind the rAF frame timestamp under main-thread load.
    const observed = performance.now();
    data.raf.push(observed);
    elements(observed);
    const scene = document.querySelector('.ve-scene')?.scene;
    if (scene && observed - lastScene >= 100) {
      lastScene = observed;
      try {
        const before = performance.now();
        const objects = [...document.querySelectorAll('canvas')]
          .flatMap((c) => c.__visualReview?.()?.objects ?? [])
          .map((o) => ({
            ...o,
            coordinates: 'css-viewport',
            viewport: { width: innerWidth, height: innerHeight },
          }));
        data.scene.push({
          time: observed,
          mediaTime: scene.currentTime,
          state: scene.snapshot?.(),
          cueReads: scene.review?.().observed,
          presentation: scene.presentation?.(),
          objects,
          inspectionMs: performance.now() - before,
        });
      } catch {
        /* Scene diagnostics are optional; pixels continue. */
      }
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  function drain() {
    const chunk = { epoch, started, document: location.href, capabilities: data.capabilities };
    for (const key of ['raf', 'elements', 'events', 'longFrames', 'layoutShifts', 'scene'])
      chunk[key] = data[key].splice(0);
    return chunk;
  }
  function stop() {
    if (active) elements(performance.now());
    active = false;
    cancelAnimationFrame(raf);
    mutations.disconnect();
    window.removeEventListener('pagehide', pagehide);
    for (const observer of observers) observer.disconnect();
    for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    return { ...drain(), ended: performance.now() };
  }
  const pagehide = () => {
    const chunk = stop();
    if (drainBinding && typeof window[drainBinding] === 'function') {
      window[drainBinding](JSON.stringify(chunk));
      delete window[drainBinding];
    }
  };
  window.addEventListener('pagehide', pagehide);
  return { drain, stop };
}
