import '@visual-storytelling/core/style.css';
import './style.css';
import { exampleGroups, selectExamples } from '../catalog-query.mjs';

export function mountGallery() {
  const catalog = JSON.parse(document.querySelector('#example-catalog').textContent);
  const form = document.querySelector('.gallery-search');
  const search = form.elements.q;
  const filters = [...document.querySelectorAll('button[data-group]')];
  const cards = [...document.querySelectorAll('[data-example]')];
  const sections = [...document.querySelectorAll('section[data-group]')];
  const count = document.querySelector('#result-count');
  const empty = document.querySelector('#empty');
  let group = '';

  function render({ save = true } = {}) {
    const selected = new Set(
      selectExamples(catalog, { query: search.value, group }).map(({ id }) => id),
    );
    for (const card of cards) {
      card.hidden = !selected.has(card.dataset.example);
      if (card.hidden) card.querySelector('details').open = false;
    }
    for (const section of sections)
      section.hidden = !section.querySelector('[data-example]:not([hidden])');
    for (const filter of filters)
      filter.setAttribute('aria-pressed', String(filter.dataset.group === group));
    count.value = `${selected.size} / ${cards.length}`;
    empty.hidden = selected.size > 0;
    form.querySelector('[type=reset]').hidden = !search.value && !group;
    if (save) {
      const url = new URL(location.href);
      for (const [key, value] of [
        ['q', search.value],
        ['group', group],
      ]) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      history.replaceState(null, '', url);
    }
  }

  function restore() {
    const params = new URLSearchParams(location.search);
    search.value = params.get('q') ?? '';
    group = Object.hasOwn(exampleGroups, params.get('group')) ? params.get('group') : '';
    render({ save: false });
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  search.addEventListener('input', () => render());
  form.addEventListener('reset', (event) => {
    event.preventDefault();
    search.value = group = '';
    render();
    search.focus();
  });
  for (const filter of filters)
    filter.addEventListener('click', () => {
      group = filter.dataset.group;
      render();
    });
  document.querySelector('#examples').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const text = button.closest('.example-setup').querySelector('textarea');
    const status = document.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(text.value);
      button.textContent = 'Скопировано';
      status.textContent = 'Команды скопированы';
    } catch {
      text.focus();
      text.select();
      button.textContent = 'Скопируйте выделенный текст';
      status.textContent = 'Команды выделены для копирования';
    }
  });
  window.addEventListener('popstate', restore);
  window.addEventListener('pageshow', restore);
  restore();
}
