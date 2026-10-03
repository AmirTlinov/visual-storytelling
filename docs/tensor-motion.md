# Движение тензоров

Для новой сцены начни с [TensorView, vectorOperation и tensorSlice](../skill/references/spatial-math.md): они владеют геометрией, числами, переносом и читаемостью. Для уже существующей предметной геометрии `@visual-storytelling/core/three` даёт действия над её ячейками:

- `arrangeTensorRows(rows, destinations)` перемещает исходные ряды в свободные полосы, затем сближает их по горизонтали; соединение не создаёт копию результата.
- `calculateTensorColumns(inputs, output, {lift, parallel})` выделяет пары, выдерживает вычисление и опускает по одной готовой ячейке; `parallel: true` обрабатывает координаты одновременно.
- `deliverTensorCells(output, {from, start, end})` переносит сами принимающие ячейки и оставляет их в точке назначения; `from` задаётся в локальных координатах группы результата.

Создай действие один раз; в `render` передавай прогресс реплики. Все положения, видимость и фазы восстанавливаются при обратной перемотке; повторно рисовать статичный результат под движущимся нельзя. Предметная модель хранит числа; действие получает `TensorHandle` с `group`, `cells: {box, base, text?}[]`, `reveal`, `highlight` и необязательной `titleLabel`.

```js
const calculate = calculateTensorColumns([input, weights], products, { lift: 0.65 });
// render: численное равенство появляется после вычисления и до посадки ячейки.
const phase = calculate(frame.progress('multiply'));
equation.text(
  phase.evaluated
    ? `${a[phase.index]} × ${b[phase.index]} = ${productsData[phase.index]}`
    : `${a[phase.index]} × ${b[phase.index]}`,
);
```

Оставь свободное место между нижним операндом и позицией рождения результата (`lift`), и между полосами движения. Переход переносит смысл и идентичность числа; числовое сложение не требует проникновения одного кубика внутрь другого.

`readableFrame(camera, {center, direction, width, height, minimum, insets, anchors})` сохраняет авторскую область и подбирает минимальное отдаление/смещение для полностью видимых объектов и подписей. `geometryFrameAnchors(groups)` собирает видимую геометрию; экранная подпись добавляет `{position, padding: [halfWidth, halfHeight]}`. В `insets` зарезервируй реальную область заголовка и плеера; возвращённые `position` и `target` применяй к камере и её контроллеру.
