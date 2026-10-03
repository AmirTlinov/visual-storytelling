# Объёмный морфинг

54-секундный рассказ: кубик → шар, два кубика → брусок, кубик и шар → капсула. Рисунок, озвучка, главы, вращение и перемотка используют общие `SceneShell` и `Viewport3D`.

`VolumeMorph` из `@visual-storytelling/core/three` показывает единую поверхность поля расстояний. GPU находит её методом sphere tracing для каждого экранного луча; плоскости и углы сохраняются при перемещении и увеличении. Рисованный слой использует нормали того же поля для рёбер, тонкого силуэта и пигментов граней. Контактная перемычка соединяет близкие поверхности; общие плоские грани кубиков сохраняются при слиянии. Это управляемый геометрический морфинг; физические столкновения и сохранение массы в него не входят.

```js
const morph = VolumeMorph.mount(view, {
  bounds: new ThreeKit.Box3(new ThreeKit.Vector3(-3, -2, -2), new ThreeKit.Vector3(3, 2, 2)),
  pigment: 'blue',
});
group.add(morph.object);
morph.setShapes(
  [VolumeMorph.box([1, 1, 1]), VolumeMorph.sphere(0.5)],
  VolumeMorph.capsule(0.55, 2.2),
);
// Из render() рассказа; p и расстояние задаёт предметная сцена.
morph.render({
  sources: [{ position: [-distance, 0, 0] }, { position: [distance, 0, 0] }],
  morph: p,
  tension: 0.5,
});
```

Формы задаются декларативно: `box([width,height,depth], rounding)`, `sphere(radius)`, `capsule(radius,length)` вдоль X. Размеры описывают внешние границы, длина капсулы включает округлые концы. Позы поддерживают `position`, Euler `rotation` XYZ в радианах и положительный равномерный `scale`. `target` задаёт позу результата.

`morph` меняется от 0 до 1; `tension: 0` отключает контактную перемычку. `bounds` охватывает все формы, позы и перемычку с небольшим запасом в локальных координатах объекта. При изменении кадра обновляются параметры поля в GPU; точность поверхности и толщина штриха следуют экранному масштабу. Параметры проверяются до применения: ошибочный кадр сохраняет предыдущую форму.

Замена корневого объекта через `view.setObject()` и закрытие viewport освобождают морф автоматически. При отдельном удалении из Three.js-группы вызывай `morph.dispose()`. Один экземпляр переиспользуется через `setShapes` между главами.

```sh
npm run build
node tools/scene.mjs preview site/volume-morph --port 8822
node tools/scene.mjs pack site/volume-morph --out artifacts/volume-morph.html
```
