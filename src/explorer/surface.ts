/** Accessible targets stay in HTML; the SVG supplies their actual contour and camera geometry. */
function mount(host: HTMLElement, { label, description }: { label: string; description: string }) {
  host.classList.add('ve-explorer');
  const id = `contour-${crypto.randomUUID()}`;
  host.innerHTML = `<div class="explorer-navigation" hidden>
    <button type="button" class="explorer-back" aria-label="На уровень выше"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></button>
    <nav class="explorer-path" aria-label="Путь внутри объекта"></nav>
  </div><div class="explorer-viewport" aria-label="Интерактивная схема">
    <svg class="explorer-canvas vs-canvas" role="img"><title></title><desc></desc><defs>
      <filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="expanded"/>
        <feComposite in="expanded" in2="SourceAlpha" operator="out" result="edge"/>
        <feFlood class="contour-color"/><feComposite in2="edge" operator="in"/>
      </filter></defs>
      <g data-camera-world data-camera-transform></g>
      <g data-contour class="explorer-contour" filter="url(#${id})" aria-hidden="true" visibility="hidden"><g data-contour-world data-camera-transform></g></g>
    </svg><div class="explorer-hits"></div>
    <button type="button" class="explorer-reset" data-camera-reset aria-label="Показать целиком" aria-keyshortcuts="0" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/></svg></button>
  </div>`;
  const svg = host.querySelector<SVGSVGElement>('.explorer-canvas')!;
  svg.setAttribute('aria-label', label);
  svg.querySelector('title')!.textContent = label;
  svg.querySelector('desc')!.textContent = description;
  return {
    svg,
    viewport: host.querySelector<HTMLElement>('.explorer-viewport')!,
    hits: host.querySelector<HTMLElement>('.explorer-hits')!,
    navigation: host.querySelector<HTMLElement>('.explorer-navigation')!,
    breadcrumbs: host.querySelector<HTMLElement>('.explorer-path')!,
    back: host.querySelector<HTMLButtonElement>('.explorer-back')!,
    reset: host.querySelector<HTMLButtonElement>('.explorer-reset')!,
    dispose() {
      host.replaceChildren();
      host.classList.remove('ve-explorer');
    },
  };
}
export const ExplorerSurface = { mount };
