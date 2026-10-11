import '@visual-storytelling/core/style.css';
import './style.css';

export function mountGallery() {
  document.querySelector('#examples').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const text = button.closest('.example-setup').querySelector('textarea');
    const status = document.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(text.value);
      button.textContent = 'Скопировано';
      status.textContent = 'Команды скопированы';
    } catch {
      text.focus();
      text.select();
      button.textContent = 'Скопируйте выделенный текст';
      status.textContent = 'Команды выделены для копирования';
    }
  });
}
