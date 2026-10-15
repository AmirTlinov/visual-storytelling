const holds = new WeakMap<HTMLElement, { previous: string | null; tokens: Set<symbol> }>();
/** Keep a field's uncommitted draft through a temporary move or interaction suspension. */
export function holdControlFocus(roots: readonly HTMLElement[]) {
  const focused = document.activeElement;
  const owned = focused instanceof HTMLElement && roots.some((root) => root.contains(focused));
  const token = Symbol();
  for (const root of roots) {
    let hold = holds.get(root);
    if (!hold) {
      hold = { previous: root.getAttribute('data-scene-controls-moving'), tokens: new Set() };
      holds.set(root, hold);
    }
    hold.tokens.add(token);
    root.dataset.sceneControlsMoving = '';
  }
  const input =
    owned && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)
      ? focused
      : undefined;
  const selection =
    input && input.selectionStart !== null
      ? {
          start: input.selectionStart,
          end: input.selectionEnd!,
          direction: input.selectionDirection ?? undefined,
        }
      : undefined;
  const popover = owned ? focused.closest<HTMLElement>('[popover]') : null;
  const open = popover?.matches(':popover-open');
  return {
    restore() {
      if (!owned || !focused.isConnected || !document.hasFocus()) return;
      if (open && popover?.contains(focused) && !popover.matches(':popover-open'))
        popover.showPopover();
      if (focused.checkVisibility() && document.activeElement !== focused)
        focused.focus({ preventScroll: true });
      if (selection && input)
        input.setSelectionRange(selection.start, selection.end, selection.direction);
    },
    release() {
      for (const root of roots) {
        const hold = holds.get(root);
        if (!hold?.tokens.delete(token) || hold.tokens.size) continue;
        if (hold.previous === null) delete root.dataset.sceneControlsMoving;
        else root.setAttribute('data-scene-controls-moving', hold.previous);
        holds.delete(root);
      }
    },
  };
}
