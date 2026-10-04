# Источники

| Ресурс                                                      | Версия / происхождение                                                                 | Условия                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Rough.js](https://github.com/rough-stuff/rough)            | 4.6.6, контуры и штриховка                                                             | MIT, лицензия в установленном пакете.                                                         |
| [GSAP](https://gsap.com/docs/v3/GSAP/gsap.utils/)           | 3.15.0, интерполяция                                                                   | Standard GSAP License, лицензия в установленном пакете.                                       |
| [Shantell Sans](https://github.com/arrowtype/shantell-sans) | Локальный WOFF2 из visual-explainer                                                    | SIL OFL 1.1: [текст](dist/assets/shantell-OFL.txt), включён в поставку.                        |
| Sketch Pencil WOFF2                                         | Авторский шрифт из `src/assets/pencil.woff2`, построен из `src/ink/glyphs.ts`          | Основной почерк интерфейса и источник метрик; Shantell используется для отсутствующих знаков. |
| Маркер и палитра                                            | `src/ink/marks.ts` и `src/styles/`                                                     | Перенесены в общие владельцы `src/ink` и `src/style.css`.                                     |
| Однолинейные буквы                                          | Авторские штрихи из visual-explainer, `src/ink/glyphs.ts`                              | Перенесены в `src/ink/glyphs.ts`, дополнены и оформлены как плотные чернила.                  |
| Озвученные рассказы | `examples/*/narration.json`, голос Higgs TTS 3 и акустические метки `timeline.json` | Атрибуция голоса и музыки — в `CREDITS.txt` каждого рассказа; упаковка сохраняет её. |
| Образец рассказчика | `src/assets/audio/narrator-male.wav`: принятая цельная реплика Higgs TTS 3; точная расшифровка в `tools/audio/resources.py` | Тот же мужской голос; образец задаёт живую манеру дальнейшего синтеза. Атрибуция Boson AI сохраняется в каждом рассказе. |
| [mathjs](https://mathjs.org/) | 15.2.0, разбор выражений, скалярные/матричные функции и символическая производная | Apache-2.0, лицензия в установленном пакете. |
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1, WebGL, OrbitControls и GLTFLoader | MIT, лицензия в установленном пакете. |
| [Draco](https://github.com/google/draco) | glTF-декодер из закреплённого Three.js 0.186.1; включается в пакет и автономный HTML | Apache-2.0, источник и условия в `three/examples/jsm/libs/draco/README.md`. |
| [Rapier](https://github.com/dimforge/rapier.js) | 0.21.0, отдельные `rapier2d-compat` / `rapier3d-compat`, столкновения и мягкие тела в WASM | Apache-2.0, лицензии в установленных пакетах. |
| [Sharp](https://sharp.pixelplumbing.com) | 0.35.5, декодирование, масштаб и PNG для проверки движения | Apache-2.0, лицензия в установленном пакете. |
| [Playwright](https://github.com/microsoft/playwright) | 1.63.0, браузерный захват, экспорт и проверка сцен | Apache-2.0, лицензия в установленном пакете. |
| [parse5](https://github.com/inikulin/parse5) | 8.0.1, разбор HTML/SVG при автономной упаковке | MIT. |
| [esbuild](https://github.com/evanw/esbuild) | 0.28.2, сборка страниц | MIT. |

Зависимости разработки закреплены в `package-lock.json`. Пакет помечен `private`; публичная публикация в этой версии не выполняется.
