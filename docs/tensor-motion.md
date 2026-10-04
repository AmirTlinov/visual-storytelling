# Движение тензоров

`@visual-storytelling/core/three` перемещает существующие ячейки:

- `arrangeTensorRows(rows, destinations)` перемещает исходные ряды в свободные полосы, затем сближает их по горизонтали; соединение не создаёт копию результата.
- `deliverTensorCells(output, {from, start, end})` переносит сами принимающие ячейки и оставляет их в точке назначения; `from` задаётся в локальных координатах группы результата.

Создай действие один раз; в `render` передавай прогресс реплики. Все положения и видимость восстанавливаются при обратной перемотке. Предметная модель хранит числа; действие получает `TensorHandle` с `group`, `cells: {box, base, text?}[]`, `reveal` и необязательной `titleLabel`. Вычислением и превращением операндов в результат владеет [MathMorph](morphing.md#числовые-ячейки).

```js
const deliver = deliverTensorCells(row, {
  from: row.cells.map((cell) => [cell.base.x, cell.base.y + 0.65, cell.base.z]),
});
// В render перемещаются те же ячейки; отдельная копия результата не создаётся.
deliver(frame.progress('place_cells'));
```

Оставь свободные полосы движения и зазоры между неподвижными и движущимися ячейками.

`readableFrame(camera, {center, direction, width, height, minimum, insets, anchors})` сохраняет авторскую область и подбирает минимальное отдаление/смещение для полностью видимых объектов и подписей. `geometryFrameAnchors(groups)` собирает видимую геометрию; экранная подпись добавляет `{position, padding: [halfWidth, halfHeight]}`. В `insets` зарезервируй реальную область заголовка и плеера; возвращённые `position` и `target` применяй к камере и её контроллеру.
