import { svgInteractionContour } from './controls/svg-contour.js';
import { containingSource, sourceAt, sourceOf, type SourceSpan } from './scene-source.js';

export interface ObjectMeaning {
  label: string;
  /** Inspect and select programmatically without making the drawing a user control. */
  interactive?: boolean;
  value?: () => unknown;
  unit?: string;
  source?: SourceSpan;
  implementation?: { file: string };
  inputs?: () => readonly string[];
  provenance?: () => unknown;
}
const attributes = ['aria-label', 'role', 'tabindex', 'aria-pressed'] as const;
type ObjectAttribute = (typeof attributes)[number];
const meanings = new WeakMap<
  Element,
  { meaning: ObjectMeaning; original: Record<ObjectAttribute, string | null> }
>();
const hits = new WeakMap<Event, Element>();
const attribute = (element: Element, name: string, value: string | null) => {
  if (value === null) element.removeAttribute(name);
  else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};
const interactive = (element: Element) => meanings.get(element)?.meaning.interactive !== false;

/** A renderer's geometry hit keeps its semantic target while the pointer event still bubbles. */
export function sceneObjectHit(event: Event, element: Element) {
  if (meanings.has(element)) hits.set(event, element);
}

/** Meaning belongs to the rendered object. Geometry and labels keep its existing stable ID. */
export function describeObject(element: Element, meaning: ObjectMeaning) {
  if (!element.getAttribute('data-object')?.trim() || !meaning.label.trim())
    throw new Error('A scene object needs a stable ID and a meaningful label');
  const original =
    meanings.get(element)?.original ??
    (Object.fromEntries(attributes.map((name) => [name, element.getAttribute(name)])) as Record<
      ObjectAttribute,
      string | null
    >);
  const registration = { meaning, original };
  meanings.set(element, registration);
  sourceAt(element, sourceOf(meaning) ?? containingSource(element.parentElement));
  element.setAttribute('aria-label', meaning.label);
  attribute(element, 'role', meaning.interactive === false ? original.role : 'button');
  attribute(element, 'tabindex', meaning.interactive === false ? original.tabindex : '0');
  if (meaning.interactive === false) attribute(element, 'aria-pressed', original['aria-pressed']);
  return () => {
    if (meanings.get(element) !== registration) return;
    meanings.delete(element);
    sourceAt(element, undefined);
    for (const name of attributes) attribute(element, name, original[name]);
    element.removeAttribute('data-selected');
    element.removeAttribute('data-selection-highlight');
  };
}

