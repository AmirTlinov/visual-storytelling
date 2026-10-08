# Рассказ и подробный урок

`StoryDocument` из `@visual-storytelling/core/story` хранит главы и действия.
Видимый `text` обязателен; `say` задаёт отличающуюся реплику. Без озвучки работают
тихие метки: `seconds` или длительность чтения. `timing` растягивает действие до
следующей метки либо на заданное число секунд. Голос добавляет выровненные слова
к тому же документу; вводных пауз и переходов по умолчанию нет.

```js
import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
import { areaDiagram } from '@visual-storytelling/core/recipes';

await IllustratedStory.mount(root, {
  document: {
    title: 'Площадь прямоугольника',
    chapters: [{ id: 'area', title: 'Считаем единичные квадраты', beats: [
      { id: 'count', text: 'Три квадрата в каждом из двух рядов дают шесть.', seconds: 5 },
    ] }],
  },
  chapters: {
    area: chapter => inkChapter({
      ...chapter,
      valuesAt: () => ({ width: 3, height: 2 }),
      create: view => areaDiagram(view),
    }),
  },
});
```

[Площадь](../examples/area-lesson/scene.js) — готовый урок с прогнозом и опытом.
`predictionPrompt` из `/controls` отображает выбор, действие и обратную связь.
Предположение, проверка и ответ принадлежат модели сцены. Ответ открывается после
действия; возврат к метке восстанавливает исходное задание. `details` рядом с
рисунком раскрывает объяснение без потери общего контекста.

## Представления глав

`SceneStory` принимает `SceneChapter`; `IllustratedStory` строит эти главы из
документа через именованные фабрики. `chapter` и `sceneTime` зарезервированы общим
исследованием. Параметры `controls` и `valuesAt` задают доступные условия и их
значения в рассказе. `script` подключает готовую речевую разметку, `audio` — звук.

- `inkChapter` сохраняет живой SVG, сетку, доступность и команды. `create` может быть
  асинхронным; `size` задаёт координаты, иначе размеры приходят в CSS px.
- `characterChapter` из `/characters` принимает `CharacterStageOptions` вместе с
  `id`, `title` и локальной разметкой. [Цепь](../examples/tesla-circuit/scene.js) и
  [термостат](../examples/thermostat-story/scene.js) связывают героя с живой схемой.
- `physicsChapter` из `/physics/2d` владеет `PhysicsReplay`, обратной перемоткой и
  освобождением мира. [Общий урок](../examples/character-lesson/scene.js) соединяет
  персонажей, измерения и опыт.

Собственное представление реализует `mount → render/capture/snapshot/dispose`.
`capture` фиксирует вход до первого `await`. Общий владелец готовит главы по мере
надобности и освобождает их; время, параметры, речь и экспорт остаются общими.
После прямого `seek` дождись `scene.ready()`; `scene.control` ждёт показ сам.

`documentNarration` готовит речевое задание, `documentScript` сохраняет точные
границы выровненных глав, `documentChapter` даёт локальное время речи и действия.
Справка по выпуску и проверке — в [контракте автора](authoring.md).
