import { SceneShell, storyActions } from '@visual-storytelling/core';
import timing from './timeline.json' with { type: 'json' };
import logo from './assets/ortomatica-logo-mark.webp';
import product from './assets/elbrus.jpg';

window.galleryReady = (async () => {
  await SceneShell.ready();
  await Promise.all([document.fonts.load('24px Orto'), document.fonts.load('200 24px OrtoLogo')]);
  const root = document.getElementById('ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Ортоматика · перед оплатой заказа',
    appearance: 'interface',
    frame: { width: 1600, height: 900 },
    heading: false,
    captions: true,
  });
  const film = document.createElement('div');
  film.className = 'product-film';
  const brand = `<span class="product-brand"><img src="${logo}" alt=""><span>ортоматика</span></span>`;
  film.innerHTML = `
    <header class="product-header">${brand}<span>Личный кабинет <span class="header-dot">·</span> Оформление заказа</span></header>
    <section class="portal" id="checkout">
      <aside>${brand}<span class="portal-kind">Личный кабинет</span><nav><span class="active">Мои заказы</span><span>Плантограммы</span><span>Адреса доставки</span><span>Мои данные</span></nav><div class="portal-user"><span class="avatar">А</span><span>Анна<br><small>Учебные данные</small></span></div></aside>
      <article class="order-page"><div class="breadcrumbs">Мои заказы <span>›</span> Новый заказ</div><div class="page-heading"><span class="step-badge">5</span><div><h1>Проверьте заказ</h1><p>Всё готово к оформлению</p></div></div>
        <div class="order-grid"><div class="order-details">
          <div class="detail-row"><span class="file-icon">PDF</span><div><small>Плантограмма</small><strong>plantogram.pdf</strong></div><span class="verified">✓</span></div>
          <div class="detail-row product-row"><img src="${product}" alt="Стельки Эльбрус"><div><small>Модель и количество</small><strong>Эльбрус</strong><p>Обе стопы · 1 пара</p></div><span class="verified">✓</span></div>
          <div class="detail-row"><span class="location-icon">⌖</span><div><small>Получение</small><strong>Выбранный пункт СДЭК</strong><p>Анна · +7 900 000-00-00</p></div><span class="verified">✓</span></div>
          <p class="private-note">Файлы и параметры сохранятся в заказе</p>
        </div><section class="payment-card">
          <button class="promo-toggle" id="promo-toggle" type="button">Промокод или сертификат <span>⌄</span></button>
          <div class="promo-slot"><div id="promo-fields"><label for="promo">Промокод</label><input id="promo" placeholder="Ваш промокод" readonly><label for="certificate">Подарочный сертификат</label><input id="certificate" placeholder="Номер сертификата" readonly><small class="demo-note">DEMO — учебный пример ввода</small></div></div>
          <div class="order-total"><span>К оплате</span><strong>Итоговая сумма <small>₽</small></strong><p>Рассчитывается по вашему заказу</p></div>
          <button class="primary-button" id="pay" type="button">Оплатить заказ <span>→</span></button>
        </section></div>
      </article>
    </section>
    <section id="gateway" class="gateway"><span class="secure-mark">✓</span><span class="section-label">ПЛАТЁЖНАЯ СТРАНИЦА</span><h1>Завершите оплату</h1><p>Выберите доступный способ<br>и следуйте подсказкам на странице.</p><div id="payment-options" class="payment-options"><span>₽</span> Способ оплаты <span>→</span></div><div id="return" class="return-note"><span>↩</span><div><strong>После завершения оплаты</strong><p>Вернитесь в кабинет → Мои заказы</p></div></div></section>
    <footer>Ortomatica.ru <span>Учебный показ интерфейса</span></footer>`;
  shell.stage.prepend(film);
  const get = (id) => film.querySelector(`#${id}`);
  const actions = storyActions(
    [
      {
        cue: 'open_promo',
        type: 'press',
        target: get('promo-toggle'),
        result: get('promo-fields'),
      },
      { cue: 'enter_code', type: 'type', target: get('promo'), text: 'DEMO' },
      { cue: 'pay', type: 'press', target: get('pay'), result: get('gateway') },
      { cue: 'instructions', type: 'reveal', target: get('payment-options') },
      { cue: 'return_to_account', type: 'reveal', target: get('return') },
    ],
    { pointer: film },
  );
  shell.onDispose(actions.dispose);
  shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: (frame) => ({ payment: frame.finished('pay') }),
    render(state, frame) {
      actions.render(frame);
      get('checkout').hidden = state.payment;
    },
  });
})();
