/** A subject, its controls and nearby reasoning reflow together without scaling text. */
export function explanationLayout(parent: HTMLElement) {
  const element = document.createElement('section');
  element.className = 've-explanation';
  const subject = document.createElement('div');
  subject.className = 've-explanation-subject';
  const figure = document.createElement('div');
  figure.className = 've-explanation-figure';
  const controls = document.createElement('div');
  controls.className = 've-explanation-controls';
  const notes = document.createElement('aside');
  notes.className = 've-explanation-notes';
  const footer = document.createElement('div');
  footer.className = 've-explanation-footer';
  subject.append(figure, controls);
  element.append(subject, notes, footer);
  parent.append(element);
  return { element, figure, controls, notes, footer, dispose: () => element.remove() };
}
