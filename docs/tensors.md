# Тензор, срез и вычисление

[Выбор дня](../examples/tensor-slices/scene.js) показывает один набор измерений и
его срез. [Откуда взялся результат?](../examples/math-workbench/scene.js) связывает
перестановку осей, выбор канала, вычисление и адрес результата.

```js
import { TensorData, MathMorph } from '@visual-storytelling/core';
import { Tensor3D, TensorSlice3D, MathMorph3D } from '@visual-storytelling/core/three';

const data = new TensorData({
  id: 'measurements',
  shape: [2, 2],
  values: [2, 8, 4, 6],
  axes: ['точка', 'канал'],
});
const source = Tensor3D.mount(view, data, { id: 'measurements', title: 'Измерения' });
const channel = TensorSlice3D.mount(view, source, {
  id: 'channel',
  title: 'Первый канал',
  select: (data) => data.transpose([1, 0]).slice(0, 0),
});
channel.object.position.y = -3;
const calculation = MathMorph3D.mount(view, MathMorph.dot(channel.result.data, [0.5, 0.5]));
// В Story.render из одних часов:
channel.render(frame.progress('extract'), frame.reduced);
calculation.render(frame, 'calculate');
```

`TensorData` — неизменяемый математический снимок. `shape` и `axes` задают размеры
и имена осей; `values` содержат конечные числа в порядке последней оси. `shape: []`
задаёт скаляр. `at`, `indices`, `offset` обращаются к текущей форме; `slice(axis,index)`,
`transpose(order)` и `reshape(shape,axes?)` сохраняют отображение исходных адресов.
`origin(i)` возвращает исходные `tensor`, `address`, `index`, `value`;
`originId(i)` — устойчивый ID ячейки. `toValue()` даёт число или вложенные массивы
общего `MathValue`. Вычисления принадлежат `MathMorph`.

При изменении входа создавай новый снимок с тем же `id` и передавай его в
`source.setData(next)`. Связанный `TensorSlice3D` обновляет выборку и сохраняет
текущий прогресс. Пересчитывай операцию из `channel.result.data` в том же
предметном шаге. Значения представлений читаются из модели. Неверная выборка
отклоняется до изменения источника. `setSelection(select)` меняет саму выборку.

`Tensor3D` представляет до трёх осей; для большей размерности сначала выбери
срез. `columns` переносит вектор по строкам, сохраняя логический адрес.
`object`, `cell(...address).box` и `cells[i].base` доступны для постановки и
[движения](tensor-motion.md). Подписи, цвета, камера, выбор и освобождение ресурсов
принадлежат существующему viewport. `bounds` описывает полную область покоя в
мировых координатах; `slice.bounds` также включает источник и путь извлечения.
`view.shot({ target: group, bounds: slice.bounds })` сохраняет охват движения и
учитывает размеры подписей, включая заголовки, которые появятся позже.

ID исходного представления совпадает с `data.id`; у срезов и перестановок свои
ID представлений. `root.scene.inspect()` сохраняет ссылки на исходные ячейки.
`MathMorph.dot` и `vectorAdd` принимают одномерный `TensorData`; `formula` принимает
тензоры через тот же вычислитель. Происхождение находится в `MathOrigin.source`.
Формула сохраняет непосредственные `MathPart.inputIds` каждого результата:
поэлементная операция связывает соответствующие ячейки, матричное произведение —
нужные строку и столбец. `originPrecision: 'conservative'` обозначает входы
непрозрачного вызова; инспектор показывает эту ограниченную точность.

Для записи скалярного результата передай `receiver.cell(...address).box` в
`MathMorph3D.delivery`. Доставка владеет видимостью этой ячейки до и после прибытия.
Получатель берёт значение из `calculation.plan.result`; `Tensor3D` опция
`inputs: () => ['calculation']` связывает его с семантикой вычисления.
Срез освобождается вместе с источником, все представления — вместе с viewport.

Проверяй изменение входа после извлечения, исходные адреса после перестановки,
обратную перемотку, вращение во время рассказа и быструю смену операции.
