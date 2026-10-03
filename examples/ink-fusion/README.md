# Живые чернила

`InkFusion` направляет штрихи двух исходных форм прямо в результат. Сопоставление, деление и соединение линий рассчитываются автоматически; сцене принадлежат тексты, положения и время.

```ts
import { InkFusion } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

await document.fonts.load('100px SketchPencil');
const ink = InkFusion.mount(stage, { width: 840, height: 300 });
ink.setShapes(InkFusion.text('свет'), InkFusion.text('тень'), InkFusion.text('объём'));

// Вызывай из общего transport: начинай morph уже при сближении.
function frame(progress) {
  ink.render({
    sources: [
      { x: -140, y: 0 },
      { x: 140, y: 0 },
    ],
    target: { x: 0, y: 0 },
    morph: progress, // 0 — исходные штрихи; 1 — результат
    tension: 36,
  });
}
// При удалении сцены: ink.dispose().
```

Текст сопоставляется по словам, затем по буквам и штрихам. Каждый исходный текст направляется в результат отдельно; совпадающие слова сохраняют свои линии. Добавляемые слова растут из чернил, а формы букв и расстояния между словами устанавливаются в начале перехода. GPU соединяет близкие поверхности локальными перемычками, сила которых уменьшается вместе со сборкой текста. Почерк `SketchPencil` использует исходные векторные штрихи шрифта.

`InkFusion.text(value, { size, maxWidth, lineHeight, align, font })` переносит слова по ширине и сохраняет явные переносы, включая пустые строки. Размер шрифта остаётся заданным. Для абзацев используй `align: 'left'`; высота готового блока доступна в `shape.bounds.height`. После изменения контейнера пересоздай текст с новой `maxWidth` и вызови `ink.setSize(width, height)`. Пример содержит слова, предложения, абзацы и многострочные поля для собственного текста.

`InkFusion.shape(width, height, paint)` принимает маску Canvas 2D: путь, изображение или фигуру. Для неё строится приближённая осевая геометрия с локальной толщиной; линии сопоставляются по положению, длине и очертаниям. Размеры, координаты и `tension` заданы в единицах сцены; поза поддерживает `scale` и `rotation` в радианах. `tension: 0` отключает контактные перемычки. Контейнеру нужна высота; рендереру — WebGL 2. Своего таймера у поверхности нет.

```sh
npm run build
npm run preview
# /ink-fusion/index.html
node tools/scene.mjs pack site/ink-fusion --out artifacts/ink-fusion.html
node tools/scene.mjs new /absolute/output/ink-fusion --example ink-fusion
```
