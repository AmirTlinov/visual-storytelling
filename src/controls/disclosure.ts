/** A local explanation uses native summary semantics; its state belongs to the story. */
export function disclosure(
  parent: HTMLElement,
  options: { label: string; onChange(open: boolean): void },
) {
  const element = document.createElement('details');
  element.className = 've-disclosure';
  const summary = document.createElement('summary');
  summary.textContent = options.label;
  const body = document.createElement('div');
  body.className = 've-disclosure-body';
  element.append(summary, body);
  parent.append(element);
  const abort = new AbortController();
  summary.addEventListener(
    'click',
    (event) => {
      // Commit before layout observes the new height. The delayed native toggle event
      // can otherwise lose to a render of the previous story condition.
      event.preventDefault();
      options.onChange(!element.open);
    },
    { signal: abort.signal },
  );
  return {
    element,
    body,
    set(open: boolean) {
      element.open = open;
    },
    dispose() {
      abort.abort();
      element.remove();
    },
  };
}
