# Visual Storytelling

TypeScript-библиотека наглядных объяснений и локальный плагин для Codex. Модель, рисунок, рассказ и ручной ввод связаны через один `root.scene`. Интерактив и видео используют общий кадр 16:9; плеер под рисунком сохраняет удобный размер. Основные штрихи — нейтральные чернила, почерк прямой, цвет связывает смысловые роли.

В комплекте один законченный эталон — [«Как GPT выбирает следующее слово»](examples/gpt-model/scene.js). Он раскрывает токены, представления, attention, residual stream, MLP и выбор продолжения через локальную учебную модель с открытыми весами. [Модель](examples/gpt-model/model.js), [рисунок](examples/gpt-model/drawing.js) и [вычисления](examples/gpt-model/computation.js) читают одни данные. Это небольшая обученная модель для объяснения устройства GPT; её границы показаны внутри сцены.

Новая тема начинается с нейтрального каркаса. SVG, 3D, морфинг, физика, персонажи, графики и документные уроки остаются общими возможностями библиотеки.

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

Авторский маршрут: `story_help → story_create → story_edit → story_review → story_open → story_produce`. `story_create` без `example` создаёт редактируемый каркас без карточки и сеанса; `example: "gpt-model"` явно копирует эталон. `story_open(projectId)` показывает подготовленную работу. Правки используют `sourceRevision` и уникальный `requestId`; повтор сохраняет исходный receipt. Голос, выпуск и обновление runtime выбираются в чате.

Проекты по умолчанию хранятся в `~/Library/Application Support/Visual Storytelling/projects` на Mac и `${XDG_DATA_HOME:-$HOME/.local/share}/visual-storytelling/projects` на Linux. Первая установка зависимостей использует npm registry; видео и озвучка подготавливают свои инструменты по необходимости. Озвучка необязательна: `story_voice` сообщает доступность и включает выбранного провайдера. [Формат сценария и голос](skills/visual-explainer/references/narration.md).

## Возможности и владельцы

| Область                  | Владелец                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Публичный API            | `src/index.ts` и экспорты `package.json`                                                  |
| Сцена, команды, снимок   | `src/scene-handle.ts`, `src/scene-checkpoint.ts`; один `root.scene`                       |
| Кадр и управление        | `src/scene-frame.ts`, `src/scene.ts`; рисунок 16:9 и отдельный плеер                      |
| Время и главы            | `src/story/`; `stateAt → derive → render`, принятый ввод и завершённый кадр               |
| SVG, письмо и палитра    | `src/ink/`, `src/styles/`, `src/assets/`; общий почерк для шрифтов и штрихов              |
| Раскладка и 3D           | `src/layout/`, `src/viewport/`; подписи, препятствия, камеры и тензоры                    |
| Превращения и вычисления | `src/morph/`, `src/math/`; `MathMorph`, `InkMorph`, происхождение результата              |
| Физика и персонажи       | `src/physics/`, `src/characters/`; Rapier, постановка и живые поверхности                 |
| Создание и ревизии       | `tools/create-scene.mjs`, `tools/project-files.mjs`; CLI и плагин используют один путь    |
| Сборка, review и выпуск  | `tools/`; установленный runtime, готовность сцены и атомарная публикация                  |
| Плагин                   | `plugin/runtime/`, `plugin/projects.mjs`, `plugin/jobs.mjs`; сеансы, транзакции и очередь |
| Предметный эталон        | `examples/gpt-model/`; модель и композиция принадлежат сцене                              |

[Архитектура](docs/architecture.md) раскрывает границы; [контракт автора](docs/authoring.md) — управление и восстановление; [PHILOSOPHY.md](PHILOSOPHY.md) — визуальный характер. При изменении пера пересобери шрифты командой `uv run tools/build_pencil_font.py`.

Подробные API: [композиция объяснения](docs/explanations.md), [тензоры](docs/tensors.md), [морфинг](docs/morphing.md), [физика](docs/physics.md), [персонажи](docs/characters.md), [документные уроки](docs/lessons.md), [SVG-предметы](docs/svg-artwork.md). Сокращение каталога не меняет эти экспорты. Небольшие регрессионные сцены находятся в `tests/fixtures/` и в пакет не входят.

## Review и выпуск

В каталоге подготовленной копии GPT:

```sh
npx visual-story review dist --cue attention --out artifacts/review
npx visual-story review inspect artifacts/review --at 36
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
