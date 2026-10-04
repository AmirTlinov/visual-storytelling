import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from '../build-pages.mjs';
import { exampleDetails } from '../catalog.mjs';
import { exampleGroups, selectExamples } from '../catalog-query.mjs';

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );

function card(entry) {
  const detail = exampleDetails(entry);
  const command = [detail.create, 'cd ./my-story', 'npm install', 'npm run dev'].join(' &&\n');
  const badge = entry.recommended ? 'Начать здесь' : entry.reference ? 'Эталон оформления' : '';
  return `<article class="example" data-example="${entry.id}">
    <a class="example-open" href="${entry.id}/${entry.page}">
      <picture><source media="(prefers-color-scheme: dark)" srcset="${entry.id}/preview-dark.png"><img src="${entry.id}/preview.png" alt="" loading="lazy" width="800" height="500"></picture>
      <h3>${escape(entry.title)}<span aria-hidden="true"> ↗</span></h3>
    </a>
    ${badge ? `<span class="example-badge" data-recommended="${!!entry.recommended}">${badge}</span>` : ''}
    <p class="example-summary">${escape(entry.summary)}</p>
    <details class="example-create" name="create-example">
      <summary>Взять за основу</summary>
      <div class="example-setup">
        <p>Выполните в терминале. Новая сцена появится в папке <code>my-story</code>.</p>
        <textarea readonly spellcheck="false" aria-label="Команды создания: ${escape(entry.title)}" rows="6">${escape(command)}</textarea>
        <div class="example-actions">
          <button type="button" data-copy>Копировать команды</button>
          <a href="sources/${entry.id}.txt" target="_blank" rel="noopener" aria-label="Исходник: ${escape(entry.title)}">Исходник ↗</a>
        </div>
      </div>
    </details>
  </article>`;
}

export async function buildGalleryIndex(target, catalog) {
  const entries = selectExamples(catalog);
  const sections = Object.entries(exampleGroups)
    .map(
      ([id, title]) =>
        `<section data-group="${id}" aria-labelledby="group-${id}"><h2 id="group-${id}">${title}</h2><div class="example-grid">${entries
          .filter((entry) => entry.group === id)
          .map(card)
          .join('')}</div></section>`,
    )
    .join('');
  const filters = [['', 'Все'], ...Object.entries(exampleGroups)]
    .map(
      ([id, title]) =>
        `<button type="button" data-mode data-group="${id}" aria-pressed="${!id}">${title}</button>`,
    )
    .join('');
  const source = fileURLToPath(new URL('./index.html', import.meta.url));
  const html = (await readFile(source, 'utf8'))
    .replace('<!-- filters -->', filters)
    .replace('<!-- examples -->', sections)
    .replace(
      '<!-- catalog -->',
      `<script type="application/json" id="example-catalog">${JSON.stringify(catalog).replaceAll('<', '\\u003c')}</script>`,
    );
  await buildPage(source, target, { sourcePackage: true, html });
  // A browser-readable copy of the actual entrypoint; authored code remains in examples/.
  await mkdir(resolve(target, 'sources'), { recursive: true });
  await Promise.all(
    entries.map(async (entry) => {
      await writeFile(
        resolve(target, 'sources', `${entry.id}.txt`),
        await readFile(exampleDetails(entry).source),
      );
    }),
  );
}
