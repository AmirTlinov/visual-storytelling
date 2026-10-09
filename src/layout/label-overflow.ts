import type { LabelBox } from './labels.js';

export interface OverflowLabel {
  id: string;
  label: string;
  subject?: string;
}

let serial = 0;

/** Explicit access to labels that cannot fit; placement remains with the surface's solver. */
export function labelOverflow(host: HTMLElement) {
  const lifetime = new AbortController(),
    listen = { signal: lifetime.signal },
    id = `ve-label-overflow-${++serial}`;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 've-label-overflow';
  element.hidden = true;
  element.textContent = 'Ещё подписи';
  element.setAttribute('popovertarget', id);
  element.setAttribute('aria-controls', id);
  element.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.id = id;
  panel.className = 've-label-overflow-list';
  panel.style.pointerEvents = 'auto';
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Подписи, для которых недостаточно места в рисунке');
  panel.tabIndex = 0;
  const list = document.createElement('ul');
  panel.append(list);
  host.append(element, panel);
  const rows = new Map<string, HTMLLIElement>();
  let area: LabelBox = { x: 0, y: 0, width: 0, height: 0 },
    returnFocus = false;
  const open = () => panel.matches(':popover-open');
  function place() {
    if (!open()) return;
    const stage = host.getBoundingClientRect(),
      scaleX = stage.width / host.clientWidth || 1,
      scaleY = stage.height / host.clientHeight || 1;
    panel.style.transformOrigin = '0 0';
    panel.style.transform = `scale(${scaleX},${scaleY})`;
    panel.style.width = `${Math.min(380, area.width)}px`;
    panel.style.maxHeight = `${Math.max(1, area.height - 44)}px`;
    const width = panel.offsetWidth,
      height = panel.offsetHeight;
    panel.style.left = `${stage.left + (area.x + area.width - width) * scaleX}px`;
    panel.style.top = `${stage.top + (area.y + area.height - height - 44) * scaleY}px`;
  }
  panel.addEventListener(
    'beforetoggle',
    (event) => {
      if (event.newState === 'closed') returnFocus = panel.contains(document.activeElement);
    },
    listen,
  );
  panel.addEventListener(
    'toggle',
    () => {
      element.setAttribute('aria-expanded', String(open()));
      if (open()) {
        place();
        panel.focus({ preventScroll: true });
      } else if (
        returnFocus &&
        (document.activeElement === document.body || panel.contains(document.activeElement))
      ) {
        const target = element.hidden
          ? host.querySelector<HTMLElement>('canvas[tabindex],svg[tabindex],button:not([hidden])')
          : element;
        target?.focus({ preventScroll: true });
      }
    },
    listen,
  );
  window.addEventListener('resize', place, listen);
  window.addEventListener('scroll', place, { ...listen, capture: true });
  return {
    element,
    preferred(bounds: LabelBox): LabelBox {
      area = bounds;
      const width = Math.min(190, bounds.width),
        height = Math.min(44, bounds.height);
      return {
        x: bounds.x + bounds.width - width,
        y: bounds.y + bounds.height - height,
        width,
        height,
      };
    },
    update(items: readonly OverflowLabel[], bounds: LabelBox) {
      const ids = new Set(items.map((item) => item.id));
      for (const [key, row] of rows)
        if (!ids.has(key)) {
          row.remove();
          rows.delete(key);
        }
      let previous: ChildNode | null = null;
      for (const item of items) {
        let row = rows.get(item.id);
        if (!row) {
          row = document.createElement('li');
          row.dataset.label = item.id;
          rows.set(item.id, row);
        }
        const text =
          item.subject && item.subject !== item.label
            ? `${item.subject}: ${item.label}`
            : item.label;
        if (row.textContent !== text) row.textContent = text;
        const next: ChildNode | null = previous ? previous.nextSibling : list.firstChild;
        if (row !== next) list.insertBefore(row, next);
        previous = row;
      }
      const focused = panel.contains(document.activeElement) || document.activeElement === element;
      if (!items.length && open()) panel.hidePopover();
      element.hidden = !items.length;
      if (!items.length && focused)
        host
          .querySelector<HTMLElement>('canvas[tabindex],svg[tabindex],button:not([hidden])')
          ?.focus({ preventScroll: true });
      element.textContent = `Ещё подписи · ${items.length}`;
      element.setAttribute('aria-label', `Показать неуместившиеся подписи: ${items.length}`);
      element.style.left = `${bounds.x}px`;
      element.style.top = `${bounds.y}px`;
      element.style.width = `${bounds.width}px`;
      element.style.height = `${bounds.height}px`;
      if (open()) place();
    },
    dispose() {
      lifetime.abort();
      element.remove();
      panel.remove();
    },
  };
}
