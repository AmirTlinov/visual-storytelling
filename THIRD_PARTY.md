# Источники

Авторский код и документация проекта распространяются по [BSD Zero Clause License (0BSD)](LICENSE). Сторонние компоненты и ресурсы сохраняют перечисленные ниже лицензии и атрибуцию.

| Ресурс                                                      | Версия / происхождение                                                                                                      | Условия                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rough.js](https://github.com/rough-stuff/rough)            | 4.6.6, контуры и штриховка                                                                                                  | MIT, лицензия в установленном пакете.                                                                                                                                                         |
| [GSAP](https://gsap.com/docs/v3/GSAP/gsap.utils/)           | 3.15.0, интерполяция                                                                                                        | [Standard GSAP License](https://gsap.com/community/standard-license/): разрешены коммерческие проекты и генерация кода AI; есть ограничения для конкурирующих визуальных редакторов анимации. |
| [Shantell Sans](https://github.com/arrowtype/shantell-sans) | Локальный WOFF2 из visual-explainer                                                                                         | SIL OFL 1.1: [текст](dist/assets/shantell-OFL.txt), включён в поставку.                                                                                                                       |
| Sketch Pencil WOFF2                                         | Три авторских WOFF2 (`pencil`, `pencil-heading`, `pencil-note`) из `src/ink/glyphs.ts` и `src/ink/handwriting.ts`                                               | Основной почерк интерфейса и источник метрик; Shantell используется для отсутствующих знаков.                                                                                                 |
| Маркер и палитра                                            | `src/ink/marks.ts` и `src/styles/`                                                                                          | Перенесены в общие владельцы `src/ink` и `src/style.css`.                                                                                                                                     |
| Однолинейные буквы                                          | Авторские штрихи из visual-explainer, `src/ink/glyphs.ts`                                                                   | Перенесены в `src/ink/glyphs.ts`, дополнены и оформлены как плотные чернила.                                                                                                                  |
| Озвученные рассказы                                         | `examples/*/narration.json`, голос Higgs TTS 3 и акустические метки `timeline.json`                                         | Атрибуция голоса и музыки — в `CREDITS.txt` каждого рассказа; упаковка сохраняет её.                                                                                                          |
| Образец рассказчика                                         | `src/assets/audio/narrator-male.wav`: принятая цельная реплика Higgs TTS 3; точная расшифровка в `tools/audio/resources.py` | Тот же мужской голос; образец задаёт живую манеру дальнейшего синтеза. Атрибуция Boson AI сохраняется в каждом рассказе.                                                                      |
| [mathjs](https://mathjs.org/)                               | 15.2.0, разбор выражений, скалярные/матричные функции и символическая производная                                           | Apache-2.0, лицензия в установленном пакете.                                                                                                                                                  |
| [Three.js](https://github.com/mrdoob/three.js)              | 0.186.1, WebGL, OrbitControls и GLTFLoader                                                                                  | MIT, лицензия в установленном пакете.                                                                                                                                                         |
| [Draco](https://github.com/google/draco)                    | glTF-декодер из закреплённого Three.js 0.186.1; включается в пакет и автономный HTML                                        | Apache-2.0, источник и условия в `three/examples/jsm/libs/draco/README.md`.                                                                                                                   |
| [Rapier](https://github.com/dimforge/rapier.js)             | 0.21.0, отдельные `rapier2d-compat` / `rapier3d-compat`, столкновения и мягкие тела в WASM                                  | Apache-2.0, лицензии в установленных пакетах.                                                                                                                                                 |
| [Sharp](https://sharp.pixelplumbing.com)                    | 0.35.5, декодирование, масштаб и PNG для проверки движения                                                                  | Apache-2.0, лицензия в установленном пакете.                                                                                                                                                  |
| [Playwright](https://github.com/microsoft/playwright)       | 1.63.0, браузерный захват, экспорт и проверка сцен                                                                          | Apache-2.0, лицензия в установленном пакете.                                                                                                                                                  |
| [parse5](https://github.com/inikulin/parse5)                | 8.0.1, разбор HTML/SVG при автономной упаковке                                                                              | MIT.                                                                                                                                                                                          |
| [esbuild](https://github.com/evanw/esbuild)                 | 0.28.2, сборка страниц                                                                                                      | MIT.                                                                                                                                                                                          |

Зависимости разработки закреплены в `package-lock.json`. Пакет помечен `private`; публичная публикация в этой версии не выполняется.

## Профиль плагина

Локальная поставка плагина включает Node.js и npm с `runtime/NODE-LICENSE`, лицензиями npm и его зависимостей. Лицензии SDK MCP, MCP Apps, OpenAI Extensions и их фактически включённых зависимостей собираются в `plugin/dist/THIRD_PARTY_NOTICES.txt`. Остальные исполняемые зависимости сохраняют notices в `node_modules`.

Профиль `.plugin-release` содержит общий API, персонажей glTF/SVG, авторский инструмент Higgs и закреплённые Python-зависимости. Модели, Python, Chromium и FFmpeg подготавливаются по запросу; музыка загружается при её использовании. Каталог и исходники примеров совпадают с библиотекой.

Сборка HTML переносит тексты LICENSE/NOTICE фактически включённых пакетов; вложенный Draco сохраняет Apache-2.0. Они лежат рядом с JS в `*.LICENSE.txt` и входят в автономный HTML. Локальные виртуальные окружения, кэши и служебные каталоги автора в release не копируются.

Системная озвучка использует установленные на Mac голоса через AVSpeechSynthesizer; веса голосов в комплект не включаются. Бинарник адаптера собран из `tools/voice/macos.swift` (0BSD). Доступность языков определяется установленными голосами.

Первое видео отдельно загружает Chrome Headless Shell 153.0.8010.12 из официального Chrome for Testing CDN и FFmpeg 8.0.3-build4 из [AtlasYang/ffmpeg-static-builds](https://github.com/AtlasYang/ffmpeg-static-builds/releases/tag/ffmpeg-8.0.3-build4). URL, SHA-256 и пути закреплены в `plugin/environment.mjs`; receipt сохраняет источник, версию и хеш бинарника. FFmpeg-сборка имеет LGPL-профиль без GPL/nonfree компонентов; исходники и сборочные инструкции доступны у поставщика. Видео кодируется системным VideoToolbox. Chromium сохраняет собственные notices в архиве. Эти загрузки не входят в установочный архив плагина.

## Персонажи

Редактируемый `rig.gltf` и клипы преобразованы из public-domain проекта Chibi Stickers
(Esoteric Software, 2022). [Уведомление](src/assets/characters/chibi/LICENSE.txt)
сохраняет происхождение исходного рига. Все распространяемые рисунки созданы в
Visual Storytelling и имеют лицензию 0BSD; атласы строятся только из этих SVG.
Скелет, деформация, смешивание и рендеринг используют Three.js по MIT.

## Подготовка голоса

`plugin/environment.mjs` закрепляет uv 0.11.3 и SHA-256 официального архива Astral.
uv распространяется по MIT/Apache-2.0; уведомления поставляются в его архиве.
Python 3.12.13 устанавливается управляемым uv-комплектом; зависимости и хеши
закреплены в `tools/uv.lock`. Модели Higgs и русского выравнивания закреплены в
`tools/audio/models.json`; подготовка сохраняет LICENSE/README поставщика и
проверяет Git/LFS digest каждого загруженного файла. Атрибуция синтезированной
речи сохраняется в `CREDITS.txt` выпуска.
