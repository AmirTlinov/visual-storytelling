import { pointerGrab } from '../physics/grab.js';
import type { DrawingViewport } from '../story/subject.js';
export type LeverSide = 'left' | 'right';
export interface LeverGrip {
  readonly side: LeverSide;
  readonly arm: number;
  readonly element: SVGGraphicsElement;
  /** Horizontal screen position at 0/100cm, with the accepted bar angle. */
  project(): (clientX: number, clientY: number) => number;
}
/** Capture stays on the stable surface while accepted input replaces the artwork below it. */
export function leverInteraction(
  element: SVGSVGElement,
  viewport: DrawingViewport,
  grip: (side: LeverSide) => LeverGrip | undefined,
) {
  const abort = new AbortController();
  let keyboard: { end?: () => void; changed: boolean } | undefined;
  const endKeyboard = (replay: boolean) => {
    const previous = keyboard;
    keyboard = undefined;
    previous?.end?.();
    if (replay && previous?.changed) viewport.playback?.replay();
  };
  const select = (event: Event) => {
    const target =
      event.target instanceof Element ? event.target.closest('[data-lever-grip]') : null;
    if (!target || !element.contains(target) || element.closest('[inert]')) return;
    const side = target.getAttribute('data-lever-grip');
    return side === 'left' || side === 'right' ? grip(side) : undefined;
  };
  const apply = (side: LeverSide, arm: number) =>
    viewport.input?.({ [`${side}Arm`]: Math.max(0, Math.min(100, Math.round(arm))) });
  const grab = pointerGrab(element, select, (selected, event) => {
    if (!viewport.input) return;
    endKeyboard(false);
    viewport.playback?.pause();
    selected.element.focus({ preventScroll: true });
    // Keep the initial coordinate frame: a changed trial can have a different inclination.
    const armAt = selected.project();
    const origin = armAt(event.clientX, event.clientY);
    const initial = selected.arm;
    const end = viewport.inputGesture?.();
    let last = selected.arm;
    return {
      move(next) {
        const value = Math.max(
          0,
          Math.min(100, Math.round(initial + armAt(next.clientX, next.clientY) - origin)),
        );
        if (value === last) return;
        last = value;
        apply(selected.side, value);
      },
      release(completed) {
        end?.();
        if (completed && last !== initial && !element.closest('[inert]'))
          viewport.playback?.replay();
      },
    };
  });
  element.addEventListener(
    'keydown',
    (event) => {
      const selected = select(event);
      if (!selected) return;
      const sign = selected.side === 'left' ? -1 : 1;
      const amount = event.shiftKey ? 10 : 1;
      const value =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 100
            : event.key === 'ArrowLeft'
              ? selected.arm - sign * amount
              : event.key === 'ArrowRight'
                ? selected.arm + sign * amount
                : undefined;
      if (value === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (!keyboard) {
        viewport.playback?.pause();
        keyboard = { end: viewport.inputGesture?.(), changed: false };
      }
      keyboard.changed ||= Math.max(0, Math.min(100, value)) !== selected.arm;
      apply(selected.side, value);
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'keyup',
    (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) endKeyboard(true);
    },
    { signal: abort.signal },
  );
  window.addEventListener('blur', () => endKeyboard(false), { signal: abort.signal });
  element.addEventListener(
    'focusout',
    (event) => {
      if (event.target instanceof Element && event.target.matches('[data-lever-grip]'))
        endKeyboard(false);
    },
    { signal: abort.signal },
  );
  return {
    dispose() {
      endKeyboard(false);
      grab.dispose();
      abort.abort();
    },
  };
}
