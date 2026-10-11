import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from '../build-pages.mjs';
import { exampleDetails } from '../catalog.mjs';
import { selectExamples } from '../catalog-query.mjs';

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

function commands(text, label) {
  return `<div class="example-setup"><textarea readonly spellcheck="false" aria-label="${label}" rows="4">${escape(text)}</textarea><div class="example-actions"><button type="button" data-copy>Копировать команды</button></div></div>`;
}

function card(entry) {
  const detail = exampleDetails(entry);
  const run = (create) => [create, 'cd ./my-story', 'npm install', 'npm run dev'].join(' &&\n');
  const blank = detail.create.replace(/ --example \S+$/, '');
  return `<article class="example" data-example="${entry.id}">
    <a class="example-open" href="${entry.id}/${entry.page}">
      <picture><source media="(prefers-color-scheme: dark)" srcset="${entry.id}/preview-dark.png"><img src="${entry.id}/preview.png" alt="" width="1280" height="720"></picture>
      <h2>${escape(entry.title)}<span aria-hidden="true"> ↗</span></h2>
    </a>
    <p class="example-summary">${escape(entry.summary)}</p>
    <div class="example-actions"><a class="example-start" href="${entry.id}/${entry.page}">Исследовать объяснение</a><a href="sources/${entry.id}.txt" target="_blank" rel="noopener" aria-label="Исходник: ${escape(entry.title)}">Исходник ↗</a></div>
    <details class="example-create">
      <summary>Создать своё объяснение</summary>
      <p>Начните с чистого проекта, общего кадра и плеера.</p>
      ${commands(run(blank), 'Команды создания чистого проекта')}
    </details>
    <details class="example-create">
      <summary>Изменить этот разбор</summary>
      ${entry.editing?.length ? `<ul>${entry.editing.map(({ file, purpose }) => `<li><code>${escape(file)}</code> — ${escape(purpose)}</li>`).join('')}</ul>` : ''}
      ${commands(run(detail.create), 'Команды копирования эталона')}
    </details>
  </article>`;
}

export async function buildGalleryIndex(target, catalog) {
  const entries = selectExamples(catalog);
  const source = fileURLToPath(new URL('./index.html', import.meta.url));
  const html = (await readFile(source, 'utf8')).replace(
    '<!-- examples -->',
    entries.map(card).join(''),
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
