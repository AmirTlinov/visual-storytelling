# Visual Storytelling

TypeScript-библиотека рисованных объяснений и локальный плагин Visual Storytelling для Codex. Речь и действия собираются из одного сценария. Живые рисунки работают на доске, в предметах и на странице; подготовленные движения, камера и выпуск переиспользуются между темами. Рассказ, поля, главы и камера связаны через `root.scene`; авторский комплект поставляется вместе с runtime.

Авторский код и документация — [0BSD](LICENSE); [сторонние компоненты](THIRD_PARTY.md) сохраняют свои условия. Устройство плагина и оставшиеся этапы публичного выпуска описаны в [техническом дизайне](docs/codex-plugin-tdd.md).

[Аудит авторства и качества](docs/authoring-audit.md) описывает действующие границы, проверки и оставшиеся возможности.

## Плагин Codex

Локальный комплект для macOS 13.5+ Apple Silicon. Готовый архив устанавливается по [инструкции](plugin/INSTALL.md) без разработческих Node/Python/Xcode. Сборка из репозитория:

```sh
npm ci
npm run plugin:release
./.plugin-release/runtime/node ./.plugin-release/plugin/install.mjs
```

Сборка появляется в `.plugin-release/`, архив с SHA-256 — в `artifacts/plugin/`; Node/npm включены. После установки открой Visual Storytelling в Codex или попроси открыть пример в чате. Агент создаёт редактируемый проект, управляет сценой и применяет правки; краткий контекст кадра автоматически заменяется в одном вложении.

Установщик хранит неизменяемые версии и стабильный launcher вне кэша Codex. Работы и выпуски также хранятся вне кэша установки, по умолчанию в `~/Library/Application Support/Visual Storytelling/projects`. Папка новых работ, язык и бюджет кэша доступны в настройках. Первая подготовка использует npm registry; Chromium и FFmpeg для видео загружаются по необходимости с проверкой SHA-256. После обновления переподключи плагин и начни следующий ход чата; порядок описан в [инструкции](plugin/INSTALL.md).

Плагин поставляет весь [каталог](examples/catalog.json): схемы, графики, опыты, математические разборы, подробные уроки и персонажные постановки. Выпуск поддерживает HTML, PNG, SVG для совместимых сцен, MP4, субтитры и редактируемый проект. Показанная сборка и последние рабочие правки выпускаются отдельными действиями.

