(() => {
      const root = document.getElementById('ve-scene');
      const svg = root.querySelector('.figure');
      const ns = 'http://www.w3.org/2000/svg';
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      let step = 0;
      const states = [
        { equation: '3x + 2 = 8', detail: 'Три одинаковых мешочка и две гирьки весят как восемь гирек.' },
        { equation: '3x = 6', detail: 'С обеих чаш убрали по две гирьки. Равновесие сохранилось.' },
        { equation: 'x = 2', detail: 'Одна из трёх равных групп: мешочек весит как две гирьки.' }
      ];
      function token(kind, index) {
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'token');
        g.dataset.kind = kind; g.dataset.index = index;
        const bagShapes = [
          'M-7 -43Q-1 -40 7 -44L4 -34C8 -28 18 -18 17 -9Q17 -1 8 0Q-1 1 -9 0C-18 0 -19 -7 -16 -15Q-11 -27 -4 -34Z',
          'M-6 -44Q0 -41 7 -43L4 -34C11 -26 18 -17 17 -8Q16 1 7 0Q-2 1 -10 -1C-18 -1 -18 -9 -15 -17Q-11 -26 -4 -34Z',
          'M-7 -43Q0 -40 6 -44L4 -34C10 -27 17 -18 17 -9Q18 0 9 0Q0 1 -8 0C-17 0 -19 -7 -16 -16Q-11 -27 -4 -34Z'
        ];
        g.innerHTML = kind === 'bag'
          ? `<g data-shape><path class="bag" d="${bagShapes[index]}"/><path class="crease" d="M-5 -34Q0 -32 5 -34 M-5 -32l-3 5 M4 -32l3 4"/><text class="unknown" y="-10" text-anchor="middle">x</text></g>`
          : '<g data-shape><path class="unit" d="M-5 -15Q0 -16 5 -15L8 -1Q1 1 -8 0Z M-3 -15L-3 -20Q0 -21 3 -20L3 -15"/></g>';
        root.querySelector('[data-tokens]').append(g);
        return g;
      }
      const bags = Array.from({ length: 3 }, (_, i) => token('bag', i));
      const leftUnits = Array.from({ length: 2 }, (_, i) => token('left-unit', i));
      const rightUnits = Array.from({ length: 8 }, (_, i) => token('right-unit', i));
      function place(g, x, y, removed = false, secondary = false, route = '') {
        const previous = new DOMMatrix(getComputedStyle(g).transform);
        g.getAnimations().forEach(animation => animation.cancel());
        g.style.transform = `translate(${x}px, ${y}px)`;
        g.dataset.removed = String(removed); g.dataset.secondary = String(secondary);
        g.dataset.selected = String(step === 2 && !removed && !secondary);
        if (route && !motion.matches && (previous.e !== x || previous.f !== y)) {
          const positions = [[previous.e, previous.f]];
          if (route === 'spread') positions.push([x, previous.f]);
          if (route === 'gather') positions.push([previous.e, y]);
          positions.push([x, y]);
          g.animate(positions.map(([px, py]) => ({ transform: `translate(${px}px, ${py}px)` })),
            { duration: 440, easing: 'ease-in-out' });
        }
      }
      function draw(route = '') {
        const width = Math.round(svg.getBoundingClientRect().width);
        if (!width) return;
        const left = width * .25, right = width * .75, center = width / 2;
        const halfPan = Math.min(126, width * .25 - 18);
        const compact = width < 480;
        const bagScale = compact ? .64 : 1;
        const unitScale = compact ? .64 : .85;
        const bagGap = Math.min(46, halfPan * .47);
        const unitGap = compact ? 17 : 23;
        const groupGap = Math.min(55, halfPan * .52);
        svg.setAttribute('viewBox', `0 0 ${width} 338`);
        root.querySelector('[data-scale]').innerHTML =
          `<path class="scale" d="M${left} 72Q${(left + center) / 2} 70.5 ${center} 72Q${(center + right) / 2} 73 ${right} 71.5 M${center - 4} 79Q${center - 9} 181 ${center - 11} 282 M${center + 4} 79Q${center + 6} 180 ${center + 11} 282"/>` +
          `<path fill="var(--ve-ink)" d="M${center - 4.8} 72C${center - 5} 65 ${center + 5.4} 65.7 ${center + 5} 72.3C${center + 5.4} 78.5 ${center - 5.3} 78 ${center - 4.8} 72Z"/>` +
          `<path class="scale" d="M${center - 29} 282Q${center} 281 ${center + 29} 282Q${center + 34} 282 ${center + 33} 287Q${center + 32} 291 ${center + 27} 290L${center - 29} 290Q${center - 34} 290 ${center - 33} 286Q${center - 33} 282 ${center - 29} 282Z"/>` +
          [left, right].map(x => `<path class="suspension" d="M${x - halfPan} 220Q${x - halfPan * .52} 147 ${x} 72Q${x + halfPan * .48} 145 ${x + halfPan} 220"/><path class="scale" d="M${x - halfPan} 220C${x - halfPan + 10} 236 ${x + halfPan - 12} 239 ${x + halfPan} 220"/>`).join('');
        bags.forEach((g, i) => {
          g.querySelector('[data-shape]').setAttribute('transform', `scale(${bagScale})`);
          place(g, left + (i - 1) * bagGap, step === 0 ? 196 : 212, false, step === 2 && i > 0, route ? 'move' : '');
        });
        leftUnits.forEach((g, i) => {
          g.querySelector('[data-shape]').setAttribute('transform', `scale(${unitScale})`);
          place(g, left + (i - .5) * unitGap, step === 0 ? 217 : 287, step > 0, false, route ? 'move' : '');
        });
        rightUnits.forEach((g, i) => {
          g.querySelector('[data-shape]').setAttribute('transform', `scale(${unitScale})`);
          if (i >= 6) place(g, right + (i - 6.5) * unitGap, step === 0 ? 217 : 287, step > 0, false, route ? 'move' : '');
          else if (step === 2) place(g, right + (Math.floor(i / 2) - 1) * groupGap + (i % 2 - .5) * (compact ? 14 : 19), 212, false, i >= 2, route);
          else place(g, right + (Math.floor(i / 2) - 1) * bagGap,
            (step === 0 ? 173 : 187) + (i % 2) * (step === 0 ? 20 : 25), false, false, route);
        });
        root.querySelector('[data-annotations]').innerHTML = step === 1
          ? [left, right].map(x => {
              const start = x + halfPan * .65, tip = x + unitGap + 10;
              return `<path class="annotation" d="M${start} 245C${start + 9} 263 ${start - 3} 278 ${tip} 282 M${tip + 5} 274L${tip} 282l9 3"/>`;
            }).join('')
          : step === 2 ? `<path class="highlight" d="M${center - 43} 18Q${center - 47} 10 ${center - 34} 10L${center + 39} 9Q${center + 49} 11 ${center + 43} 31Q${center + 41} 38 ${center + 31} 38L${center - 39} 39Q${center - 48} 38 ${center - 43} 18Z"/>` : '';
        root.querySelector('[data-labels]').innerHTML =
          `<text class="equation" x="${center}" y="34" text-anchor="middle">${states[step].equation}</text>` +
          (step === 2 ? [left, right].map(x => `<text class="note" x="${x}" y="258" text-anchor="middle">1 из 3 групп</text>`).join('') : step > 0 ? [left, right].map(x => `<text class="note" x="${x}" y="318" text-anchor="middle">−2</text>`).join('') :
            `<text class="note" x="${left}" y="264" text-anchor="middle">мешочек: x</text><text class="note" x="${right}" y="264" text-anchor="middle">гирька: 1</text>`);
        root.querySelector('[data-result]').textContent = states[step].detail;
        root.querySelector('#vb-desc').textContent = `${states[step].equation}. ${states[step].detail}`;
        root.querySelector('[data-back]').disabled = step === 0;
        root.querySelector('[data-next]').textContent = ['Убрать по 2', 'Разделить на 3', 'Сначала'][step];
      }
      function restore(snapshot) {
        const saved = snapshot?.privateContent;
        if (saved?.example === 'balance' && Number.isInteger(saved.step)) step = Math.max(0, Math.min(2, saved.step));
      }
      function change(next) {
        const previous = step;
        step = next;
        draw(step === 2 ? 'spread' : previous === 2 ? 'gather' : 'move');
        window.openai?.setWidgetState?.({ modelContent: { example: 'balance', equation: states[step].equation },
          privateContent: { example: 'balance', step } })?.catch(() => {});
      }
      root.querySelector('[data-next]').addEventListener('click', () => change((step + 1) % 3));
      root.querySelector('[data-back]').addEventListener('click', () => change(Math.max(0, step - 1)));
      restore(window.openai?.widgetState);
      window.addEventListener('openai:set_globals', e => {
        const previous = step; restore(e.detail?.globals?.widgetState); if (step !== previous) draw();
      });
      new ResizeObserver(() => draw()).observe(svg);
      document.fonts.ready.then(() => draw());
      draw();
    })();
