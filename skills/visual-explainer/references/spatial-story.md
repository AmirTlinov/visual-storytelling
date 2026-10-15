# Целое, место и деталь

[Путь заказа](../../../examples/spatial-order/scene.js) использует один StoryDocument,
вычисленный dependency-route и три обычные IllustratedStory-фабрики. Контуры страны
и региона сохранены из закреплённого Natural Earth; устройство условное. Регион
поднимается по своему контуру как выделение. Местные размеры учитывают проекцию
и широту. Координаты, модель и ограничения доступны через «Условия».

`shotPlan3D(chapter.script, initial, [{cue, shot, move}])` фиксирует authored from/to
и envelope. `at(frame.time, frame.reduced)` отдаёт shot и общий `amount` для камеры,
подъёма и раскрытия детали. `move` задаёт секунды либо `{fraction, maxSeconds}`:
доля фактического cue с верхним пределом. Для опциональной озвучки используй
второй вариант: короткая реплика сохраняет движение и резерв наблюдения.
Остаток cue после `move` — время наблюдения. Предыдущий
постановочный ракурс берётся из плана; ручной ракурс хранит существующий SceneView.
Fit/shot/reset используют один solver. Для point-sized envelope задай referenceScale.

```js
const plan = shotPlan3D(chapter.script, { target: countryBounds }, [
  { cue: 'region', shot: { target: regionBounds }, move: { fraction: 0.85, maxSeconds: 3 } },
  { cue: 'device', shot: { target: deviceBounds }, move: { fraction: 0.85, maxSeconds: 3 } },
]);
// Обычный render IllustratedChapterPresentation:
const pose = plan.at(frame.time, frame.reduced);
region.position.y =
  rise *
  (frame.time < chapter.script.cues.region.start ? 0 : pose.cue === 'region' ? pose.amount : 1);
view.shot(pose.shot);
```

Bounds в примере включают конечный подъём. Отдельные метки измеряет Viewport3D;
target-object с bounds резервирует и скрытые метки. Уменьшай реальное тело и
приближай камеру. Не заменяй географический размер масштабированием макета по времени.

[Куб и сечение](../../../examples/cube-section/scene.js) проверяют тот же план на
точной геометрии. Модель `cubeSection(z)` вычисляет пересечение и площадь; рисунок
читает её вершины. Это параллельное грани сечение, не произвольная плоскость.

Каждая фабрика возвращает `view`, `ready:view.whenRendered` и `dispose:view.dispose`.
Неудачный mount освобождает view через `releaseResources`, сохраняя исходную ошибку.
SceneStory удерживает текущий и один соседний вид; время, selection и subject живут
дольше геометрии. `dependencyObservation` отличает расчёт маршрута от достигнутого
результата. Packet следует `InkConnection3D.route` через общий `tracePath`.

Для тихого ролика достаточно одной короткой фразы в кадре:
`captions:{placement:'overlay'}` сохраняет её в PNG/MP4 и держит физическую крупность.
Проверь место для неё в insets камеры. Озвучка выбирается отдельно и не требуется
для создания, исследования или экспорта.

Проверь полный ход, обратный seek, ручной ракурс и возврат,390/1200 px, обе темы,
reduced motion, повтор одного момента после разных seek и освобождение GPU.
После нескольких смен вида модель, смысловые ID и provenance должны сохраняться.
