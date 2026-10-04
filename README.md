# Visual Storytelling

TypeScript-библиотека рисованных объяснений и единая основа навыка `visual-explainer`. Версия **0.9.0** делает морфинг форм, чисел и текста общим поведением: операция и время управляют телом, надписью и контактом. Рассказ, поля, главы и камера связаны через `root.scene`; ручной осмотр сохраняет ход рассказа.

## Запуск

Нужен Node.js ≥ 22.18.

```sh
npm ci
npm run build           # dist/ — пакет; site/ — галерея примеров
npm run preview         # http://127.0.0.1:8793
```

Для разработки — `npm run dev`: тот же сборщик следит за примерами и библиотекой, сохраняет время рассказа и показывает ошибку поверх последней рабочей версии. Сборка запускает генераторы из `examples/ИМЯ/scene.json` и пишет SVG прямо в `site/`; Python-генератор LC использует `uv`. [Каталог](examples/catalog.json) задаёт страницы и кадры для сравнения.

## Создание сцены

```sh
node tools/scene.mjs examples --recommended    # готовые основы SVG и 3D
node tools/scene.mjs new /absolute/output/my-story --example explorer-svg
cd /absolute/output/my-story
npm install
npx visual-story api SceneShell.mount SceneOptions  # точный контракт пакета
npx visual-story info                     # фактическая сборка
npm run build
npm run dev
```

`examples нейрон` ищет по теме и API; `examples explorer-svg` показывает кадр, исходник и команду создания. `new` копирует предметный исходник и точную упакованную зависимость библиотеки. Принятые рассказы включают готовый голос; `--no-audio` откладывает озвучку до `npm run audio`, `--silent` создаёт сцену без речевых файлов. Встроенный мужской образец, модели и акустическое выравнивание принадлежат `tools/audio/`.

Исполняемый пакет содержит библиотеку и CLI; каталог примеров, инструкции навыка и исходные референсы остаются в авторском репозитории. `new` и `examples` запускаются из этого репозитория; в созданной сцене работают `build`, `dev`, `audio`, `review`, `pack`, `api`, `info`, `deliver` и экспорт.

`sketch-audio audition narration.json --segment question --out artifacts/voice` сравнивает цельные дубли одной мысли; выбранный `seed` сегмента сохраняет исполнение при следующей сборке. Подача и метки описаны в [озвучке](skill/references/narration.md).

Пример импорта:

```ts
import '@visual-storytelling/core/style.css';
import { SceneShell, SketchMotion, SvgLayout } from '@visual-storytelling/core';
import { Viewport3D, ThreeKit } from '@visual-storytelling/core/three';
```

Исходники сцен — в [examples](examples). Их [каталог](examples/catalog.json) задаёт подбор в галерее, CLI и навыке: описание, раздел, метки поиска, исходник и справки. `recommended` отмечает основу новой сцены, `reference` — визуально принятый эталон. Обновляй сведения и превью вместе со сценой.

Общие владельцы перечислены в [архитектуре](docs/architecture.md), правила сцены — в [контракте автора](docs/authoring.md), визуальный характер — в [PHILOSOPHY.md](PHILOSOPHY.md).

[Физические объекты](docs/physics.md) добавляют SVG и Three.js столкновения, упругие материалы, деформацию и захват. Rapier подключается через отдельные `./physics/2d` и `./physics/3d`; почерк, пигменты, материалы и плеер остаются общими.

[Согласованный морфинг](docs/morphing.md) связывает формы, числа, надписи и физический контакт. Автор задаёт операцию, объекты и время; [«Форма несёт смысл»](examples/written-morph/scene.js) показывает общий API в 2D/3D, на словах и абзацах. [Математика меняет форму](examples/formula-objects/scene.js) показывает площадь, линейное преобразование, синусоиду, касательную, интеграл, энергию и объёмную цепочку через общий `MathMorph.mount`.

## Экспорт

```sh
npx visual-story deliver . --out artifacts/release --formats mp4,html,source
```

Одна команда собирает озвучку с кэшем, страницу и выбранные результаты; после правки реплики повторяется она же. `--jobs 2` ограничивает параллельный рендер; сборка видео и непрерывного звука принадлежит экспортёру. По необходимости доступны `srt,vtt` из общей дорожки слов. Обычный автономный HTML сжимает исходный звук для доставки.

