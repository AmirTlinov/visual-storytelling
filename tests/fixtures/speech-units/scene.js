import { IllustratedStory } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

// Timing/output evidence only. This measured tone is deliberately not a TTS or listening fixture.
const nativeContext = AudioContext;
window.outputContexts = [];
window.AudioContext = class extends nativeContext {
  constructor(...options) {
    super(...options);
    outputContexts.push(this);
  }
  createGain() {
    const gain = super.createGain();
    const destination = this.createMediaStreamDestination();
    gain.connect(destination);
    window.outputRecorder = new MediaRecorder(destination.stream);
    window.outputChunks = [];
    outputRecorder.addEventListener('dataavailable', (event) => outputChunks.push(event.data));
    return gain;
  }
};
function tone() {
  const rate = 24000,
    frames = rate * 8;
  const bytes = new ArrayBuffer(44 + frames * 2),
    view = new DataView(bytes);
  const tag = (offset, text) =>
    [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    view.setInt16(44 + i * 2, Math.sin((i * 2 * Math.PI * 660) / rate) * 5000, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
const phrases = [
  ['look', 'Посмотрим на предметы.', []],
  ['number', 'Здесь семнадцать предметов.', [{ model: 'division', inputs: { count: 17 } }]],
  ['try', 'Теперь попробуй сам.', []],
  [
    'check',
    'Семнадцать предметов дают четыре полные группы.',
    [{ model: 'division', inputs: { count: 17, divisor: 4 } }],
  ],
];
const document = {
  version: 2,
  models: [{ id: 'division', module: 'division', inputs: { count: 17, divisor: 4 } }],
  views: [{ id: 'groups', kind: 'groups', model: 'division' }],
  chapters: [
    {
      id: 'lesson',
      title: 'Предметы',
      beats: phrases.map(([id, say, models]) => ({
        id,
        say,
        action: 'Покажем предметы',
        seconds: 2,
        speech: { id: `voice.lesson.${id}`, when: { basis: 'presented', models } },
      })),
    },
  ],
};
const script = {
  duration: 8,
  cues: Object.fromEntries(
    phrases.map(([id], index) => [
      `lesson.${id}`,
      { start: index * 2 + 0.12, end: index * 2 + 1.8 },
    ]),
  ),
  segments: phrases.map(([id, text, models], index) => ({
    id: `voice.lesson.${id}`,
    ...(index === 0 && { title: 'Предметы' }),
    text,
    start: index * 2 + 0.12,
    end: index * 2 + 1.8,
    audio_start: index * 2,
    audio_end: index * 2 + 2,
    conditions: { basis: 'presented', models },
    words: [{ text, start: index * 2 + 0.12, end: index * 2 + 1.8 }],
  })),
};
const audio = window.document.querySelector('audio');
audio.src = tone();
audio.dataset.storyTimeline = 'data:application/json,' + encodeURIComponent(JSON.stringify(script));
window.galleryReady = IllustratedStory.mount(window.document.querySelector('main'), {
  document,
  script: audio.dataset.silent === 'true' ? undefined : script,
  audio,
}).then((lab) => (window.lab = lab));
window.outputBytes = async () => {
  await new Promise((resolve) => {
    outputRecorder.addEventListener('stop', resolve, { once: true });
    outputRecorder.stop();
  });
  return [...new Uint8Array(await new Blob(outputChunks).arrayBuffer())];
};
