# Главы одного рассказа

`SceneStory` из `@visual-storytelling/core/story` соединяет разные представления
через один `Story`: время, речь, метки, параметры, исследование и экспорт.
`Storybook` из `./book` добавляет вступление Tlinov, короткое перелистывание и готовые
главы персонажей. После перехода видна сама глава. Книга не занимает её рабочее место.

Начало: `visual-story new ./my-story --example interaction-studio`.
[Письмо из мастерской](../examples/interaction-studio/scene.js) соединяет взаимодействие
с предметами, измерение площади и физический опыт. `?variant=mira` меняет рост,
одежду и окружение при тех же действиях. [Дом мыслей](../examples/story-workshop/scene.js)
показывает вход, чтение и встречу; [площадь](../examples/tlinov-book/scene.js) — Ink без героев.

```js
import { Storybook } from '@visual-storytelling/core/book';
import { inkChapter } from '@visual-storytelling/core/story';
import { areaDiagram } from '@visual-storytelling/core/recipes';
import { chibi, courtyard, routines } from '@visual-storytelling/core/characters';

await Storybook.mount(root, {
  topic: 'Одинаковая мера',
  pack: chibi,
  parameters: [
    { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
    { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
  ],
  chapters: [
    {
      id: 'enter',
      title: 'За дверью',
      set: courtyard(),
      cast: { hero: { skin: 'mira-scholar', at: 'entry', scale: 0.64 } },
      beats: routines.enter('enter', 'hero'),
    },
    inkChapter({
      id: 'area',
      title: 'Считаем площадь',
      text: 'Две строки по три.',
      seconds: 7,
      controls: ['width', 'height'],
      create: areaDiagram,
    }),
  ],
});
```

`pack` нужен главам персонажей. Обычная глава задаёт `id`, `title`, `text`, `seconds`
и `mount(parent)`. Результат mount:

- `render(frame)` получает локальные `time`, `progress`, `reduced`, `mode` и `values`.
- `snapshot()` возвращает предметное состояние для проверки.
- `capture()` фиксирует текущий кадр для перехода. Фиксация происходит до первого
  `await`; декодирование допускается позже. `snapshotSVG` из `./export` делает это для SVG.
- `reset()` возвращает ручной ракурс; `dispose()` освобождает ресурсы.

Живой DOM главы сохраняет доступность, интерактивность и пообъектную диагностику.
Снимки используются только во вступлении и переходах. Главы персонажей делят один
WebGL-контекст; каждый собственный renderer освобождается владельцем главы.

## Ink, сетка и параметры

`inkChapter` создаёт обычную `Surface`. `create(view)` возвращает
`render(frame, {width,height})`, необязательные `snapshot` и `dispose`.
Размеры viewport даны в CSS px: надписи можно сохранять читаемыми при изменении
ширины, переставляя композицию. Рисунок пользуется существующими Ink и recipes.

`areaDiagram(view)` — готовая адаптивная композиция: стороны, площадь, общая мера,
разбиение и формула. Сантиметр всегда равен двум шагам сетки; 1 см² — четырём клеткам.
Рисунок и сетка имеют общее начало. Изменение сторон сохраняет размер единицы;
изменение ширины экрана перестраивает раскладку. Подложка прозрачна, пигменты следуют теме.

`valuesAt(frame)` задаёт входы рассказа; «Исследовать» редактирует те же параметры.
`controls` выбирает поля главы. `chapter` и `sceneTime` зарезервированы общей оболочкой.
Возврат в рассказ восстанавливает его значения и момент.

## Речь и перемотка

У главы может быть локальный `script`. Общий `script` и `audio` передаются в mount;
метки глав имеют ID главы, внутренние метки — `chapterId.cueId`. Композиция совмещает
их время, сохраняет паузы и слова. Исполнители получают локальное время главы,
поэтому контакты и физика перематываются через те же функции, что и при воспроизведении.
Противоречивый порядок и границы ретайминга, а также наложение глав отклоняются при подготовке.

Для физического опыта используй `PhysicsReplay.create(world, {duration})` и
`replay.seek(frame.time)`. Он сохраняет ограниченное число checkpoints и восстанавливает
ближайший перед нужным моментом. `world.dispose()` освобождает также replay.

`scene.snapshot()` содержит текущую главу, её frame и предметное content.
`scene.presentation()` проверяет видимые объекты и экранный размер подписей;
`scene.checkpoints` включает границы и середины меток. Для переходов также проверяй
реальные кадры: `visual-story review DIST --width 375 --theme dark`.
