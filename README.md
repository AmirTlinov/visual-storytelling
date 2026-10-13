# Visual Storytelling

TypeScript-библиотека наглядных объяснений и локальный плагин для Codex. Модель, рисунок, рассказ и ручной ввод связаны через один `root.scene`. Интерактив и видео используют общий кадр 16:9; плеер под рисунком сохраняет удобный размер. Основные штрихи — нейтральные чернила, почерк прямой, цвет связывает смысловые роли.

В комплекте один законченный эталон — [«Как GPT выбирает следующее слово»](examples/gpt-model/scene.js). Он раскрывает токены, представления, attention, residual stream, MLP и выбор продолжения через локальную учебную модель с открытыми весами. [Модель](examples/gpt-model/model.js), [рисунок](examples/gpt-model/drawing.js) и [вычисления](examples/gpt-model/computation.js) читают одни данные. Это небольшая обученная модель для объяснения устройства GPT; её границы показаны внутри сцены.

Короткий опыт из готового приёма начинается с [компактного описания модели](skills/visual-explainer/references/live-explanation.md). Для новой предметной логики есть редактируемый JS/TS-каркас. SVG, 3D, морфинг, физика, персонажи, графики и документные уроки остаются общими возможностями библиотеки.

Авторский подход — [связный визуальный рассказ](skills/visual-explainer/references/visual-storytelling.md): наблюдаемый механизм, короткие естественные фразы у предметов и опыт, которым зритель проверяет вывод. Эти правила входят в основной навык и справку плагина.

## Запуск

Нужен Node.js ≥ 22.18.

```sh
npm ci
npm run build          # dist/ — пакет; site/ — эталон и его страница
npm run check
npm run preview        # http://127.0.0.1:8793
```

`npm run dev` пересобирает изменения и возвращает сцену к выбранному времени и параметрам. Исходники эталона находятся в `examples/gpt-model/`; `dist/` и `site/` — производные артефакты.

## Создание и правка

В Codex `story_create` с `document` открывает живую карточку. `StoryDocument` v2 объединяет модели, представления и необязательные главы. `division` показывает целые группы с остатком; `fractions` разделяет и собирает доли одного целого с точным происхождением; `dependency-route` прослеживает один заказ, отказ и общий либо независимый резерв. `story.json` сохраняет замысел; `story_edit(operations)` меняет его одной транзакцией. `chapters: []` создаёт статический опыт без плеера. [Формат и примеры](skills/visual-explainer/references/live-explanation.md).

Документный проект имеет `story-project.json`: один владелец entry, список авторских модулей и ресурсов. Модель и рисунок экспортируют обычные JS/TS-модули; подготовленный 2D runtime переиспользуется. Авторский код проверяется в браузерном renderer до публикации. Самостоятельный `scene.js` остаётся обычным исходным entry без документного manifest. [Новый модуль и работающий пример](skills/visual-explainer/references/document-modules.md).

Для собственного JS/TS-кода создай проект через CLI или `story_create` без `document`:

```sh
node tools/scene.mjs new /absolute/output/my-story --title "Моя тема" --json
cd /absolute/output/my-story
npm ci
npx visual-story api SceneShell.mount StoryOptions
npx visual-story info
npm run build
npm run dev
```

Команда возвращает `files`, `entry`, закреплённый `runtime` и `sourceRevision`. В `scene.js` уже подключены оболочка и поверхность; добавь предметную модель и рисунок. `package.json`, lockfile и точный архив runtime входят в проект.

Для явной копии эталона:

```sh
node tools/scene.mjs examples gpt-model --json
node tools/scene.mjs new /absolute/output/gpt-model --example gpt-model
```

Эти же команды работают из установленного пакета через `npx visual-story`. API читается из деклараций именно установленной версии: `api NAME.member` показывает метод, `api ./three` — модуль, `--full` раскрывает связанные типы. Старый проект сохраняет свой runtime; обновление выполняется явно:

```sh
node tools/scene.mjs update /absolute/output/my-story
```

## Плагин Codex

Локальные комплекты для macOS Apple Silicon и Linux x86_64/ARM64 устанавливаются по [инструкции](plugin/INSTALL.md). Они содержат Node/npm, runtime, навыки и готовый GPT-эталон. Сборка для текущей ОС и установка из репозитория:

```sh
npm run plugin:release
./.plugin-release/runtime/node ./.plugin-release/plugin/install.mjs
```

