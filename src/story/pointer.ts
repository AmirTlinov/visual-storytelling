import type { Frame } from './cues.js';
import type { StoryAction } from './actions.js';

type Point = { x: number; y: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);
const field = (target: Element): target is HTMLInputElement | HTMLTextAreaElement =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Visual input only: the story owns time; layout is measured after the subject's render. */
export function createStoryPointer<K extends string>(
  steps: readonly StoryAction<K>[],
  container: HTMLElement,
) {
  const actions = steps.filter((step) => step.type !== 'reveal');
  const scroll = new Map(
    actions
      .filter((step) => step.type === 'type' && field(step.target))
      .map(
        ({ target }) =>
          [
            target as HTMLInputElement | HTMLTextAreaElement,
            { left: target.scrollLeft, top: target.scrollTop },
          ] as const,
      ),
  );
  const document = container.ownerDocument;
  const layer = document.createElement('div');
  layer.className = 've-story-pointer-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<div class="ve-story-pointer" hidden><svg viewBox="0 0 26 34" aria-hidden="true"><path d="M2 2v25l6.4-6.2 5.2 11 4.4-2.1-5.2-10.8H22Z"/></svg></div><div class="ve-story-click" hidden></div><div class="ve-story-focus" hidden></div><div class="ve-story-caret" hidden></div><div class="ve-story-text-measure"></div>`;
  const cursor = layer.children[0] as HTMLDivElement,
    ripple = layer.children[1] as HTMLDivElement,
    focus = layer.children[2] as HTMLDivElement,
    caret = layer.children[3] as HTMLDivElement,
    mirror = layer.children[4] as HTMLDivElement,
    marker = document.createElement('span'),
    text = document.createTextNode('');
  marker.textContent = '\u200b';
  mirror.append(text, marker);
  const position = container.style.position,
    positioned = getComputedStyle(container).position === 'static';
  if (positioned) container.style.position = 'relative';
  container.append(layer);
  let disposed = false,
    queued = false,
    pending: Frame<K> | undefined;

  function draw(frame: Frame<K>) {
    cursor.hidden = ripple.hidden = focus.hidden = caret.hidden = true;
    const entries = actions
      .map((step) => ({ step, cue: frame.cue(step.cue) }))
      .sort((a, b) => a.cue.start - b.cue.start);
    for (const [target, original] of scroll) {
      const begun = entries.some(
        ({ step, cue }) =>
          step.type === 'type' && step.target === target && cue.start <= frame.time,
      );
      target.scrollLeft = begun
        ? target.scrollWidth * (getComputedStyle(target).direction === 'rtl' ? -1 : 1)
        : original.left;
      target.scrollTop = begun ? target.scrollHeight : original.top;
    }
    const bounds = layer.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const sx = layer.clientWidth / bounds.width,
      sy = layer.clientHeight / bounds.height;
    const geometry = (target: Element) => {
      const rect = target.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        !target.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        return;
      return {
        x: (rect.left - bounds.left) * sx,
        y: (rect.top - bounds.top) * sy,
        width: rect.width * sx,
        height: rect.height * sy,
      };
    };
    const index = entries.findLastIndex(({ cue }) => cue.start <= frame.time),
      current = entries[index],
      next = entries[index + 1];
    const point = (entry: typeof current): Point | undefined => {
      if (!entry) return;
      const rect = geometry(entry.step.target);
      if (!rect) return;
      return {
        x: rect.x + (entry.step.type === 'type' ? Math.min(28, rect.width / 3) : rect.width / 2),
        y: rect.y + rect.height / 2,
      };
    };
    const lead = next
      ? Math.max(0, next.cue.start - 0.48, Math.min(current?.cue.end ?? 0, next.cue.start))
      : Infinity;
    const destination = next && !frame.reduced && frame.time >= lead ? point(next) : undefined;
    const approaching = !!destination;
    let location = destination ?? point(current);
    if (location) {
      let opacity = 1;
      if (approaching && next) {
        const from = current && next.cue.start - current.cue.end < 1.5 ? point(current) : undefined;
        const origin = from ?? {
          x: Math.max(8, location.x - 68),
          y: Math.min(layer.clientHeight - 36, location.y + 48),
        };
        const amount = clamp((frame.time - lead) / Math.max(0.001, next.cue.start - lead)),
          p = smooth(amount);
        location = {
          x: origin.x + (location.x - origin.x) * p,
          y: origin.y + (location.y - origin.y) * p,
        };
        opacity = from ? 1 : clamp(amount * 4);
      } else if (current) {
        if (current.step.type === 'type')
          opacity = 1 - clamp((frame.time - current.cue.start - 0.18) / 0.2);
        else if (!next || next.cue.start - current.cue.end >= 1.5)
          opacity = 1 - clamp((frame.time - current.cue.end - 0.2) / 0.2);
      }
      const elapsed = current ? frame.time - current.cue.start : Infinity,
        clicking = !approaching && elapsed >= 0 && elapsed < 0.32;
      cursor.hidden = opacity <= 0;
      cursor.style.opacity = String(opacity);
      cursor.style.transform = `translate(${location.x - 2}px, ${location.y - 2}px)`;
      (cursor.firstElementChild as SVGElement).style.transform =
        clicking && elapsed < 0.12 && !frame.reduced ? 'scale(.88)' : '';
      cursor.toggleAttribute('data-down', clicking && elapsed < 0.12);
      if (clicking && !frame.reduced) {
        const p = elapsed / 0.32;
        ripple.hidden = false;
        ripple.style.opacity = String(1 - p);
        ripple.style.transform = `translate(${location.x - 12}px, ${location.y - 12}px) scale(${0.35 + p * 1.2})`;
      }
    }
    if (!current || current.step.type !== 'type' || frame.time > current.cue.end + 0.4) return;
    const target = current.step.target;
    if (!field(target)) return;
    const rect = geometry(target);
    if (!rect) return;
    const style = getComputedStyle(target),
      fontSize = Number.parseFloat(style.fontSize) || 16,
      lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2,
      tx = rect.width / target.offsetWidth,
      ty = rect.height / target.offsetHeight,
      caretHeight = lineHeight * ty;
    focus.hidden = false;
    Object.assign(focus.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${target.offsetWidth}px`,
      height: `${target.offsetHeight}px`,
      transformOrigin: '0 0',
      transform: `scale(${tx}, ${ty})`,
      borderRadius: style.borderRadius,
      opacity: String(1 - clamp((frame.time - current.cue.end) / 0.4)),
    });
    Object.assign(mirror.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${target.clientWidth + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth)}px`,
      height: `${target.offsetHeight}px`,
      overflow: 'hidden',
      transformOrigin: '0 0',
      transform: `scale(${tx}, ${ty})`,
      font: style.font,
      lineHeight: `${lineHeight}px`,
      letterSpacing: style.letterSpacing,
      textAlign: style.textAlign,
      textIndent: style.textIndent,
      textTransform: style.textTransform,
      direction: style.direction,
      padding: style.padding,
      borderWidth: style.borderWidth,
      whiteSpace: target instanceof HTMLInputElement ? 'pre' : 'pre-wrap',
    });
    text.textContent =
      target instanceof HTMLInputElement && target.type === 'password'
        ? '•'.repeat([...target.value].length)
        : target.value;
    const end = marker.getBoundingClientRect(),
      x = (end.left - bounds.left) * sx - target.scrollLeft * tx,
      y =
        target instanceof HTMLInputElement
          ? rect.y + (rect.height - caretHeight) / 2
          : (end.top - bounds.top) * sy - target.scrollTop * ty;
    if (
      x < rect.x ||
      x > rect.x + rect.width - 2 ||
      y < rect.y ||
      y + caretHeight > rect.y + rect.height
    )
      return;
    // This blink is evaluated from media time, so paused/reversed playback has the same caret.
    caret.hidden = !frame.reduced && Math.floor((frame.time - current.cue.start) / 0.55) % 2 === 1;
    Object.assign(caret.style, {
      left: `${x}px`,
      top: `${y}px`,
      height: `${caretHeight}px`,
      color: style.color,
    });
  }
  return {
    render(frame: Frame<K>) {
      pending = frame;
      if (queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed && pending) draw(pending);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = undefined;
      layer.remove();
      for (const [target, original] of scroll) {
        target.scrollLeft = original.left;
        target.scrollTop = original.top;
      }
      if (positioned && container.style.position === 'relative')
        container.style.position = position;
    },
  };
}
