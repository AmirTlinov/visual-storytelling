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
/** Conditions expand below the drawing; one owner retains fields, disclosure and dismissal. */
export function conditionsPanel(title: string, signal: AbortSignal) {
  const id = `ve-conditions-${++serial}`;
  const element = node('div', {
    id,
    class: 've-scene-conditions',
    hidden: '',
    tabindex: '-1',
    role: 'dialog',
    'aria-label': 'Условия объяснения',
  });
  const button = node(
    'button',
    {
      type: 'button',
      class: 've-conditions-trigger',
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
  const show = () => {
    element.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  };
  const hide = () => {
    element.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const dismiss = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    hide();
    button.focus({ preventScroll: true });
  };
  button.addEventListener(
    'click',
    () => {
      if (!element.hidden) hide();
      else {
        show();
        element.focus({ preventScroll: true });
      }
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
  return {
    element,
    button,
    resources,
    show,
    hide,
    get open() {
      return !element.hidden;
    },
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
    },
  };
}
