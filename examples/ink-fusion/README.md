# Живые чернила

Один `InkFusion` соединяет слова, отдельные буквы и геометрические капли. Сцена задаёт тексты, положения и время; пакет вычисляет контакты и промежуточные силуэты.

```ts
import { InkFusion } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

await document.fonts.load('100px SketchPencil');
const ink = InkFusion.mount(stage, { width: 840, height: 300 });
ink.setShapes(InkFusion.text('свет'), InkFusion.text('тень'), InkFusion.text('объём'));
ink.render({ sources: [{ x: -90, y: 0 }, { x: 90, y: 0 }], tension: 36, morph: 0 });
// После сближения оставь позы источников неподвижными и меняй morph от 0 до 1.
// ink.prepare(frame) заранее рассчитывает поправку площади перед воспроизведением.
// При удалении сцены: ink.dispose().
```

`InkFusion.shape(width, height, paint)` принимает произвольную маску Canvas 2D: путь, изображение или фигуру. Размеры, координаты, `tension` и размер шрифта заданы в единицах сцены. Поза поддерживает `scale` и `rotation` в радианах. Поверхность вписывает сцену без искажения пропорций; HTML-контейнеру нужна высота.

Поля расстояний объединяются с контактной перемычкой. При морфинге диффузионное сглаживание округляет поверхность, а изолиния подбирается по интерполированной площади чернил. В начале и конце сохраняются исходные силуэты. `tension: 0` отключает перемычку. Время принадлежит общему `transport` / `player`; поверхность рисует по запросу.

Из корня библиотеки:

```sh
npm run build
npm run preview
# /ink-fusion/index.html
node tools/scene.mjs pack site/ink-fusion --out artifacts/ink-fusion.html
node tools/scene.mjs new /absolute/output/ink-fusion --example ink-fusion
```
