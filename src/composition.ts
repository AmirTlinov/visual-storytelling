/** Rebuild geometry only after a real width change; the story and time stay mounted. */
export function composition<T extends { dispose(): void }>(
  parent: HTMLElement,
  build: (width: number) => T,
  onLayout: () => void = () => {},
) {
  let width = Math.max(280, Math.round(parent.getBoundingClientRect().width));
  let current = build(width);
  const observer = new ResizeObserver((entries) => {
    const next = Math.max(280, Math.round(entries[0]!.contentRect.width));
    if (next === width) return;
    current.dispose();
    width = next;
    current = build(width);
    onLayout();
  });
  observer.observe(parent);
  return {
    get current() {
      return current;
    },
    dispose() {
      observer.disconnect();
      current.dispose();
    },
  };
}
