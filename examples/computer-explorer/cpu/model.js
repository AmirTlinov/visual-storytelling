// One four-bit register/adder transaction. Gate delays are relative teaching
// intervals; a ready signal means the new operand's value has settled.
class CpuCycle {
  constructor() {
    this.restore();
  }
  restore(saved = {}) {
    if (!saved || typeof saved !== 'object') saved = {};
    this.a = Number.isInteger(saved.a) && saved.a >= 0 && saved.a < 16 ? saved.a : 3;
    this.b = Number.isInteger(saved.b) && saved.b >= 0 && saved.b < 16 ? saved.b : 5;
    this.cycles = Number.isSafeInteger(saved.cycles) && saved.cycles >= 0 ? saved.cycles : 0;
    this.build();
    this.time = Number.isFinite(saved.time) ? Math.max(0, Math.min(this.period, saved.time)) : 0;
  }
  build() {
    this.nets = new Map();
    this.bits = [];
    const input = (id, value) => {
      this.nets.set(id, { id, value, at: 1, inputs: [], op: 'INPUT' });
      return id;
    };
    const gate = (id, op, inputs) => {
      const sources = inputs.map((key) => this.nets.get(key)),
        v = sources.map((net) => net.value);
      const value = op === 'NOT' ? 1 - v[0] : op === 'NAND' ? 1 - (v[0] & v[1]) : 1 - (v[0] | v[1]);
      this.nets.set(id, {
        id,
        op,
        inputs,
        value,
        at: Math.max(...sources.map((net) => net.at)) + 1,
      });
      return id;
    };
    const logic = (id, op, a, b) => {
      let output, children;
      if (op === 'XOR') {
        const n = gate(id + '/nand-ab', 'NAND', [a, b]);
        const na = gate(id + '/nand-a', 'NAND', [a, n]),
          nb = gate(id + '/nand-b', 'NAND', [b, n]);
        output = gate(id + '/nand-out', 'NAND', [na, nb]);
        children = [n, na, nb, output];
      } else {
        const first = gate(id + '/first', op === 'AND' ? 'NAND' : 'NOR', [a, b]);
        output = gate(id + '/invert', 'NOT', [first]);
        children = [first, output];
      }
      this.nets.set(id, { ...this.nets.get(output), id, op, inputs: [a, b], children });
      return id;
    };
    let carry = input('c0', 0);
    for (let i = 0; i < 4; i++) {
      const a = input('a' + i, (this.a >> i) & 1),
        b = input('b' + i, (this.b >> i) & 1),
        prefix = 'bit' + i + '/';
      const xor = logic(prefix + 'xor-ab', 'XOR', a, b),
        ab = logic(prefix + 'and-ab', 'AND', a, b);
      const sum = logic(prefix + 'xor-sum', 'XOR', xor, carry),
        cin = logic(prefix + 'and-cin', 'AND', xor, carry);
      const cout = logic(prefix + 'or-carry', 'OR', ab, cin);
      this.bits.push({ a, b, cin: carry, sum, cout, gates: [xor, sum, ab, cin, cout] });
      carry = cout;
    }
    this.settled = Math.max(
      ...this.bits.flatMap((bit) => [bit.sum, bit.cout]).map((id) => this.nets.get(id).at),
    );
    this.period = this.settled + 3;
    this.sum = this.bits.reduce((value, bit, i) => value | (this.nets.get(bit.sum).value << i), 0);
    this.carry = this.nets.get(carry).value;
  }
  get done() {
    return this.time === this.period;
  }
  get r1() {
    return this.done ? this.sum : this.a;
  }
  get clockHigh() {
    return this.time < this.period / 2 || this.done;
  }
  get phase() {
    return this.done
      ? 'Запись по ↑ CLK'
      : this.time < 1
        ? 'Операнды в регистрах'
        : this.time < this.settled
          ? 'Сигналы проходят через логику'
          : 'Результат готов · ожидание ↑ CLK';
  }
  signal(id) {
    const net = this.nets.get(id);
    return net && this.time >= net.at ? net.value : null;
  }
  text(id) {
    return this.signal(id) ?? '…';
  }
  word(ids) {
    const bits = ids.map((id) => this.signal(id));
    return bits.some((bit) => bit === null) ? '…' : bits.reduce((n, bit, i) => n | (bit << i), 0);
  }
  begin() {
    if (this.done) {
      this.a = this.sum;
      this.time = 0;
      this.build();
    }
  }
  advance(time) {
    const previous = this.time;
    this.time = Math.max(previous, Math.min(this.period, time));
    if (previous < this.period && this.done) this.cycles++;
  }
  step(points) {
    this.begin();
    const next = [1, ...points, this.settled, this.period]
      .sort((a, b) => a - b)
      .find((t) => t > this.time + 0.0001);
    this.advance(next ?? this.period);
  }
  snapshot() {
    return { a: this.a, b: this.b, cycles: this.cycles, time: this.time };
  }
}
export { CpuCycle };
