import './camera.js';
// A real, locally generated PCM track verifies the shared audio clock without a voice model.
const samples = 20 * 8000;
const bytes = new Uint8Array(44 + samples * 2),
  view = new DataView(bytes.buffer);
const word = (offset, text) =>
  [...text].forEach((character, i) => (bytes[offset + i] = character.charCodeAt(0)));
word(0, 'RIFF');
view.setUint32(4, bytes.length - 8, true);
word(8, 'WAVE');
word(12, 'fmt ');
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, 8000, true);
view.setUint32(28, 16000, true);
view.setUint16(32, 2, true);
view.setUint16(34, 16, true);
word(36, 'data');
view.setUint32(40, samples * 2, true);
const audio = document.querySelector('audio');
audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
audio.removeAttribute('data-silent');
audio.muted = false;
window.galleryReady = window.galleryReady.then(() => {
  document.querySelector('.ve-scene').scene.shell.onDispose(() => URL.revokeObjectURL(audio.src));
});