По запросу плагин подготавливает закреплённые Python, Higgs и акустический выравниватель: около 12 ГБ загрузок, 18 ГБ свободного места, рекомендуются 32 ГБ памяти. Прогресс, отмена и повтор принадлежат общей очереди; проверенные ресурсы переиспользуются. Музыка загружается при использовании, системный голос macOS выбирается явно. Проекты сохраняют закреплённую библиотеку; её явное обновление отменяется. [Приёмка](docs/codex-plugin-tdd.md#приёмка) учитывает нативный Codex и самостоятельную установку на другом Mac.

## Запуск библиотеки

Нужен Node.js ≥ 22.18.

```sh
npm ci
npm run build           # dist/ — пакет; site/ — галерея примеров
npm run preview         # http://127.0.0.1:8793
```

Для разработки — `npm run dev`: тот же сборщик следит за примерами и библиотекой, сохраняет выбранное действие и параметры и показывает ошибку поверх последней рабочей версии. Сборка запускает генераторы из `examples/ИМЯ/scene.json` и пишет SVG прямо в `site/`; Python-генератор LC использует `uv`. [Каталог](examples/catalog.json) задаёт страницы и кадры для сравнения.

## Создание сцены

```sh
node tools/scene.mjs examples --recommended    # выбрать форму по задаче
node tools/scene.mjs new /absolute/output/my-story --example explorer-svg
cd /absolute/output/my-story
npm install
npx visual-story api SceneShell.mount SceneOptions  # точный контракт пакета
npx visual-story info                     # фактическая сборка
npm run build
npm run dev
```

Обновление существующей сцены из текущей библиотеки:

```sh
node tools/scene.mjs update /absolute/output/my-story
# Из потребителя: npx visual-story update . --from /absolute/library
```

Команда собирает изменённый runtime, закрепляет архив с идентификатором содержимого,
устанавливает его и сверяет фактический пакет. Скрипты и другие зависимости сцены
сохраняются. Повторный вызов не переустанавливает тот же пакет; npm lifecycle-скрипты
при обновлении не запускаются.

`examples нейрон` ищет по теме и API; `examples explorer-svg` показывает кадр, исходник и команду создания. `new` копирует предметный исходник и точную упакованную зависимость библиотеки. Уроки доступны в тихом режиме. `--no-audio` откладывает озвучку до `npm run audio`, `--silent` создаёт сцену без речевых файлов. Встроенный мужской образец, модели и акустическое выравнивание принадлежат `tools/audio/`.

Пакет содержит библиотеку, CLI, каталог, исходники и кадры примеров, инструкции навыка и документацию одной версии. `new` и `examples` работают и из установленного пакета. Готовые WAV из галереи в пакет не входят: такие шаблоны начинают с отложенной озвучкой; `npm run audio` собирает голос по сохранённому сценарию. `--audio` создаёт его сразу.

`sketch-audio audition narration.json --segment question --out artifacts/voice` сравнивает цельные дубли одной мысли; выбранный `seed` сегмента сохраняет исполнение при следующей сборке. Подача и метки описаны в [озвучке](skills/visual-explainer/references/narration.md).

Для историй с персонажами начни с `new --example tesla-circuit`: `story.json` содержит
речь и действия, `scene.js` выбирает модель, cast и set. [IllustratedStory](docs/lessons.md)
соединяет их автоматически. [Площадь](examples/area-lesson/scene.js) и
[термостат](examples/thermostat-story/scene.js) проверяют тот же путь на других темах.
[График](examples/graph-lab/scene.js) показывает зависимость пути от скорости; [регистр](examples/memory-register/scene.js) предлагает сначала записать предположение. В dev после правки речи пересобираются только изменённые дубли.

```sh
npx visual-story session http://127.0.0.1:8793 status
npx visual-story session http://127.0.0.1:8793 find --query "лампа"
npx visual-story session http://127.0.0.1:8793 control --commands '[{"type":"pause"},{"type":"cue","id":"workshop.explain","progress":0.6}]'
```

Сеанс сообщает собранную и показанную ревизии, параметры и диагностику кадра.
При нескольких открытых представлениях выбери `--view`; `--revision` защищает
команду от применения к другой сборке. Команды вызывает существующий `SceneHandle`.

Пример импорта:

```ts
import '@visual-storytelling/core/style.css';
import { SceneShell, SketchMotion, SvgLayout } from '@visual-storytelling/core';
import { Viewport3D, ThreeKit } from '@visual-storytelling/core/three';
```

Исходники сцен — в [examples](examples). Их [каталог](examples/catalog.json) задаёт подбор в галерее, CLI и навыке: описание, раздел, метки поиска, исходник и справки. `recommended` отмечает основу новой сцены, `reference` — визуально принятый эталон. Обновляй сведения и превью вместе со сценой.

Общие владельцы перечислены в [архитектуре](docs/architecture.md), правила сцены — в [контракте автора](docs/authoring.md), визуальный характер — в [PHILOSOPHY.md](PHILOSOPHY.md).

[Персонажи и постановка](docs/characters.md) связывают готовый Chibi-риг, SVG-облики,
декорации и предметы с раскадровкой `CharacterStory`. [Тесла](examples/chibi-tesla/scene.js),
[Мира](examples/chibi-garden/scene.js) и [общая идея](examples/chibi-transfer/scene.js)
показывают один API на разных историях. `visual-story characters` перечисляет набор;
`characters new/build` создаёт редактируемый облик и автоматически собирает атлас.
Подготовленные `perform` ведут ходьбу, книгу, посадку, дверь, лестницу и совместные
действия; `arrange` задаёт размещение отношениями, `routines` собирает готовые цепочки.
`characters --json` возвращает облики, одежду, подготовленные действия, последовательности и места.

[Подробный урок](docs/lessons.md) собирает главы из одного `StoryDocument`:
реплики, действия и тихая разметка сохраняют общие часы. `IllustratedStory`
подключает документ к `SceneStory`; `inkChapter`, `physicsChapter` и
`characterChapter` выбирают подходящее представление каждой мысли.
[Площадь](examples/area-lesson/scene.js) предлагает записать прогноз, выполнить
опыт и исследовать результат. [Персонажный урок](examples/character-lesson/scene.js)
соединяет перенос предметов, математику и физический опыт. Рисунок и сетка
используют общий масштаб; детали раскрываются рядом с объясняемым предметом.

[Физические объекты](docs/physics.md) добавляют SVG и Three.js столкновения, упругие материалы, деформацию и захват. Rapier подключается через отдельные `./physics/2d` и `./physics/3d`; почерк, пигменты, материалы и плеер остаются общими.

[SVG-предметы](docs/svg-artwork.md) переиспользуют рисунок с разными палитрами,
размерами и глубиной через `SvgArtwork3D`. Нормализация, перекрытия и прозрачность
входят в общий объект; [пример](examples/svg-artwork/scene.js) работает на часах рассказа.

[Запись результата](examples/result-delivery/scene.js) связывает вычисление и ячейку:
Опция `delivery` у `MathMorph3D` ведёт перенос, размер, видимость и перемотку по меткам рассказа.

[Тензоры и срезы](docs/tensors.md) сохраняют исходные адреса при перестановке осей,
выборе слоя и вычислении. `TensorData` задаёт снимок, `Tensor3D` — адресуемые ячейки,
`TensorSlice3D` — извлечение текущей выборки. [Выбор дня](examples/tensor-slices/scene.js)
и [происхождение результата](examples/math-workbench/scene.js) используют общие
`MathMorph`, камеру, семантику и часы рассказа.

[Согласованный морфинг](docs/morphing.md) связывает формы, числа, надписи и физический контакт. Автор задаёт операцию, объекты и время; [«Форма несёт смысл»](examples/written-morph/scene.js) показывает общий API в 2D/3D, на словах и абзацах. [Общий граф связей](examples/mathematical-relations/models.js) превращает формулы в связанные точки, материалы, траектории и измерения в 2D/3D. [Математика меняет форму](examples/formula-objects/scene.js) показывает площадь, линейное преобразование, синусоиду, касательную, интеграл, энергию и объёмную цепочку через общий `MathMorph.mount`.

## Экспорт

```sh
npx visual-story deliver . --out artifacts/release --formats mp4,html,source
```

Одна команда собирает озвучку с кэшем, страницу и выбранные результаты; после правки реплики повторяется она же. `--jobs 2` ограничивает параллельный рендер; сборка видео и непрерывного звука принадлежит экспортёру. По необходимости доступны `srt,vtt` из общей дорожки слов. Обычный автономный HTML сжимает исходный звук для доставки.

[Учебный разбор](examples/interface-walkthrough/scene.js) и [продуктовая инструкция](examples/product-walkthrough/scene.js) используют одни `storyActions` и фиксированный кадр `SceneShell`, сохраняя разную подачу. [Подключение](skills/visual-explainer/references/scene-authoring.md#видеокадр-и-действия).

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
разности, яркость, цвет и кимограмму. [Команды, источники времени и ограничения](skills/visual-explainer/references/motion.md#проверка).

При изменении общего рисунка сохрани исходные кадры до правки: `node tools/visual-regression.mjs capture site artifacts/reference/pixels`, затем сравни сборку через `npm run test:visual`. `VISUAL_SCENES=area-story,vector` ограничивает проверку затронутыми примерами; обе темы и две ширины сохраняются. Отчёт в `artifacts/migrated/report.json` сообщает все различия, а просмотр помогает оценить их смысл.

Экспорт, превью, отчёт переходов и сравнение кадров используют `tools/open-scene.mjs`: он дожидается готовности, останавливает сцену и обращается к её `seek()`. `npm run profile` измеряет перематываемые сцены; для симуляций и статичных схем нужен конкретный сценарий взаимодействия. Проверки CTC и монтажа лежат в `tests/audio/test_pipeline.py` и запускаются отдельно в подготовленном окружении `sketch-audio`.

[skills/visual-explainer/SKILL.md](skills/visual-explainer/SKILL.md) содержит действующий навык и ссылается прямо на `tools`, `examples` и `docs`: они поставляются из того же исходника вместе с закреплённой зависимостью сцены. PNG лежат рядом с исходниками; работающая галерея собирается в `site/`. После изменения пакета пересобери страницы. Устанавливай навык ссылкой на `skills/visual-explainer/`, сохраняя один источник инструкций и исполнения. Источники и лицензии — [THIRD_PARTY.md](THIRD_PARTY.md).

[Computer Explorer](examples/computer-explorer) связывает SSD, RAM, CPU, GPU и LCD и раскрывает оборудование до ячеек и транзисторов. [Контракт исследования](skills/visual-explainer/references/nested-explorer.md) описывает общие камеру, жесты, контуры и симуляцию; [нейрон](examples/neuron-explorer) использует их с другой моделью и рисованным оформлением.
