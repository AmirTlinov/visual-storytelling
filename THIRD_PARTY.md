# Источники

Авторский код и документация проекта распространяются по [BSD Zero Clause License (0BSD)](LICENSE). Сторонние компоненты и ресурсы сохраняют перечисленные ниже лицензии и атрибуцию.

| Ресурс                                                      | Версия / происхождение                                                                                                      | Условия                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rough.js](https://github.com/rough-stuff/rough)            | 4.6.6, контуры и штриховка                                                                                                  | MIT, лицензия в установленном пакете.                                                                                                                                                         |
| [GSAP](https://gsap.com/docs/v3/GSAP/gsap.utils/)           | 3.15.0, интерполяция                                                                                                        | [Standard GSAP License](https://gsap.com/community/standard-license/): разрешены коммерческие проекты и генерация кода AI; есть ограничения для конкурирующих визуальных редакторов анимации. |
| [Shantell Sans](https://github.com/arrowtype/shantell-sans) | Локальный WOFF2 из visual-explainer                                                                                         | SIL OFL 1.1: [текст](dist/assets/shantell-OFL.txt), включён в поставку.                                                                                                                       |
| Sketch Pencil WOFF2                                         | Авторский шрифт из `src/assets/pencil.woff2`, построен из `src/ink/glyphs.ts`                                               | Основной почерк интерфейса и источник метрик; Shantell используется для отсутствующих знаков.                                                                                                 |
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

Профиль `.plugin-release` исключает Spine/Chibi, связанные экспорты core, Higgs backend, модели голоса и озвученные демо. Библиотека в репозитории сохраняет эти возможности отдельно.

## Chibi и Spine

`./characters` использует `@esotericsoftware/spine-webgl` **4.3.13** и Chibi Stickers
из официальных примеров Spine 4.3. Скелет, ограничения и родные клипы сохранены.
Проект рига предоставлен в public domain. Исходные изображения примера допускают
перераспространение с уведомлением и **запрещают коммерческое использование**;
[исходная лицензия](src/assets/characters/chibi/LICENSE.txt) входит в пакет.
Нарисованные здесь SVG-детали Tesla/Mira — 0BSD; части SVG со встроенными исходными
изображениями, а также глаза, эмоции и эффекты сохраняют условия примера.

```text
Copyright (c) 2022, Esoteric Software LLC

The images in this project may be redistributed as long as they are accompanied
by this license file. The images may not be used for commercial use of any
kind.

The project file is released into the public domain. It may be used as the basis
for derivative work.
```

Интеграция runtime и создание продуктов/SDK регулируются
[Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license)
и применимой лицензией Spine Editor. Лицензия 0BSD этой библиотеки их не заменяет.
Ниже сохранено полное уведомление runtime; упаковщик включает этот документ в HTML.

```
Spine Runtimes License Agreement
Last updated April 5, 2025. Replaces all prior versions.

Copyright (c) 2013-2025, Esoteric Software LLC

Integration of the Spine Runtimes into software or otherwise creating
derivative works of the Spine Runtimes is permitted under the terms and
conditions of Section 2 of the Spine Editor License Agreement:
http://esotericsoftware.com/spine-editor-license

Otherwise, it is permitted to integrate the Spine Runtimes into software
or otherwise create derivative works of the Spine Runtimes (collectively,
"Products"), provided that each user of the Products must obtain their own
Spine Editor license and redistribution of the Products in any form must
include this license and copyright notice.

THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

```
