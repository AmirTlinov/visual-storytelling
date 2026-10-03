# Физические объекты

`./physics/2d` и `./physics/3d` подключают Rapier 0.21 (WASM) отдельно от основного пакета. Агент задаёт форму, материал, массу и связи; общий solver рассчитывает столкновения и деформацию. Примеры: [SVG](../examples/physical-objects/index.ts) и [Three.js](../examples/physical-objects/three.ts).

```ts
import { Physics2D, PhysicsPlayer } from '@visual-storytelling/core/physics/2d';

const world = await Physics2D.create();
const ink = Physics2D.ink(world, drawing, { scale: 100 }); // drawing — существующий surface
ink.body('floor', {
  shape: { box: [8, 0.16] },
  at: [4, 3],
  fixed: true,
  pigment: 'ink',
});
const drop = ink.body('drop', {
  shape: { circle: 0.4 },
  at: [4, 1],
  material: 'jelly',
  pigment: 'blue',
  label: 'm',
});
const player = PhysicsPlayer.mount(playerElement, world);
drop.impulse([0.5, -1]); // автоматически запускает плеер
```

`solid` сохраняет форму, `rubber` пружинит, `jelly` заметно сминается. Пресеты предназначены для объяснений. Собственный материал задаёт `friction`, `restitution` (0…1), `damping` и необязательную `softness` в Гц; выше частота — жёстче деформируемое тело. Пигмент и физический материал независимы.

2D-формы: `{ circle: radius }`, `{ box: [width, height] }`, `{ polygon: [[x, y], ...] }`. Размеры и положения — метры, масса — кг, время — секунды. Ось Y в 2D направлена вниз; `scale` задаёт пиксели на метр. Контур и коллайдер получают одну форму. Мягкая граница сохраняет seeded-почерк и маркер, подпись остаётся читаемой. Перетаскивание и толчки стрелками включены по умолчанию; `draggable: false` отключает ввод.

```ts
import { Physics3D, PhysicsPlayer } from '@visual-storytelling/core/physics/3d';

const world = await Physics3D.create();
const objects = Physics3D.meshes(world, viewport);
const body = objects.body('ball', existingMesh, { material: 'rubber', cellSize: 0.2 });
const player = PhysicsPlayer.mount(playerElement, world);
```

3D использует метры и Y вверх. Привязка сохраняет материалы, UV, индексы и детей Mesh; деформируемое тело получает отдельную копию геометрии. Швы вершин соединяются только для расчёта. `cellSize` управляет внутренней сеткой независимо от видимой детализации: меньшая ячейка повышает стоимость симуляции. Нужна замкнутая поверхность; физику подключают после задания исходной позы и масштаба. Родитель объекта сохраняет свой transform во время симуляции. Захват временно передаёт управление от камеры телу.

`world.body` создаёт тело без визуального представления: круг/прямоугольник/полигон в 2D; сфера, коробка или замкнутая треугольная сетка в 3D. `world.spring(a, b, { length, stiffness, damping })` связывает центры тел; опоры задаются через `fixed: true`. `body.position`, `body.rigid`, `body.soft` читают актуальное состояние, включая после сброса. Низкоуровневые настройки доступны через эти handles и `world.raw`; после ручной смены топологии вызывают `world.topologyChanged()`.

Часы принадлежат существующему `SimulationPlayer`: фиксированный шаг 1/120 с, ограниченное наверстывание после задержки, пауза при скрытии страницы и засыпании. `PhysicsPlayer` автоматически начинает движение при взаимодействии и возвращает `play`, `pause`, `step`, `reset`, `dispose`. Монтируй его после создания тел и связей. При собственном владельце времени вызывай `world.advance(deltaSeconds)`; отдельный RAF библиотеке не нужен.

`world.snapshot()` / `world.restore(snapshot)` дают повтор того же мира с тем же набором тел и связей. Создание и восстановление снимка освобождают текущий захват, исключая временные связи курсора. Для произвольного времени объяснения восстанови исходный снимок и вызови `world.step(Math.round(time * 120))`. Снимки содержат состояние WASM и предназначены для этой сессии.

Мир имеет один `PhysicsPlayer`, поверхность — одну физическую привязку, Mesh — одно физическое тело. Повтор восстанавливает начальный снимок; изменение состава тел или связей задаёт новое начальное состояние при следующем запуске или сбросе.

`world.dispose()` удаляет физику, привязки и её плеер. Удаление SVG-поверхности, `Viewport3D` или замена его объекта освобождает связанные тела. `body.dispose()` также отпускает захват и удаляет пружины этого тела; `spring.dispose()` снимает отдельную связь. Повторное удаление безопасно. Для собственных ресурсов есть `body.onDispose(cleanup)` и `view.onDispose(cleanup)`.

Для слияния текста и фигур есть [`Physics2D.fusion`](../examples/ink-fusion/README.md): Rapier деформирует небольшие управляющие сетки, а `InkFusion` сопоставляет штрихи и соединяет поверхности. Привязка принимает детерминированный `frame(time)` и использует существующий таймлайн; история смещений обеспечивает обратную перемотку.

Проверка: после `npm run build` — `node --test tests/physics.test.mjs` и `npx playwright test tests/browser/physics.spec.js`.
