# Visual Storytelling

TypeScript-библиотека аккуратных рисованных объяснений и единая основа навыка `visual-explainer`. Версия **0.2.0** сохраняет принятые рисунки, шрифты, озвучку и поведение 14 примеров навыка; галерея также содержит матричное преобразование и каталог материалов.

## Запуск

Нужен Node.js ≥ 22.18.

```sh
npm ci
npm run build           # dist/ — пакет; site/ — галерея из 16 примеров
npm run preview         # http://127.0.0.1:8793
```

Для разработки — `npm run dev`. Для пересборки предметных SVG — `npm run generate`, затем `npm run build`; Python-генератор LC использует `uv`. Каталог и адреса примеров определены в [examples/catalog.json](examples/catalog.json).

## Создание сцены

```sh
node tools/scene.mjs new /absolute/output/my-story --example area-story
cd /absolute/output/my-story
npm install
npm run build
npm run dev
```

Команда копирует предметный исходник и точную упакованную зависимость библиотеки. Принятые рассказы включают готовый голос; `--no-audio` включает тихое время, `npm run audio` пересобирает изменённый `narration.json` и включает озвучку. Встроенный мужской образец, модели и акустическое выравнивание принадлежат `tools/audio/`.

Для примеров с генератором SVG команда также создаёт `npm run generate`: после изменения генератора выполни её перед `npm run build`.

Пример импорта:

```ts
import '@visual-storytelling/core/style.css';
import { SceneShell, SketchMotion, SvgLayout } from '@visual-storytelling/core';
import { Viewport3D, ThreeKit } from '@visual-storytelling/core/three';
```

Готовые композиции и работающие вызовы — в [examples](examples). Все страницы импортируют этот пакет. Общие владельцы перечислены в [архитектуре](docs/architecture.md), правила сцены — в [контракте автора](docs/authoring.md), визуальный характер — в [PHILOSOPHY.md](PHILOSOPHY.md).

## Экспорт

```sh
npm run export -- --scene area-story --format html --out artifacts/area.html
npm run export -- --scene area-story --format svg --time 48.2 --out artifacts/area.svg
npm run export -- --scene lc-oscillator --format png --time .75 --theme dark
npm run export -- --scene area-story --format mp4 --fps 30 --width 960
```

PNG/MP4 используют Chromium, MP4 также требует FFmpeg. `--from` и `--to` выбирают отрезок; видео получает соответствующую часть исходного звука. SVG сохраняет прозрачность; самодостаточный HTML работает офлайн и следует теме интерфейса. Для отдельной сцены: `npm run export -- --format png --time 4` или `npm run pack`. Упаковка для чата: `npm run pack -- --inline`; большой результат остаётся файлом для браузера.

## Проверка и навык

```sh
npm run check
npm test
npm run test:browser    # взаимодействия со сборкой site/, порт 8794
npm run test:delivery   # отдельный потребитель пакета, офлайн HTML и озвучка
```

При изменении общего рисунка сохрани исходные кадры до правки: `node tools/visual-regression.mjs capture site artifacts/reference/pixels`, затем сравни сборку через `npm run test:visual`. Проверка сообщает любые пиксельные различия и завершается с ошибкой при расхождениях; отчёт в `artifacts/migrated/report.json` позволяет отличить изменение рисунка от нестабильности сглаживания. Просмотр и взаимодействия проверяют целостность объяснения.

[skill/SKILL.md](skill/SKILL.md) содержит действующий навык. Его `scripts` ссылается на `tools`, `examples` — на исходники, `previews` — на собранный `site`; исходники находятся в корневом `examples`. После изменения пакета пересобери страницы. Устанавливай навык ссылкой на `skill/`, сохраняя один источник инструкций и исполнения. Источники и лицензии — [THIRD_PARTY.md](THIRD_PARTY.md).
