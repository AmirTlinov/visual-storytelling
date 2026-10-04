# Tlinov: вступление, главы и рабочий лист

`@visual-storytelling/core/book` добавляет раскрытие книги и перелистывание к обычному
рассказу. После вступления обложка исчезает: остаётся прозрачная сцена, плеер и
исследование параметров примера. Цвета наследуют общую светлую/тёмную тему.
[Рабочий пример](../examples/tlinov-book/scene.js) меняет стороны прямоугольника.

```js
import { BookStory } from '@visual-storytelling/core/book';

const { scene } = await BookStory.mount(root, {
  topic: 'Площадь',
  parameters: [{ key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6 }],
  pages: [
    {
      id: 'rectangle',
      title: 'Считаем квадраты',
      text: 'Две строки по три.',
      seconds: 7,
      valuesAt: (frame) => ({ width: 1 + Math.floor(frame.progress * 5) }),
      draw(page, frame) {
        const width = Number(frame.values.width);
        page.rect('area', { x: 2, y: 2, width, height: 2 });
        page.text('answer', `${width} × 2 = ${width * 2} см²`, 9, 3);
      },
    },
  ],
});
```

`valuesAt` задаёт входы во время рассказа. «Исследовать» редактирует те же входы через
общие поля `SceneShell`; `draw` остаётся одним. Поле `chapter` выбирает пример и
зарезервировано оболочкой. Возврат к рассказу восстанавливает его состояние.
`describe(frame)` задаёт доступное текстовое описание текущих значений модели.
При reduced motion рабочая сцена появляется без полёта и изгиба листа.

## Персонажи и объяснения в одной истории

`Storybook` принимает `chapters`: каждый элемент — обычная `BookPage` или сцена
с `set`, `cast`, `beats` и необязательным `shot`. Один `pack` обслуживает всех героев.
[Дом мыслей](../examples/story-workshop/scene.js) — готовый исходник для новой истории.

```js
import { Storybook } from '@visual-storytelling/core/book';
import { chibi, courtyard, readingRoom, routines } from '@visual-storytelling/core/characters';
const cast = { hero: { skin: 'mira-lab', at: 'entry', scale: 0.64 } };
await Storybook.mount(root, {
  topic: 'Откуда берутся идеи',
  pack: chibi,
  chapters: [
    {
      id: 'enter',
      title: 'За дверью',
      set: courtyard(),
      cast,
      beats: routines.enter('enter', 'hero'),
    },
    {
      id: 'read',
      title: 'В библиотеке',
      set: readingRoom(),
      cast,
      beats: routines.read('read', { actor: 'hero' }),
    },
    {
      id: 'square',
      title: 'Одна мера',
      text: 'Четыре клетки — квадратный сантиметр.',
      seconds: 5,
      draw(page) {
        page.rect('unit', { x: 3, y: 3, width: 1, height: 1 });
      },
    },
  ],
});
```

Книга сопровождает вступление и смену глав; содержимое заполняет рабочий кадр.
«Исследовать» выбирает главу, для персонажей — момент её действия, для объяснения —
его параметры. `controls: ['width','height']` оставляет у страницы только нужные поля;
если `controls` пропущен, видны все параметры. `sceneTime` зарезервирован `Storybook`.
`paper: false` позволяет обычной странице рисовать без сетки и полей.

У всех сцен один графический исполнитель персонажей; действуют общие пути,
контакты и камера. `scene.snapshot().characters` содержит состояние текущей сцены,
а `scene.checkpoints` включает середины действий для осмысленного визуального просмотра.
Перенос в книгу поддерживает подготовленные предметы `staging.objects`.
Произвольные SVG-слои `PropArt` используй через `CharacterStory` или существующий фильм.

## Геометрия

Лист — **18×12 модельных сантиметров**, клетка — **0,5 см**. Четыре клетки образуют
1 см². Это координаты рисунка, физический размер экранного сантиметра зависит от
экрана. Рисунок и сетка масштабируются вместе; `page.cell(column, row)` возвращает
координаты узла сетки.

- `rect(id, {x,y,width,height}, fill?, stroke?)` — прямоугольник.
- `line(id, [x,y], [x,y], color?, width?)` — линия.
- `text(id, text, x, y, {size?, color?, align?})` — текст по базовой линии.
- `image(id, canvasOrImage, box)` — живой рисунок с сохранением пропорций.
- `ink('blue', .18)` — пигмент темы с прозрачностью.
- `context` и `bounds(id, box)` — собственная геометрия с проверяемой областью.

Помощники измеряют содержание и отклоняют выход за безопасные поля 0,5 см.
`root.scene.presentation()` показывает обрезанные объекты и выход кадра за экран.
Состояние Canvas сбрасывается перед кадром; каждый `draw` изолирован через save/restore.
Уход за границы через необозначенный raw `context` требует отдельного визуального просмотра.

## В существующем фильме

`BookStage.mount(host, {topic, pages, values?})` предоставляет `render(state)` и
`dispose()` без собственного плеера. Передавай абсолютное время и состояния
`{page, time, progress, open, focus, turn, reduced, mode?, values?}` из существующего
`Story`; `open`, `focus`, `turn` находятся в диапазоне 0…1. `focus=turn=1` показывает
обычный лист, `mode:'explore'` сразу возвращает рабочую сцену. После mount вызови
первый render; освобождение зарегистрируй через `shell.onDispose(book.dispose)`.

Кадр хоста должен сохранять пропорцию 18:12. Для фильма `SceneShell.frame` задаёт
логическую композицию; плеер остаётся снаружи. Книга использует существующий
`Viewport3D` только во вступлении и переходах. Число полотен постоянно — текущая
и предыдущая страницы, независимо от числа глав. Режим исследования принадлежит
предметной модели; управление камерой книги не подменяет его.
