export class SvgHighlight {
  private abort = new AbortController();
  world: SVGGElement;
  layer: SVGGElement;
  art: SVGGElement;
  hits: HTMLElement;
  key: string | null;
  hovered: HTMLElement | null;
  constructor(svg: SVGSVGElement, hits: HTMLElement) {
    this.world = svg.querySelector<SVGGElement>('[data-camera-world]')!;
    this.layer = svg.querySelector<SVGGElement>('[data-contour]')!;
    this.art = svg.querySelector<SVGGElement>('[data-contour-world]')!;
    this.hits = hits;
    this.key = null;
    this.hovered = null;
    hits.addEventListener(
      'pointerover',
      (event) => {
        if (event.pointerType === 'touch') return;
        this.hovered = (event.target as Element).closest<HTMLElement>('[data-hit-key]');
        this.refresh();
      },
      { signal: this.abort.signal },
    );
    hits.addEventListener(
      'pointerleave',
      () => {
        this.hovered = null;
        this.refresh();
      },
      { signal: this.abort.signal },
    );
    hits.addEventListener('focusin', () => this.refresh(), { signal: this.abort.signal });
    hits.addEventListener(
      'focusout',
      () =>
        queueMicrotask(() => {
          if (!this.abort.signal.aborted) this.refresh();
        }),
      { signal: this.abort.signal },
    );
  }
  clear() {
    this.key = null;
    this.hovered = null;
    this.layer.setAttribute('visibility', 'hidden');
    this.art.replaceChildren();
  }
  refresh() {
    if (this.hits.hidden) return this.clear();
    const button = this.hovered?.isConnected
      ? this.hovered
      : this.hits.querySelector<HTMLElement>(':focus-visible');
    this.show(button?.dataset.hitKey);
  }
  show(key?: string) {
    if (!key) return this.clear();
    if (key === this.key) return;
    const source = this.world.querySelector(`[data-part="${CSS.escape(key)}"]`);
    if (!source) return this.clear();
    let silhouette = source.cloneNode(true) as SVGElement;
    silhouette.querySelectorAll('text').forEach((label) => label.remove());
    // Preserve the component's own placement, excluding the camera transform.
    for (
      let parent: Element | null = source.parentElement;
      parent && parent !== this.world;
      parent = parent.parentElement
    ) {
      const transform = parent.getAttribute('transform');
      if (!transform) continue;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('transform', transform);
      group.append(silhouette);
      silhouette = group;
    }
    silhouette.querySelectorAll('[data-part]').forEach((part) => part.removeAttribute('data-part'));
    silhouette.removeAttribute('data-part');
    this.art.replaceChildren(silhouette);
    this.layer.setAttribute('visibility', 'visible');
    this.key = key;
  }
  dispose() {
    this.abort.abort();
    this.clear();
  }
}
