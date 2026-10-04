import { CharacterStory, chibi, workshop, spark } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

window.galleryReady = CharacterStory.mount(document.getElementById('chibi-transfer'), {
  title: 'Идея становится общей',
  description: 'Тесла делится идеей с Мирой: светлая искра переходит от его ладони к её ладони.',
  remember: 'chibi-transfer',
  pack: chibi,
  set: workshop(),
  cast: {
    tesla: { skin: 'tesla', at: 'left', scale: 0.7 },
    mira: { skin: 'mira', at: 'right', scale: 0.7, flip: true },
  },
  props: {
    idea: { art: spark, at: { actor: 'tesla', anchor: 'hand-right' }, opacity: 0, scale: 0.75 },
  },
  beats: [
    {
      id: 'question',
      title: 'Есть задача',
      seconds: 2.5,
      text: 'Тесла обдумывает задачу, Мира пока сомневается.',
      actors: { tesla: 'think', mira: 'confused' },
    },
    {
      id: 'found',
      title: 'Нашлось решение',
      seconds: 2.5,
      text: 'Появляется идея.',
      actors: { tesla: 'idea' },
    },
    {
      id: 'offer',
      title: 'Можно поделиться',
      seconds: 1.5,
      text: 'Тесла и Мира поднимают руки.',
      actors: { tesla: 'wave', mira: 'wave' },
      props: { idea: { opacity: 1 } },
    },
    {
      id: 'share',
      title: 'Идея переходит к Мире',
      seconds: 2.5,
      text: 'Искра идеи переходит от одной ладони к другой.',
      props: { idea: { at: { actor: 'mira', anchor: 'hand-right' }, arc: 80 } },
    },
    {
      id: 'together',
      title: 'Теперь понимают оба',
      seconds: 2.5,
      text: 'Теперь оба понимают — и радуются вместе.',
      actors: { tesla: 'celebrate', mira: 'celebrate' },
      props: { idea: { opacity: 0 } },
    },
  ],
});
