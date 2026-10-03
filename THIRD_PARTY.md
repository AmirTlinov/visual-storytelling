# Источники

| Ресурс                                                      | Версия / происхождение                                                                 | Условия                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Rough.js](https://github.com/rough-stuff/rough)            | 4.6.6, контуры и штриховка                                                             | MIT, лицензия в установленном пакете.                                                         |
| [GSAP](https://gsap.com/docs/v3/GSAP/gsap.utils/)           | 3.15.0, интерполяция                                                                   | Standard GSAP License, лицензия в установленном пакете.                                       |
| [Shantell Sans](https://github.com/arrowtype/shantell-sans) | Локальный WOFF2 из visual-explainer                                                    | SIL OFL 1.1: [текст](src/assets/shantell-OFL.txt), включён в поставку.                        |
| Sketch Pencil WOFF2                                         | Авторский шрифт из `src/assets/pencil.woff2`, построен из `src/ink/glyphs.ts`          | Основной почерк интерфейса и источник метрик; Shantell используется для отсутствующих знаков. |
| Маркер и палитра                                            | `src/ink/marks.ts` и `src/styles/`                                                     | Перенесены в общие владельцы `src/ink` и `src/style.css`.                                     |
| Однолинейные буквы                                          | Авторские штрихи из visual-explainer, `src/ink/glyphs.ts`                              | Перенесены в `src/ink/glyphs.ts`, дополнены и оформлены как плотные чернила.                  |
| Рассказы о площади и остатке                                | Принятые пользователем реплики, голос и метки из `consistent-gallery/{area,remainder}` | Исходный WAV и акустические метки сохранены без перекодирования.                              |

| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1, WebGL, OrbitControls и GLTFLoader | MIT, лицензия в установленном пакете. |
| [Rapier](https://github.com/dimforge/rapier.js) | 0.21.0, отдельные `rapier2d-compat` / `rapier3d-compat`, столкновения и мягкие тела в WASM | Apache-2.0, лицензии в установленных пакетах. |
| [Sharp](https://sharp.pixelplumbing.com) | 0.35.5, декодирование, масштаб и PNG для проверки движения | Apache-2.0, лицензия в установленном пакете. |
| [esbuild](https://github.com/evanw/esbuild) | 0.27.5, сборка страниц | MIT. |

Зависимости разработки закреплены в `package-lock.json`. Пакет помечен `private`; публичная публикация в этой версии не выполняется.