Архив и SHA-256 появляются в `artifacts/plugin/`, распакованный выпуск — в `.plugin-release/`. Установщик сохраняет неизменяемые версии вне кэша Codex. После обновления переподключи плагин.

`npm run plugin:linux` собирает обе Linux-архитектуры через закреплённый Docker-образ и проверяет каждый установленный комплект: MCP, редактируемый проект, HTML/PNG/MP4. Linux использует glibc; Higgs на Apple MLX доступен только на Mac. Требования Chromium — в инструкции установки.

Для готового приёма используй `story_create(document)` → `story_edit(operations)`: создание открывает карточку, правка обновляет её через существующий `root.scene`. Валидный частичный ввод может дать предварительный кадр до завершения вызова; он помечен как предварительный и ещё не подтверждает ревизию проекта. Ответ правки различает записанный исходник и подтверждённый показ.

В уже открытой карточке передай её `context` в `story_create`: новый опыт использует действующую навигацию с возвратом к прежнему. Ответ сообщает состояние доставки; повтор requestId восстанавливает незавершённый показ. `story_control(detail: "model")` возвращает вычисленные значения вместе с результатом действия. [Короткий контракт](skills/visual-explainer/references/live-explanation.md) описывает проверку и метрики подготовки/показа.

Для собственной сцены `story_create` без `document` и `example` создаёт редактируемый каркас; `example: "gpt-model"` копирует эталон. Этот путь использует обычную сборку: наполни каркас, проверь через `story_review`, открой через `story_open(context)`. Оба пути принимают связанный `context` и уникальный `requestId`. Повтор возвращает завершённый receipt; неподтверждённую живую доставку он возобновляет без повторной записи исходника. Голос и `story_produce` выбираются в чате.

Живой проект сразу закрепляет точный установленный выпуск в `scene-runtime.json`. Для первого показа не нужны `npm ci`, сборка страницы или архив runtime на каждый запрос. Переносимый архив с зависимостями готовится при выпуске исходников. Обновление плагина сохраняет pin проекта; смена библиотеки выполняется явно.

Проекты по умолчанию хранятся в `~/Library/Application Support/Visual Storytelling/projects` на Mac и `${XDG_DATA_HOME:-$HOME/.local/share}/visual-storytelling/projects` на Linux. Дополнительные зависимости собственного кода устанавливаются через npm registry; видео и озвучка подготавливают свои инструменты по необходимости. Озвучка необязательна. По умолчанию используется локальный Higgs TTS 3 BF16 с принятым мужским образцом; другую локальную модель или API агент подключает через [адаптер проекта](skills/visual-explainer/references/voice-adapter.md). `story_voice` сохраняет выбор в `voice.json`; системных голосов и автоматической замены провайдера нет. [Формат сценария и голос](skills/visual-explainer/references/narration.md).

## Возможности и владельцы

| Область                  | Владелец                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Публичный API            | `src/index.ts` и экспорты `package.json`                                                                                                         |
| Сцена, команды, снимок   | `src/scene-handle.ts`, `src/scene-checkpoint.ts`; один `root.scene`                                                                              |
| Кадр и управление        | `src/scene-frame.ts`, `src/scene.ts`; рисунок 16:9 и отдельный плеер                                                                             |
| Поля и меню выбора       | `src/controls/fields.ts`; главы, условия и скорость используют общий контрол                                                                     |
| Время и главы            | `src/story/`; `stateAt → derive → render`, принятый ввод и завершённый кадр                                                                      |
| Авторский документ       | `src/story/document-schema.ts`; общая проверка, чистые операции и ссылки моделей                                                                 |
| Проекция документа       | `src/story/document-timing.ts`, `document-model.ts`, `illustrated.ts`; существующие SceneShell + Story                                           |
| Предметные модели        | `src/recipes/*-model.ts`; входы, чистые JS-операции и предметные ограничения                                                                     |
| Целые группы и остаток   | `src/math/division.ts`, `src/recipes/division.ts`; модель и её рисунок                                                                           |
| Измеримые части и дроби  | `src/math/rational.ts`, `quantity-parts.ts`; `fractions-model.ts` вычисляет, `fractions.ts` рисует, `fractions-motion.ts` готовит MathMorph plan |
| Зависимости и маршрут    | `src/recipes/dependency-route-model.ts`; `dependency-route.ts` рисует вычисленный trace через `trace-path.ts`                                    |
| Авторские модули         | `tools/story-project.mjs`, `prepare-story-project.mjs`; manifest, общий runtime и существующий worker                                            |
| SVG, письмо и палитра    | `src/ink/`, `src/styles/`, `src/assets/`; общий почерк для шрифтов и штрихов                                                                     |
| Раскладка и 3D           | `src/layout/`, `src/viewport/`; подписи, препятствия, камеры и тензоры                                                                           |
| Превращения и вычисления | `src/morph/`, `src/math/`; `MathMorph`, `InkMorph`, происхождение результата                                                                     |
| Физика и персонажи       | `src/physics/`, `src/characters/`; Rapier, постановка и живые поверхности                                                                        |
| Создание и ревизии       | `tools/create-scene.mjs`, `tools/project-files.mjs`; CLI и плагин используют один путь                                                           |
| Закрепление библиотеки   | `tools/runtime-package.mjs`; установленный выпуск или переносимый архив                                                                          |
| Сборка, review и выпуск  | `tools/`; установленный runtime, готовность сцены и атомарная публикация                                                                         |
| Плагин                   | `plugin/runtime/`, `plugin/projects.mjs`, `plugin/jobs.mjs`; сеансы, транзакции и очередь                                                        |
| Подготовленное авторство | `plugin/runtime/project-creation.mjs`, `project-transactions.mjs`; общий commit, отдельные способы доставки                                      |
| Предметный эталон        | `examples/gpt-model/`; модель и композиция принадлежат сцене                                                                                     |