[Учебный разбор](examples/interface-walkthrough/scene.js) и [продуктовая инструкция](examples/product-walkthrough/scene.js) используют одни `storyActions` и фиксированный кадр `SceneShell`, сохраняя разную подачу. [Подключение](skill/references/scene-authoring.md#видеокадр-и-действия).

```sh
npm run export -- --scene area-story --format html --out artifacts/area.html
npm run export -- --scene area-story --format svg --time 61.9 --out artifacts/area.svg
npm run export -- --scene lc-oscillator --format png --time .75 --theme dark
npm run export -- --scene area-story --format mp4 --fps 30 --width 960
```

PNG/MP4 используют Chromium, MP4 также требует FFmpeg. `--from` и `--to` выбирают отрезок; видео получает соответствующую часть исходного звука. Размер видео постоянен: кадры вписываются с сохранением пропорций, `--height` задаёт высоту вместо высоты первого кадра. SVG сохраняет прозрачность; самодостаточный HTML работает офлайн и следует теме интерфейса. Для отдельной сцены: `npm run export -- --format png --time 4` или `npm run pack`. Упаковка для чата: `npm run pack -- --inline`; большой результат остаётся файлом для браузера.

## Проверка и навык

```sh
npm run build          # свежие dist/ и site/ для проверок
npm run check
npm test
npm run test:tools      # сценарий озвучки и структура SVG, без загрузки моделей
npm run test:browser    # взаимодействия со сборкой site/, порт 8794
npm run test:delivery   # отдельный потребитель пакета, офлайн HTML и озвучка
```

Проверка рассказа или любого UI использует один сеанс наблюдения:

```sh
node tools/scene.mjs review site/remainder-story --out artifacts/review
node tools/scene.mjs review http://localhost:3000 --click '#open' --out artifacts/ui
node tools/scene.mjs review inspect artifacts/ui --at .4 --object '#panel'
node tools/scene.mjs review artifacts/ui/replay.json --baseline artifacts/ui --out artifacts/after
```

`image` даёт обзор, `index.html` — карту эпизодов, запись и выбор объекта;
`inspect` читает те же кадры, события и состояние без повторного запуска приложения.
`--cue ID` сохраняет весь переход с контекстом; `record/stop/status` позволяет
записывать ручные взаимодействия. Поддерживаются HTML, SVG/WebGL, видео, PNG и окна
macOS. В сцене доступны речь, реально прочитанные метки, группы 3D и этапы MathMorph.
`--object`/`--crop` приближают деталь, `--baseline` сравнивает каждый эпизод по времени
и стадиям с сохранением длительности. `framesImage` и `photometryImage` содержат
разности, яркость, цвет и кимограмму. [Команды, источники времени и ограничения](skill/references/motion.md#проверка).

При изменении общего рисунка сохрани исходные кадры до правки: `node tools/visual-regression.mjs capture site artifacts/reference/pixels`, затем сравни сборку через `npm run test:visual`. `VISUAL_SCENES=area-story,vector` ограничивает проверку затронутыми примерами; обе темы и две ширины сохраняются. Отчёт в `artifacts/migrated/report.json` сообщает все различия, а просмотр помогает оценить их смысл.

Экспорт, превью, отчёт переходов и сравнение кадров используют `tools/open-scene.mjs`: он дожидается готовности, останавливает сцену и обращается к её `seek()`. `npm run profile` измеряет перематываемые сцены; для симуляций и статичных схем нужен конкретный сценарий взаимодействия. Проверки CTC и монтажа лежат в `tests/audio/test_pipeline.py` и запускаются отдельно в подготовленном окружении `sketch-audio`.

[skill/SKILL.md](skill/SKILL.md) содержит действующий навык и ссылается прямо на `tools`, `examples` и `docs`: эти авторские материалы не дублируются в зависимости каждой новой сцены. PNG лежат рядом с исходниками; работающая галерея собирается в `site/`. После изменения пакета пересобери страницы. Устанавливай навык ссылкой на `skill/`, сохраняя один источник инструкций и исполнения. Источники и лицензии — [THIRD_PARTY.md](THIRD_PARTY.md).

[Computer Explorer](examples/computer-explorer) связывает SSD, RAM, CPU, GPU и LCD и раскрывает оборудование до ячеек и транзисторов. [Контракт исследования](skill/references/nested-explorer.md) описывает общие камеру, жесты, контуры и симуляцию; [нейрон](examples/neuron-explorer) использует их с другой моделью и рисованным оформлением.