export function sceneObjects(root: Element) {
  const abort = new AbortController();
  const controls =
    'button, input, select, textarea, label, summary, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [tabindex]:not(canvas, svg, [role="img"])';
  let selected: string[] = [];
  const highlighted = new Set<HTMLElement | SVGElement>();
  const contours = new Map<SVGGraphicsElement, ReturnType<typeof svgInteractionContour>>();
  const resizeObserver = new ResizeObserver(() => {
    if (!abort.signal.aborted) refreshSelection();
  });
  const nodes = () => {
    if (abort.signal.aborted) throw new Error('Scene objects have been disposed.');
    return [...root.querySelectorAll<HTMLElement | SVGElement>('[data-object]')].filter((node) =>
      meanings.has(node),
    );
  };
  const objects = () => {
    const representations = new Map<string, (HTMLElement | SVGElement)[]>();
    for (const node of nodes()) {
      const id = node.dataset.object!;
      if (!representations.has(id)) representations.set(id, []);
      representations.get(id)!.push(node);
    }
    return [...representations].map(([id, elements]) => {
      const node = elements[0]!;
      const meaning = meanings.get(node)!.meaning;
      return {
        id,
        label: meaning.label,
        value: meaning.value?.(),
        unit: meaning.unit,
        source: meaning.source ?? sourceOf(node),
        implementation: meaning.implementation,
        inputs: meaning.inputs?.(),
        provenance: meaning.provenance?.(),
        visible: elements.some((node) => !node.closest('[aria-hidden="true"]') && isRendered(node)),
      };
    });
  };
  const refreshSelection = (elements = nodes()) => {
    const representatives = new Map<string, HTMLElement | SVGElement>();
    const priority = (node: Element) =>
      node.classList.contains('ve-viewport-object')
        ? 2
        : node.getAttribute('tabindex') === '0'
          ? 1
          : 0;
    for (const node of elements) {
      const active = selected.includes(node.dataset.object!);
      node.toggleAttribute('data-selected', active);
      if (interactive(node) && node.matches('button, [role="button"]'))
        attribute(node, 'aria-pressed', String(active));
      if (!active || node.closest('[aria-hidden="true"]') || !isRendered(node)) continue;
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const previous = representatives.get(node.dataset.object!);
      if (!previous || priority(node) > priority(previous))
        representatives.set(node.dataset.object!, node);
    }
    const next = new Set(representatives.values());
    for (const node of highlighted)
      if (!next.has(node)) node.removeAttribute('data-selection-highlight');
    highlighted.clear();
    for (const node of next) {
      node.toggleAttribute('data-selection-highlight', true);
      highlighted.add(node);
    }
    const activeContours = new Set<SVGGraphicsElement>();
    for (const node of elements) {
      if (
        !(node instanceof SVGGraphicsElement) ||
        node.getAttribute('aria-disabled') === 'true' ||
        (!highlighted.has(node) && !node.matches(':focus-visible')) ||
        !isRendered(node)
      )
        continue;
      activeContours.add(node);
      let contour = contours.get(node);
      if (!contour) {
        contour = svgInteractionContour(node, `subject:${node.dataset.object}`);
        contours.set(node, contour);
        resizeObserver.observe(node);
      }
      contour.selected(highlighted.has(node));
      contour.update();
    }
    for (const [node, contour] of contours) {
      if (activeContours.has(node)) continue;
      resizeObserver.unobserve(node);
      contour.dispose();
      contours.delete(node);
    }
  };
  const observer = new MutationObserver((records) => {
    if (
      records.every((record) => (record.target as Element).closest?.('[data-interaction-contour]'))
    )
      return;
    if ((selected.length || contours.size) && !abort.signal.aborted) refreshSelection();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'data-object',
      'hidden',
      'style',
      'class',
      'aria-hidden',
      'aria-disabled',
      'tabindex',
      'transform',
      'd',
      'points',
      'x',
      'y',
      'width',
      'height',
      'r',
      'cx',
      'cy',
      'color',
      'opacity',
      'viewBox',
    ],
  });
  for (const type of ['focusin', 'focusout'] as const)
    root.addEventListener(type, () => refreshSelection(), { signal: abort.signal });
  const select = (ids: readonly string[]) => {
    const elements = nodes(),
      known = new Set(elements.map((node) => node.dataset.object!));
    if (ids.some((id) => !known.has(id)))
      throw new Error('Unknown scene object. Inspect available objects.');
    selected = [...new Set(ids)];
    refreshSelection(elements);
    root.dispatchEvent(new CustomEvent('scene-selection', { bubbles: true }));
  };
  const target = (event: Event) => {
    // An embedded control owns its activation, even inside a described object.
    const node =
      hits.get(event) ?? (event.target as Element)?.closest?.(`[data-object], ${controls}`);
    return node && root.contains(node) && meanings.has(node)
      ? (node as HTMLElement | SVGElement)
      : null;
  };
  const activate = (node: HTMLElement | SVGElement) => {
    if (!interactive(node)) return;
    const id = node.dataset.object!;
    select(selected.length === 1 && selected[0] === id ? [] : [id]);
  };
  let down: { x: number; y: number; pointer: number } | undefined;
  root.addEventListener(
    'pointerdown',
    (event) => {
      const e = event as PointerEvent;
      down =
        !e.defaultPrevented && e.button === 0 && e.isPrimary
          ? { x: e.clientX, y: e.clientY, pointer: e.pointerId }
          : undefined;
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointerup',
    (event) => {
      const e = event as PointerEvent,
        node = target(e);
      // A renderer consumes a geometry hit before this bubbling event arrives.
      if (
        !e.defaultPrevented &&
        down?.pointer === e.pointerId &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      ) {
        if (node) activate(node);
        else if (!(e.target as Element)?.closest?.(controls)) select([]);
      }
      down = undefined;
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointercancel',
    () => {
      down = undefined;
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const node = target(event);
      // Native keyboard activation and a renderer's hit-test enter the same owner.
      if (!event.defaultPrevented && node && (event as MouseEvent).detail === 0) activate(node);
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const e = event as KeyboardEvent,
        node = target(e);
      if (node instanceof SVGGraphicsElement) refreshSelection();
      if (e.defaultPrevented) return;
      if (node && interactive(node) && !node.matches('button') && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        activate(node);
      } else if (e.key === 'Escape' && selected.length) select([]);
    },
    { signal: abort.signal },
  );
  return {
    objects,
    select,
    get selected() {
      const known = new Set(nodes().map((node) => node.dataset.object!));
      return selected.filter((id) => known.has(id));
    },
    dispose() {
      if (abort.signal.aborted) return;
      observer.disconnect();
      resizeObserver.disconnect();
      for (const contour of contours.values()) contour.dispose();
      contours.clear();
      for (const node of highlighted) node.removeAttribute('data-selection-highlight');
      highlighted.clear();
      for (const node of nodes()) {
        node.removeAttribute('data-selected');
        if (interactive(node) && node.matches('button, [role="button"]'))
          node.setAttribute('aria-pressed', 'false');
      }
      selected = [];
      down = undefined;
      abort.abort();
    },
  };
}
import { isRendered } from './scene-frame.js';
