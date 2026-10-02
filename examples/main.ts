import './gallery.css';
import { choice, theme, exportSVG, download } from '@visual-storytelling/core';
import type { Theme } from '@visual-storytelling/core';
import { mount as area } from './area';
import { mount as sort } from './sort';
import { mount as lc } from './lc';
import { mount as vector } from './vector';
import { mount as remainder } from './remainder';
import { mount as transfer } from './transfer';
import { mount as materials } from './materials';
import type { Example } from './types';

const catalog = {
  area: {
    title: 'Площадь',
    mount: area,
    description: 'Голос, метки слов и одна измерительная сетка.',
    preview: 1.9,
  },
  remainder: {
    title: 'Остаток',
    mount: remainder,
    description: 'Одни и те же предметы сохраняются при перегруппировке.',
    preview: 21,
  },
  sort: {
    title: 'Сортировка',
    mount: sort,
    description: 'Причина сравнения и путь каждой перестановки.',
    preview: 0.8,
  },
  lc: {
    title: 'LC-контур',
    mount: lc,
    description: 'Идеальная модель без сопротивления. Энергия нормирована.',
    preview: 0.75,
  },
  vector: {
    title: 'Матрица',
    mount: vector,
    description: 'Меняйте коэффициенты и компоненты входного вектора.',
    preview: 10,
  },
  transfer: {
    title: 'Передача',
    mount: transfer,
    description: 'CPU и GPU читают и обновляют один общий буфер.',
    preview: 16,
  },
  materials: {
    title: 'Инструменты',
    mount: materials,
    description: 'Общие материалы, палитра и управление рисунком.',
    preview: 4,
  },
};
type SceneId = keyof typeof catalog;
declare global {
  interface Window {
    explainer: Example;
    galleryReady: Promise<void>;
    STORY_DEFAULTS?: { scene: string; theme: string; standalone: boolean };
  }
}
window.galleryReady = (async () => {
  await Promise.all(
    ['Notebook', 'NotebookFallback'].map((font) => document.fonts.load(`400 24px ${font}`)),
  );
  await document.fonts.ready;
  const parent = document.querySelector<HTMLElement>('#scene')!;
  const navigation = document.querySelector<HTMLElement>('#examples')!;
  const params = new URLSearchParams(location.search);
  if (window.STORY_DEFAULTS) {
    params.set('scene', window.STORY_DEFAULTS.scene);
    params.set('theme', window.STORY_DEFAULTS.theme);
    document.querySelector<HTMLElement>('.gallery-header')!.style.display = 'none';
    navigation.style.display = 'none';
  }
  let active: Example,
    selection: Theme = (params.get('theme') as Theme) || 'auto';
  if (!['light', 'dark', 'auto'].includes(selection)) selection = 'auto';
  const appearance = theme(document.documentElement, selection);
  const themePicker = choice(
    'Оформление',
    [
      { value: 'auto', label: 'Авто' },
      { value: 'light', label: 'Свет' },
      { value: 'dark', label: 'Ночь' },
    ] as const,
    selection,
    (value) => {
      selection = value;
      appearance.set(value);
      active?.setTheme(value);
    },
  );
  document.querySelector('#appearance')!.append(themePicker.element);
  const links = new Map<SceneId, HTMLAnchorElement>();
  function open(id: SceneId, push = false) {
    active?.dispose();
    active = catalog[id].mount(parent);
    active.setTheme(selection);
    window.explainer = active;
    active.exportSVG = () => exportSVG(active.svg());
    active.seek(params.has('t') ? Number(params.get('t')) : catalog[id].preview);
    if (params.get('reduced') === 'true') active.setReduced(true);
    for (const [key, link] of links)
      key === id ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
    document.querySelector('#description')!.textContent = catalog[id].description;
    document.title = `${catalog[id].title} · Наглядно`;
    if (push) history.pushState({ id }, '', `?scene=${id}`);
  }
  for (const [id, entry] of Object.entries(catalog)) {
    const link = document.createElement('a');
    link.href = `?scene=${id}`;
    link.textContent = entry.title;
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      params.delete('t');
      open(id as SceneId, true);
    });
    navigation.append(link);
    links.set(id as SceneId, link);
  }
  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('scene') as SceneId;
    open(id in catalog ? id : 'area');
  });
  document.querySelector('#save-svg')!.addEventListener('click', async () => {
    download(await exportSVG(active.svg()), 'explanation.svg');
  });
  const requested = params.get('scene') as SceneId;
  open(requested in catalog ? requested : 'area');
})();
window.galleryReady.catch((error) => {
  document.querySelector('#scene')!.textContent = String(error);
  console.error(error);
});
