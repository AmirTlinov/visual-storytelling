const viewports = new WeakMap<
  HTMLElement,
  {
    clients: Map<symbol, number>;
    layout: string | null;
    height: string;
    priority: string;
    inlineHeight: string;
    inlinePriority: string;
  }
>();

/** A shared host fits every active composition; its last client restores the original CSS. */
export function contentViewport(host: HTMLElement) {
  const client = Symbol();
  let disposed = false;
  function resize(height?: number) {
    if (disposed) return;
    let state = viewports.get(host);
    if (height === undefined) {
      if (!state?.clients.delete(client)) return;
    } else {
      if (!state) {
        state = {
          clients: new Map(),
          layout: host.getAttribute('data-content-layout'),
          height: host.style.getPropertyValue('--ve-content-height'),
          priority: host.style.getPropertyPriority('--ve-content-height'),
          inlineHeight: host.style.getPropertyValue('height'),
          inlinePriority: host.style.getPropertyPriority('height'),
        };
        viewports.set(host, state);
      }
      if (state.clients.get(client) === height) return;
      state.clients.set(client, height);
    }
    if (state.clients.size) {
      host.setAttribute('data-content-layout', 'fit');
      host.style.setProperty('--ve-content-height', `${Math.max(...state.clients.values())}px`);
      host.style.setProperty('height', 'var(--ve-content-height)');
    } else {
      if (state.layout === null) host.removeAttribute('data-content-layout');
      else host.setAttribute('data-content-layout', state.layout);
      if (state.height) host.style.setProperty('--ve-content-height', state.height, state.priority);
      else host.style.removeProperty('--ve-content-height');
      if (state.inlineHeight)
        host.style.setProperty('height', state.inlineHeight, state.inlinePriority);
      else host.style.removeProperty('height');
      viewports.delete(host);
    }
  }
  return {
    resize,
    dispose() {
      resize();
      disposed = true;
    },
  };
}
