import { register } from '../drawing/catalog-symbols.js';
import { P, R, repeat, G, C } from '../drawing/symbols.js';
import { computeScene } from './structure-scenes.js';

function cpuCycleScene(node, viewport, m, art) {
  const { scene, T, H, bus, wedge, mark } = art;
  const state = (id) => (m.signal(id) === null ? 'pending' : String(m.signal(id)));
  const wire = (d, ids) =>
    P(d, `cycle-wire ${ids.every((id) => m.signal(id) !== null) ? 'ready' : 'pending'}`);
  const pinValue = (x, y, name, id, anchor = 'middle') =>
    T(x, y, `${name} ${m.text(id)}`, 15, '', anchor);
  const hit = (key, label, type, x, y, w, h, params = {}) =>
    H(key, label, type, x, y, w, h, { cpuCycle: true, ...params });
  const wordValue = (reg) => (reg === 1 ? m.r1 : reg === 2 ? m.b : 0);
  const sums = m.bits.map((bit) => bit.sum);
  const bit = Number.isInteger(node.bit) ? node.bit : 0;
  const row = m.bits[bit],
    net = m.nets.get(node.net);
  scene.clock = {
    points: [...new Set([1, ...sums.map((id) => m.nets.get(id).at), m.settled, m.period])],
  };
  let b = '';
  if (node.type === 'core') {
    scene.clock.points = [1, Math.max(...sums.map((id) => m.nets.get(id).at)), m.settled, m.period];
    b = R(23, 14, 554, 326, 'board outline', 7) + R(34, 25, 532, 304, 'chip fine', 3);
    b += T(300, 45, 'C0 · R1 ← R1 + R2', 18, 'etch');
    const register = (x, y, label, value) =>
      R(x, y, 148, 65, 'metal outline', 3) +
      T(x + 74, y + 20, `${label} = ${value}`, 18) +
      repeat(
        4,
        (i) =>
          R(x + 10 + i * 33, y + 37, 29, 20, 'chip fine', 1) +
          T(x + 24.5 + i * 33, y + 47, (value >> (3 - i)) & 1, 13, 'etch'),
      );
    b += G('registers', register(70, 76, 'R1', m.r1) + register(70, 211, 'R2', m.b));
    hit('registers', 'Регистры R1 и R2', 'register-file', 70, 76, 148, 200);
    b +=
      G('alu', wedge(299, 132, 137, 130)) +
      T(367, 295, m.word(sums) === '…' ? 'Сумма …' : `Сумма ${m.sum}`, 17, 'etch');
    hit('alu', 'ALU · сложение', 'alu-level', 299, 132, 137, 130);
    b += wire(
      'M 218 102 H 264 V 167 H 299',
      m.bits.map((bit) => bit.a),
    );
    b += wire(
      'M 218 238 H 264 V 228 H 299',
      m.bits.map((bit) => bit.b),
    );
    b += wire('M 436 197 H 534 V 315 H 48 V 104 H 70', sums);
    b += T(479, 178, m.word(sums), 18, 'etch');
    b += P('M 69 123 L 79 129 L 69 135', 'line') + T(114, 158, '↑ CLK', 13, 'etch');
    b += T(481, 246, m.done ? 'ЗАПИСЬ' : 'D → R1', 13, 'etch');
    scene.caption = `Учебный тракт · 4 бита · ${m.a} + ${m.b}${m.done ? ` → ${m.sum} · перенос ${m.carry}` : ''}`;
  } else if (node.type === 'alu-level') {
    scene.clock.points = [1, Math.max(...sums.map((id) => m.nets.get(id).at)), m.settled, m.period];
    // Keep the existing ALU's other units available as structural views.
    computeScene(node, viewport, {}, art);
    scene.hits.find((h) => h.key === 'adder').node.cpuCycle = true;
    scene.caption = `Сложение ${m.a} + ${m.b} · результат ${m.word(sums)} · регистр R1 = ${m.r1}`;
    return scene;
  } else if (node.type === 'adder') {
    scene.clock.points = m.bits.flatMap((bit) => [m.nets.get(bit.sum).at, m.nets.get(bit.cout).at]);
    b = T(300, 24, `${m.a} + ${m.b} · 4 разряда`, 18);
    for (let i = 0; i < 4; i++) {
      const x = 70 + (3 - i) * 124,
        r = m.bits[i];
      b += G(
        `adder-${i}`,
        R(x, 112, 90, 116, 'paper outline', 4) +
          T(x + 45, 151, `FA${i}`, 18) +
          T(x + 45, 191, `S ${m.text(r.sum)}`, 18),
      );
      b += wire(`M ${x + 21} 79 V 112`, [r.a]) + wire(`M ${x + 69} 79 V 112`, [r.b]);
      b += pinValue(x + 21, 61, `A${i}`, r.a) + pinValue(x + 69, 88, `B${i}`, r.b);
      b += wire(`M ${x + 45} 228 V 275`, [r.sum]) + pinValue(x + 45, 302, `S${i}`, r.sum);
      hit(`adder-${i}`, `Разряд ${i}`, 'full-adder', x, 112, 90, 116, { bit: i });
      b += wire(`M ${x} 171 H ${x - 34}`, [r.cout]) + T(x - 17, 147, m.text(r.cout), 14);
      b += P(`M ${x - 27} 167 L ${x - 34} 171 L ${x - 27} 175`, 'cycle-direction');
    }
    b +=
      wire('M 573 171 H 532', ['c0']) +
      T(554, 147, '0', 14) +
      T(47, 205, 'C4', 13) +
      T(554, 205, 'C0', 13);
    b += T(300, 341, 'ПЕРЕНОС ←', 13);
    scene.caption = `От младшего разряда b0 к старшему b3 · R1 = ${m.r1}`;
  } else if (node.type === 'register-file') {
    scene.clock.points = [1, m.settled, m.period];
    b = R(49, 31, 502, 294, 'chip outline', 5);
    for (let reg = 0; reg < 4; reg++) {
      const y = 51 + reg * 66,
        value = wordValue(reg);
      b += T(105, y + 23, `R${reg}`, 17, 'etch');
      b += G(
        `word-${reg}`,
        repeat(
          4,
          (i) =>
            R(164 + i * 72, y, 61, 47, 'metal fine', 2) +
            T(194 + i * 72, y + 23, (value >> (3 - i)) & 1, 21),
        ),
      );
      b += T(504, y + 23, value, 19, 'etch');
      hit(`word-${reg}`, `Регистр R${reg}`, 'register-word', 158, y, 290, 47, { register: reg });
    }
    scene.caption = `R1 = ${m.r1} · R2 = ${m.b} · запись R1 по нарастающему фронту CLK`;
  } else if (node.type === 'register-word') {
    const reg = node.register ?? 1,
      value = wordValue(reg);
    b = T(300, 32, `R${reg} = ${value}`, 20) + P('M 43 282 H 558', 'cycle-wire');
    for (let i = 0; i < 4; i++) {
      const x = 58 + (3 - i) * 136,
        d = reg === 1 ? m.text(m.bits[i].sum) : (value >> i) & 1;
      b += G(
        `bit-${i}`,
        R(x, 114, 79, 112, 'paper outline', 4) +
          T(x + 40, 150, 'D', 14) +
          T(x + 40, 190, (value >> i) & 1, 24),
      );
      b += T(x + 40, 56, `b${i}`, 14) + T(x + 40, 88, `D ${d}`, 16) + bus(x + 40, 99, x + 40, 114);
      b += P(`M ${x + 14} 226 V 282 M ${x + 8} 226 L ${x + 14} 216 L ${x + 20} 226`, 'cycle-wire');
      hit(`bit-${i}`, `R${reg} · бит ${i}`, 'clock-bit', x, 114, 79, 112, {
        register: reg,
        bit: i,
      });
    }
    b += T(
      300,
      316,
      `CLK ${m.clockHigh ? 1 : 0} · ${reg === 1 ? 'запись разрешена' : 'удержание'}`,
      16,
    );
    scene.caption = 'D — следующий бит · Q — сохранённый бит · фиксация по ↑ CLK';
  } else if (node.type === 'clock-bit') {
    const reg = node.register ?? 1,
      q = (wordValue(reg) >> bit) & 1,
      d = reg === 1 ? m.text(row.sum) : q;
    const previous = reg === 1 ? (m.a >> bit) & 1 : q,
      master = m.time < m.period / 2 ? previous : d;
    b = T(300, 48, `D-триггер · R${reg} · b${bit}`, 19);
    b += R(132, 98, 128, 128, 'paper outline', 4) + R(358, 98, 128, 128, 'paper outline', 4);
    b +=
      T(196, 123, 'MASTER', 15) +
      T(422, 123, 'SLAVE', 15) +
      T(196, 164, master, 25) +
      T(422, 164, q, 25);
    b +=
      T(196, 205, `EN ${m.clockHigh ? 0 : 1}`, 15) + T(422, 205, `EN ${m.clockHigh ? 1 : 0}`, 15);
    b +=
      wire('M 39 157 H 132', reg === 1 ? [row.sum] : []) +
      bus(260, 157, 358, 157) +
      bus(486, 157, 561, 157);
    b += T(77, 125, `D ${d}`, 18) + T(524, 125, `Q ${q}`, 18);
    b += P('M 554 284 H 242 M 422 284 V 226 M 198 284 H 196 V 226', 'line') + C(422, 284, 3, 'dot');
    b += P('M 242 268 L 211 284 L 242 300 Z', 'paper outline') + C(205, 284, 6, 'paper outline');
    b += T(523, 317, `CLK ${m.clockHigh ? 1 : 0}`, 16);
    scene.clock.points = [1, m.period / 2, m.nets.get(row.sum).at, m.settled, m.period];
    scene.caption = m.clockHigh
      ? 'CLK = 1 · master удерживает бит, slave передаёт его на Q.'
      : 'CLK = 0 · master принимает D, slave удерживает прежний Q.';
  } else if (node.type === 'full-adder' || node.type === 'gate') {
    const mappings =
      node.type === 'full-adder'
        ? { A: row.a, B: row.b, Cin: row.cin, S: row.sum, Cout: row.cout }
        : { A: net.inputs[0], B: net.inputs[1], Y: net.id };
    const parts =
      node.type === 'full-adder'
        ? Object.fromEntries(row.gates.map((id) => [id.split('/').at(-1), id]))
        : Object.fromEntries((net.children || []).map((id) => [id.split('/').at(-1), id]));
    const labeledT = (x, y, label, size, cls, anchor) => {
      if (node.type === 'full-adder' && label === 'Cout') y = 325;
      if (mappings[label])
        return T(
          x,
          y,
          `${label} ${m.text(mappings[label])}`,
          size,
          cls,
          x < 70 ? 'start' : x > 530 ? 'end' : anchor,
        );
      return T(x, y, label, size, cls, anchor);
    };
    const marked = (kind, x, y, s = 1) => {
      const key = Object.keys(parts).find(
        (key) => !marked.used.has(key) && m.nets.get(parts[key]).op === kind.toUpperCase(),
      );
      if (!key) return mark(kind, x, y, s);
      marked.used.add(key);
      const id = parts[key];
      return `<g data-net="${id}" data-state="${state(id)}">${mark(kind, x, y, s)}${T(x + 112 * s, y, m.text(id), 14, 'cycle-value')}</g>`;
    };
    marked.used = new Set();
    computeScene(node, viewport, {}, { ...art, T: labeledT, mark: marked });
    for (const target of scene.hits) {
      const id = parts[target.key];
      if (id) Object.assign(target.node, { cpuCycle: true, net: id, bit, op: m.nets.get(id).op });
      else if (target.node.type === 'transistor') {
        const input = target.key.endsWith('b') ? net.inputs[1] : net.inputs[0];
        Object.assign(target.node, { cpuCycle: true, inputNet: input, bit });
      }
    }
    scene.clock.points = [
      ...new Set(
        [...Object.values(mappings), ...Object.values(parts)]
          .filter(Boolean)
          .map((id) => m.nets.get(id).at),
      ),
    ];
    scene.caption =
      node.type === 'full-adder'
        ? `b${bit} · ${m.text(row.a)} + ${m.text(row.b)} + ${m.text(row.cin)} → S ${m.text(row.sum)} · C ${m.text(row.cout)}`
        : `${net.op} · ${net.inputs.map((id, i) => `${i ? 'B' : 'A'} ${m.text(id)}`).join(' · ')} → Y ${m.text(net.id)}`;
    return scene;
  } else if (node.type === 'transistor' || node.type === 'channel') {
    const value = m.signal(node.inputNet);
    computeScene(node, viewport, { gate: value === null ? null : !!value }, art);
    for (const target of scene.hits)
      Object.assign(target.node, { cpuCycle: true, inputNet: node.inputNet, bit });
    scene.control = null;
    scene.clock.points = [m.nets.get(node.inputNet).at];
    scene.caption = `${node.polarity === 'p' ? 'pMOS' : 'nMOS'} · затвор ${value ?? '…'} · сигнал из выбранного вентиля`;
    return scene;
  }
  if (!b) throw new Error(`Unknown CPU execution view: ${node.type}`);
  scene.body = b;
  return scene;
}
export { cpuCycleScene };
