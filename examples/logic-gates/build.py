"""Eight gates share symbols, input order, typography and truth-table geometry."""
from pathlib import Path
import sys
import os
sys.path.insert(0, os.environ.get('VISUAL_STORY_TOOLS', str(Path(__file__).resolve().parents[2] / 'tools')))
from svg_style import themed

HERE = Path(__file__).resolve().parent
gates = [('BUFFER', 'Повторяет вход', 'buffer', False), ('NOT', 'Меняет 0 и 1', 'buffer', True),
         ('AND', 'Оба входа равны 1', 'and', False), ('NAND', 'Инверсия AND', 'and', True),
         ('OR', 'Хотя бы один вход равен 1', 'or', False), ('NOR', 'Инверсия OR', 'or', True),
         ('XOR', 'Входы различаются', 'xor', False), ('XNOR', 'Входы совпадают', 'xor', True)]
parts = []
def text(x, y, value, cls='', anchor='middle'):
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{value}</text>'
for n, (name, meaning, kind, invert) in enumerate(gates):
    x, y = 24 + (n % 2) * 440, 106 + (n // 2) * 256
    unary = kind == 'buffer'
    shape = {'buffer': 'M158 40Q159 76 158 112L224 76Z', 'and': 'M158 40H187C237 40 237 112 187 112H158Z',
             'or': 'M150 40Q175 76 150 112Q205 112 230 76Q205 40 150 40Z',
             'xor': 'M143 40Q168 76 143 112 M156 40Q181 76 156 112Q211 112 236 76Q211 40 156 40Z'}[kind]
    edge = 224 if kind in ('buffer', 'and') else 230 if kind == 'or' else 236
    wires = 'M98 76H158' if unary else f'M98 56H{158 if kind == "and" else 162} M98 96H{158 if kind == "and" else 162}'
    diagram = f'<path class="wire" d="{wires} M{edge + (16 if invert else 0)} 76H310"/><path class="wire gate-body" d="{shape}"/>'
    if invert: diagram += f'<circle class="wire" cx="{edge + 8}" cy="76" r="8"/>'
    diagram += text(83, 83, 'A') if unary else text(83, 63, 'A') + text(83, 103, 'B')
    diagram += text(326, 83, 'Y')
    cases = [(0,), (1,)] if unary else [(0,0), (0,1), (1,0), (1,1)]
    table = text(43, 165, 'A' if unary else 'A B', 'note') + text(43, 205, 'Y', 'note')
    for i, pair in enumerate(cases):
        a, b = pair[0], pair[-1]
        value = a if unary else (a & b) if kind == 'and' else (a | b) if kind == 'or' else a ^ b
        if invert: value = 1 - value
        column = 143 + i * (145 if unary else 65)
        table += text(column, 165, ' '.join(map(str,pair))) + text(column, 205, str(value), 'active' if value else '')
    table += '<path class="rule" d="M20 180Q208 179 395 180"/>'
    parts.append(f'<g id="{name.lower()}" style="--ve-accent:var(--ve-{"purple" if invert else "blue"});--ve-wash:var(--ve-{"purple" if invert else "blue"}-wash)" transform="translate({x} {y})">'+text(210,0,name,'gate-name')+diagram+text(210,132,meaning,'note')+table+'</g>')
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="904" height="1130" viewBox="0 0 904 1130" role="img" aria-labelledby="title desc">
<title id="title">Логические элементы</title><desc id="desc">Восемь элементов, их условные обозначения и таблицы истинности. В каждой паре справа инверсия левого элемента; кружок у выхода означает инверсию. Порядок входов во всех таблицах одинаков.</desc>
<style>text{font-family:inherit;fill:var(--ve-ink);font-size:23px}.heading{font-size:34px}.gate-name{font-size:27px}.note{font-size:18px;fill:var(--ve-muted)}.active{fill:var(--ve-accent)}.gate-name{fill:var(--ve-accent)}.wire.gate-body{fill:var(--ve-wash);stroke:var(--ve-accent)}.wire{fill:none;stroke:var(--ve-ink);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.rule{fill:none;stroke:var(--ve-pencil);stroke-width:1}</style>
'''+text(452,43,'Логические элементы','heading')+'\n'.join(parts)+'</svg>'
(Path(os.environ.get('VISUAL_STORY_OUTPUT', HERE))/'logic-gates.svg').write_text(themed(svg))
