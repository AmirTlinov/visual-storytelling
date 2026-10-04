import { CharacterStory, chibi, laboratory } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

window.galleryReady = CharacterStory.mount(document.getElementById('chibi-tesla'), {
  title: 'Тесла · Момент открытия',
  description:
    'Тесла размышляет в ночной лаборатории, находит решение и радуется загоревшейся лампе.',
  remember: 'chibi-tesla',
  pack: chibi,
  set: laboratory(),
  cast: { tesla: { skin: 'tesla', at: 'center' } },
  beats: [
    {
      id: 'think',
      title: 'В поисках решения',
      seconds: 3,
      text: 'Тесла ищет решение.',
      actors: { tesla: 'think' },
    },
    {
      id: 'idea',
      title: 'Есть идея!',
      seconds: 3,
      text: 'Идея найдена — лампа загорается.',
      actors: { tesla: 'idea' },
      props: { lamp: { delay: 0.35, over: 0.25, values: { light: 1 } } },
    },
    {
      id: 'happy',
      title: 'Получилось',
      seconds: 1.8,
      text: 'Можно радоваться открытию.',
      actors: { tesla: 'celebrate' },
    },
  ],
});
