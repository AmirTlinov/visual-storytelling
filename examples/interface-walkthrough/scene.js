import { SceneShell, storyActions, interpolate } from '@visual-storytelling/core';
import timing from './timeline.json' with { type: 'json' };

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Как промокод меняет заказ',
    frame: { width: 1280, height: 720, scope: 'scene' },
    heading: false,
    paper: false,
  });
  const subject = document.createElement('section');
  subject.className = 'checkout-lesson';
  subject.innerHTML = `
    <header><span class="eyebrow">ПРОМОКОД И ЗАКАЗ</span><h1>От кода — к новой сумме</h1></header>
    <div class="checkout-columns">
      <section class="checkout-card" aria-label="Ввод промокода">
        <h2>Есть промокод?</h2><label for="promo">Введите код</label>
        <div class="promo-row"><input id="promo" readonly aria-label="Промокод" placeholder="Промокод"><button id="apply" type="button">Применить</button></div>
        <div class="acceptance-slot"><p id="accepted" class="accepted">✓ Промокод принят</p></div>
        <p class="card-note">Код связывает заказ<br>с условием скидки.</p>
      </section>
      <span class="checkout-arrow" aria-hidden="true">→</span>
      <section class="checkout-card invoice" aria-label="Расчёт стоимости">
        <h2>Ваш заказ</h2><p class="price-row"><span>Стоимость</span><span>1 000 ₽</span></p>
        <div class="discount-slot"><p id="discount" class="price-row discount"><span>Скидка 20%</span><span id="saved">−200 ₽</span></p></div>
        <div class="invoice-rule"></div><p class="price-row total"><span>Итого</span><output id="total">1 000 ₽</output></p>
        <button id="confirm" type="button">Подтвердить заказ</button>
      </section>
    </div>
    <p id="confirmation" class="confirmation">✓ Заказ подтверждён · <strong>800 ₽</strong></p>`;
  const artwork = SceneShell.frame(subject, { width: 1280, height: 720 });
  shell.stage.append(artwork.element);
  artwork.resize();
  shell.onDispose(artwork.dispose);
  const get = (id) => subject.querySelector(`#${id}`);
  const actions = storyActions(
    [
      { cue: 'code', type: 'type', target: get('promo'), text: 'SALE20' },
      { cue: 'apply', type: 'press', target: get('apply'), result: get('accepted') },
      { cue: 'discount', type: 'reveal', target: get('discount') },
      { cue: 'confirm', type: 'press', target: get('confirm'), result: get('confirmation') },
    ],
    { pointer: subject },
  );
  shell.onDispose(actions.dispose);
  const total = get('total');
  total.dataset.reviewId = 'order-total';
  shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt(frame) {
      frame.target('discount', 'order-total');
      return { total: Math.round(interpolate(1000, 800, frame.progress('discount'))) };
    },
    render(state, frame) {
      actions.render(frame);
      total.textContent = `${state.total.toLocaleString('ru-RU')} ₽`;
      get('saved').textContent = `−${(1000 - state.total).toLocaleString('ru-RU')} ₽`;
    },
  });
})();
