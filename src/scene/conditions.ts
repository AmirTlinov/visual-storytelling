import { validateStoryResources, type StoryResource } from '../story/resources.js';
let serial = 0;
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
};
/** One popover owns condition geometry, keyboard dismissal and optional source disclosure. */
export function conditionsPanel(title: string, aperture: () => number, signal: AbortSignal) {
  const id = `ve-conditions-${++serial}`;
  const element = node('div', {
    id,
    class: 've-scene-conditions',
    popover: 'auto',
    role: 'dialog',
    'aria-label': 'Условия объяснения',
  });
  const button = node(
    'button',
    {
      type: 'button',
      class: 've-conditions-trigger',
      popovertarget: id,
      'aria-expanded': 'false',
      'aria-controls': id,
      hidden: '',
    },
    'Условия',
  );
  const heading = node('div', { class: 've-conditions-heading' }),
    caption = node('h2', {}, title);
  const close = node(
    'button',
    {
      type: 'button',
      popovertarget: id,
      popovertargetaction: 'hide',
      'aria-label': 'Закрыть условия',
    },
    '×',
  );
  heading.append(caption, close);
  const resources = node('details', { class: 've-scene-resources', hidden: '' }),
    summary = node('summary', {}, 'Источники и границы'),
    content = node('div');
  resources.append(summary, content);
  element.append(heading, resources);
  let sources: readonly StoryResource[] = [];
  const place = () => {
    if (!element.matches(':popover-open')) return;
    const viewport = window.visualViewport,
      left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0,
      width = viewport?.width || innerWidth,
      height = viewport?.height || innerHeight,
      bounds = button.getBoundingClientRect();
    const panelWidth = Math.max(0, Math.min(520, width - 16, aperture()));
    element.style.width = `${panelWidth}px`;
    element.style.maxHeight = `${Math.max(0, height - 16)}px`;
    element.style.left = `${Math.max(left + 8, Math.min(bounds.right - panelWidth, left + width - panelWidth - 8))}px`;
    element.style.top = `${Math.max(top + 8, Math.min(bounds.bottom + 6, top + height - element.getBoundingClientRect().height - 8))}px`;
  };
  const dismiss = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (element.matches(':popover-open')) element.hidePopover();
    button.focus({ preventScroll: true });
  };
  element.addEventListener(
    'toggle',
    () => {
      button.setAttribute('aria-expanded', String(element.matches(':popover-open')));
      place();
    },
    { signal },
  );
  close.addEventListener('click', dismiss, { signal });
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) dismiss(event);
    },
    { signal },
  );
  resources.addEventListener('toggle', place, { signal });
  return {
    element,
    button,
    resources,
    place,
    get hasResources() {
      return sources.length > 0;
    },
    setTitle(value: string) {
      caption.textContent = value;
    },
    setResources(value: readonly StoryResource[]) {
      const next = validateStoryResources(value),
        fragment = document.createDocumentFragment();
      for (const source of next) {
        const article = node('article', { 'data-resource-id': source.id });
        if (source.url) {
          const link = node(
            'a',
            { href: source.url, target: '_blank', rel: 'noopener noreferrer' },
            source.title,
          );
          article.append(link);
        } else article.append(node('strong', {}, source.title));
        article.append(node('p', {}, source.description));
        if (source.limits?.length) {
          const limits = node('ul');
          for (const value of source.limits) limits.append(node('li', {}, value));
          article.append(limits);
        }
        fragment.append(article);
      }
      content.replaceChildren(fragment);
      sources = next;
      resources.hidden = !sources.length;
      place();
    },
  };
}