[Архитектура](docs/architecture.md) раскрывает границы; [контракт автора](docs/authoring.md) — управление и восстановление; [PHILOSOPHY.md](PHILOSOPHY.md) — визуальный характер. При изменении пера пересобери шрифты командой `uv run tools/build_pencil_font.py`.

Подробные API: [композиция объяснения](docs/explanations.md), [тензоры](docs/tensors.md), [морфинг](docs/morphing.md), [физика](docs/physics.md), [персонажи](docs/characters.md), [документные уроки](docs/lessons.md), [SVG-предметы](docs/svg-artwork.md). Сокращение каталога не меняет эти экспорты. Небольшие регрессионные сцены находятся в `tests/fixtures/` и в пакет не входят.

## Review и выпуск

В каталоге подготовленной копии GPT:

```sh
npx visual-story review dist --cue attention --out artifacts/review
npx visual-story review inspect artifacts/review --at 36
npx visual-story review inspect artifacts/review --list changes --limit 5
npx visual-story review inspect artifacts/review --change largest --view pair
npx visual-story review inspect artifacts/review --frame 12 --step -1 --view onion
npx visual-story review inspect artifacts/review --frame 12 --list objects --search 'подпись'
npx visual-story review inspect artifacts/review --frame 12 --object ID --crop auto --max-size 0
npx visual-story export dist --format png --time 36 --out artifacts/gpt.png
npx visual-story deliver . --out artifacts/release --formats html,png,svg,mp4,source --from 42 --to 44 --width 960 --fps 24 --silent
```

Review сохраняет кадры, состояния и карту эпизодов; `inspect` читает эти же данные. HTML содержит код, шрифты и ресурсы и работает офлайн. PNG/SVG сохраняют рисунок без плеера; видео имеет тот же кадр 16:9. `--from/--to` выбирают отрезок, без них выпускается весь рассказ. Исходный архив содержит редактируемую сцену и закреплённый runtime. Для озвученного проекта доступны `srt/vtt` и общая дорожка речи; `--silent` выпускает тихий вариант.

## Проверки

```sh
npm run build
npm run check
npm test
npm run test:tools
npm run test:browser
npm run test:delivery
```

`npm test` сначала пересобирает локальный release-пакет для plugin-тестов. Браузерные проверки используют Chromium (`npx playwright install chromium`); видеовыпуск также требует FFmpeg. `test:delivery` создаёт отдельного потребителя пакета, проверяет API, автономный GPT, review, SVG/PNG/MP4 и повторную сборку исходного архива. Результаты — в `artifacts/delivery/`. Для нативного плагина дополнительно нужна [приёмка в Codex](docs/codex-plugin-tdd.md#приёмка).

Действующий [навык](skills/visual-explainer/SKILL.md), CLI, документация и эталон поставляются из одного исходника. Авторский код — [0BSD](LICENSE); условия сторонних компонентов сохранены в [THIRD_PARTY.md](THIRD_PARTY.md).
