import { SketchControls } from './fields.js';
export function button(label: string, action: () => void) {
  const element = SketchControls.action(label, action);
  return {
    element,
    set(next: string) {
      element.textContent = next;
      element.setAttribute('aria-label', next);
    },
    pressed(value: boolean) {
      element.dataset.mode = 'action';
      element.setAttribute('aria-pressed', String(value));
    },
    dispose() {
      element.removeEventListener('click', action);
      element.remove();
    },
  };
}
