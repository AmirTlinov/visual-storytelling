# /// script
# requires-python = ">=3.12"
# dependencies = ["matplotlib==3.11.1", "numpy==2.5.3", "SciencePlots==2.2.2"]
# ///
"""One LC phase, a drawn circuit, and a standalone SVG with native SMIL time.
Run: uv run --python 3.12 build.py
"""
import sys
import os
from io import BytesIO
from math import cos, pi
from pathlib import Path
from xml.etree import ElementTree as ET
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scienceplots  # noqa: F401 -- registers the science style

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get("VISUAL_STORY_TOOLS", str(HERE.parents[1] / "tools")))
from svg_style import themed
from magnetic_field import SolenoidField

PERIOD, DURATION, SAMPLES = 4.0, 8.0, 481
WIDTH, HEIGHT = 720, 1038
TIMES = np.linspace(0, DURATION, SAMPLES)
PHASE = TIMES * 2 * pi / PERIOD
V, I = np.cos(PHASE), np.sin(PHASE)
INK, MUTED, PENCIL = "var(--ve-ink)", "var(--ve-muted)", "var(--ve-pencil)"
COPPER, BLUE, PURPLE = "var(--ve-orange)", "var(--ve-blue)", "var(--ve-purple)"
CX, LX, TOP, BOTTOM = 190, 512, 175, 455
COIL_TOP, COIL_BOTTOM = 260, 392
turns, coil_radius = 5, 44
WIRE_MID = (CX + LX) / 2
CURRENT_X = 282
PLATE_TOP, PLATE_BOTTOM, PLATE_HALF = 304, 348, 86
PLOT_X = 68 + 580 * TIMES / DURATION
PLOT_Y, AMPLITUDE = 790, 49


def el(parent, tag, **attrs):
    return ET.SubElement(parent, f"{{{NS}}}{tag}",
                         {k.replace("_", "-"): str(v) for k, v in attrs.items()})


def text(parent, value, **attrs):
    node = el(parent, "text", **attrs)
    node.text = value
    return node


def variable(parent, value, sub, **attrs):
    node = text(parent, value, **attrs)
    el(node, "tspan", font_size="65%", baseline_shift="sub").text = sub
    return node


def project(points):
    """One oblique projection for the winding and the magnetic field."""
    return np.column_stack((points[:, 0], -points[:, 1] + 7*(1 + points[:, 2]/coil_radius)))


def anim(parent, name, values):
    values = np.asarray(values)
    assert len(values) == SAMPLES and np.isfinite(values).all()
    return el(parent, "animate", attributeName=name,
              values=";".join(f"{v:.4f}" for v in values), dur=f"{DURATION:g}s",
              begin="0s", repeatCount="indefinite", calcMode="linear")


def translate_anim(parent, points):
    el(parent, "animateTransform", attributeName="transform", type="translate",
       begin="0s", dur=f"{DURATION:g}s", repeatCount="indefinite", calcMode="linear",
       values=";".join(f"{x:.3f} {y:.3f}" for x, y in points))


def faded(parent, ident, values):
    group = el(parent, "g", id=ident, opacity=f"{values[0]:.4f}")
    anim(group, "opacity", values)
    return group


def arrowhead(parent, x, y, dx, dy, color, size=5.5):
    length = np.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    return el(parent, "path", d=(
        f"M{x-size*ux-size*.42*uy:.3f} {y-size*uy+size*.42*ux:.3f} "
        f"Q{x-size*.55*ux:.3f} {y-size*.55*uy:.3f} {x:.3f} {y:.3f} "
        f"L{x-size*ux+size*.42*uy:.3f} {y-size*uy-size*.42*ux:.3f}"),
        fill="none", stroke=color, stroke_width=1.4,
        stroke_linecap="round", stroke_linejoin="round")


def plot_paths():
    """Sampled values own the curves; the pen treatment never changes the data."""
    with plt.style.context(["science", "no-latex"]), matplotlib.rc_context({"path.simplify": False}):
        fig = plt.figure(figsize=(WIDTH / 72, HEIGHT / 72), dpi=72)
        ax = fig.add_axes((0, 0, 1, 1), xlim=(0, WIDTH), ylim=(HEIGHT, 0))
        ax.set_axis_off()
        for name, values in (("voltage", V), ("current", I)):
            ax.plot(PLOT_X, PLOT_Y - AMPLITUDE * values, gid=name)
        out = BytesIO()
        fig.savefig(out, format="svg")
        plt.close(fig)
    root = ET.fromstring(out.getvalue())
    return [root.find(f".//{{{NS}}}g[@id='{name}']/{{{NS}}}path").get("d")
            for name in ("voltage", "current")]


svg = ET.Element(f"{{{NS}}}svg", {
    "width": str(WIDTH), "height": str(HEIGHT), "viewBox": f"0 0 {WIDTH} {HEIGHT}",
    "role": "img", "aria-labelledby": "title description",
    "data-period": str(PERIOD), "data-duration": str(DURATION),
})
el(svg, "title", id="title").text = "Колебательный LC-контур"
el(svg, "desc", id="description").text = (
    "Энергия колеблется между электрическим полем конденсатора и магнитным полем катушки. "
    "Заряд и напряжение следуют cos(theta), ток и магнитное поле — sin(theta). "
    "Два одинаковых квадрата под элементами показывают cos²(theta) и sin²(theta); сумма равна единице. "
    "Знаки на пластинах показывают суммарный заряд, синие носители со знаком минус распределены по длине проводника; их общий дрейф связан с интегралом тока и направлен против него. "
    "Силовые линии неподвижны; их яркость и направление меняются вместе с полем. "
    "Фрагмент поля показан в продольном сечении в одном масштабе с катушкой; часть линий продолжается за границами рисунка. "
    "График ниже показывает нормированные напряжение и ток; один период длится четыре секунды."
)
el(svg, "metadata").text = (
    "Original animation reference: https://x.com/Rainmaker1973/status/2100874136008413433, @eeanimation. "
    "Independent editable drawing. Ideal lumped lossless LC model. Magnetic streamlines: Biot-Savart quadrature of five coaxial circular turns, a finite-solenoid approximation to the helix; leads omitted. Representative lines lie in the axial z=0 plane, pass through both open ends and use the same undistorted spatial scale as the winding. The finite viewing window cuts distant return paths; no artificial closure or radial compression is applied. Line spacing is not a quantitative field-strength scale. "
    "Q_top/Qmax = v_C/Vmax = E_C/Emax = cos(2*pi*t/4); "
    "i_L/Imax = B_L/Bmax = sin(2*pi*t/4); i_L = -dQ_top/dt. "
    "Positive conventional current: upper plate -> upper wire -> coil -> lower wire -> lower plate. "
    "W_C/W = cos²; W_L/W = sin². Fixed-size net charge signs change spacing about the plate centre. "
    "Carrier samples have uniform true 3D arclength spacing. Displacement s(t)=s_rest+a*cos(theta) integrates electron current; ds/dt=-a*omega*sin(theta). One display scale a=0.24*sample_spacing enlarges local drift. No sample crosses another or the capacitor gap. "
    "Helix: x=R*sin(theta), y=-pitch*theta, z=-R*cos(theta), observer on +z. "
    "Increasing theta gives B downward on screen: top S, bottom N; back turns are lighter. "
    "Physics: https://openstax.org/books/university-physics-volume-2/pages/14-5-oscillations-in-an-lc-circuit ; "
    "Field: https://web.mit.edu/6.013_book/www/chapter8/Back/8.2.html"
)
el(svg, "style").text = """
  text { font-family: inherit; fill: var(--ve-ink); }
  .wire { fill: none; stroke: var(--ve-ink); stroke-width: 2;
          stroke-linecap: round; stroke-linejoin: round; }
  .note { fill: var(--ve-muted); }
"""
defs = el(svg, "defs")
text(svg, "Колебательный LC-контур", x=360, y=48, text_anchor="middle", font_size=33)
text(svg, "Энергия переходит между двумя полями", x=360, y=84,
     text_anchor="middle", font_size=20, **{"class": "note"})
text(svg, "Конденсатор C", x=CX, y=132, text_anchor="middle", font_size=22)
text(svg, "Катушка L", x=LX, y=132, text_anchor="middle", font_size=22)

# One unwarped axial section: dense axial lines open out beyond the ends.
# The window crops distant returns instead of squeezing them into false loops.
field = el(svg, "g", id="magnetic-field", fill="none", stroke_linecap="round")
field_lines = faded(field, "magnetic-field-lines", .64 * np.abs(I))
directions = {sign: faded(field, f"magnetic-field-{'forward' if sign > 0 else 'reverse'}",
                         .9 * np.maximum(sign * I, 0)) for sign in (1, -1)}
solenoid = SolenoidField(coil_radius, COIL_TOP, COIL_BOTTOM, turns)
for number, seed in enumerate((.24, .46, .64)):
    line = solenoid.line(coil_radius*seed, radial_limit=188, axial_limit=485)
    radial, axial = line.T
    crossing = np.flatnonzero((axial[:-1] < COIL_BOTTOM) & (axial[1:] >= COIL_BOTTOM))[0]
    end_radius = np.interp(COIL_BOTTOM, axial[crossing:crossing+2], radial[crossing:crossing+2])
    assert end_radius < coil_radius-3, "Field lines must pass through the open ends"
    closed = np.linalg.norm(line[0]-line[-1]) < 1e-8
    for side in (-1, 1):
        world = np.column_stack((LX + side*radial, -axial, np.zeros(len(line))))
        points = project(world)
        el(field_lines, "path", id=f"flux-{'left' if side < 0 else 'right'}-{number}",
           d="M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in points),
           stroke=PURPLE, stroke_width=1.2)
        indices = []
        if number != 1:
            target_y = COIL_TOP+48 if number == 0 else COIL_BOTTOM-38
            indices.append(int(np.argmin(abs(axial-target_y) + 4*abs(radial-coil_radius*seed))))
        if closed:
            indices.append(int(np.argmax(radial)))
        for index in indices:
            point = points[index]
            tangent = points[(index+1) % len(points)] - points[(index-1) % len(points)]
            for sign, group in directions.items():
                arrowhead(group, *point, *(sign*tangent), PURPLE, 5.5)
text(field_lines, "B", x=LX, y=339, text_anchor="middle", font_size=21, style=f"fill:{PURPLE}")
poles = el(svg, "g", id="magnetic-poles", text_anchor="middle", font_size=17)
for sign, top, bottom in ((1, "S", "N"), (-1, "N", "S")):
    group = faded(poles, f"poles-{'forward' if sign > 0 else 'reverse'}", np.minimum(1, np.maximum(sign*I, 0)*5))
    for end, symbol, y in (("top", top, COIL_TOP-20), ("bottom", bottom, COIL_BOTTOM+50)):
        text(group, symbol, id=f"pole-{end}-{'forward' if sign > 0 else 'reverse'}",
             x=LX, y=y, style=f"fill:{PURPLE}")

circuit = el(svg, "g", id="circuit")
# Fixed pen deviations; the conductor and carrier lane use the same points.
upper_wire = np.array([(CX, PLATE_TOP), (CX-.5, (PLATE_TOP+TOP)/2), (CX, TOP+4), (CX+4, TOP),
                       (WIRE_MID, TOP+.7), (LX-28, TOP), (LX-24, TOP+4), (LX-24, COIL_TOP-14), (LX, COIL_TOP)])
lower_wire = np.array([(LX, COIL_BOTTOM), (LX-24, COIL_BOTTOM+14), (LX-24, BOTTOM-4), (LX-28, BOTTOM), (WIRE_MID, BOTTOM-.6), (CX+4, BOTTOM),
                       (CX, BOTTOM-4), (CX+.4, (BOTTOM+PLATE_BOTTOM)/2), (CX, PLATE_BOTTOM)])
for points in (upper_wire, lower_wire):
    el(circuit, "path", d="M" + " L".join(f"{x:.3f} {y:.3f}" for x, y in points), **{"class": "wire"})
samples_per_turn = 120
theta = np.linspace(0, 2*pi*turns, turns*samples_per_turn+1)
fraction = theta/(2*pi*turns)
pen = np.sin(pi*fraction)
coil_world = np.column_stack((LX+coil_radius*np.sin(theta), -(COIL_TOP+(COIL_BOTTOM-COIL_TOP)*fraction), -coil_radius*np.cos(theta)))
coil_points = project(coil_world) + np.column_stack((.42*pen*np.sin(theta*1.3), .25*pen*np.sin(theta*.8)))
coil = el(circuit, "g", id="coil", fill="none", stroke_linecap="round", stroke_linejoin="round")
boundaries = [0, *range(30, len(theta), 60), len(theta)-1]
for front in (False, True):
    group = el(coil, "g", id=f"coil-{'front' if front else 'back'}", stroke=COPPER,
               stroke_opacity=1 if front else .40, stroke_width=3.15 if front else 2.3)
    for first, last in zip(boundaries, boundaries[1:]):
        if (cos(theta[(first+last)//2]) < 0) != front:
            continue
        el(group, "path", d="M" + " L".join(f"{x:.3f} {y:.3f}" for x, y in coil_points[first:last+1]))
# The z=0 field section lies in front of the rear turns and behind the front turns.
svg.remove(field)
coil.insert(1, field)

capacitor = el(circuit, "g", id="capacitor")
metal = el(capacitor, "g", id="neutral-matter", fill="none", stroke=COPPER,
           stroke_width=3.15, stroke_linecap="round")
el(metal, "path", id="capacitor-leads", d=f"M{CX} 277Q{CX-.3} 292 {CX} {PLATE_TOP} M{CX} {PLATE_BOTTOM}Q{CX+.3} 362 {CX} 377")
for name, y in (("top", PLATE_TOP), ("bottom", PLATE_BOTTOM)):
    el(metal, "path", id=f"plate-{name}", d=f"M{CX-PLATE_HALF} {y}Q{CX} {y-.55} {CX+PLATE_HALF} {y}")
charge_clip = el(defs, "clipPath", id="charge-window", clipPathUnits="userSpaceOnUse")
el(charge_clip, "rect", x=CX-PLATE_HALF, y=281, width=PLATE_HALF*2, height=91)
surface = el(capacitor, "g", id="surface-charge", text_anchor="middle", clip_path="url(#charge-window)")
charge_spacing = 15 / np.maximum(np.abs(V), .01)
for sign in (1, -1):
    group = faded(surface, f"surface-{'forward' if sign > 0 else 'reverse'}", (sign*V > 1e-10).astype(float))
    for column in range(-6, 6):
        offset = column + .5
        xs = CX + offset*charge_spacing
        pair = el(group, "g", data_offset=offset, transform=f"translate({xs[0]:.3f} 0)")
        translate_anim(pair, zip(xs, np.zeros(SAMPLES)))
        for plate, polarity, y in (("top", sign, 296), ("bottom", -sign, 366)):
            text(pair, "+" if polarity > 0 else "−", x=0, y=y, font_size=13,
                 style=f"fill:{COPPER if polarity > 0 else BLUE}", data_plate=plate)

electric = el(svg, "g", id="electric-field", fill="none", stroke=COPPER, stroke_width=1.35)
for sign in (1, -1):
    group = faded(electric, f"electric-field-{'forward' if sign > 0 else 'reverse'}", np.maximum(sign*V, 0))
    for x in (CX-44, CX, CX+44):
        y1, y2 = (313, 339) if sign > 0 else (339, 313)
        el(group, "path", d=f"M{x} {y1}Q{x+.35} 326 {x} {y2}", stroke_linecap="round")
        arrowhead(group, x, y2, 0, sign, COPPER, 4.5)
    text(group, "E", x=CX-PLATE_HALF-20, y=334, font_size=22, style=f"fill:{COPPER}", stroke="none")
neutral_charge = faded(svg, "neutral-charge", np.maximum(0, 1-np.abs(V)*8))
text(neutral_charge, "Q = 0", x=CX, y=333, text_anchor="middle", font_size=18, **{"class": "note"})
neutral_field = faded(svg, "neutral-field", np.maximum(0, 1-np.abs(I)*8))
text(neutral_field, "B = 0", x=LX+68, y=COIL_TOP-18, text_anchor="middle", font_size=18, **{"class": "note"})

# Equal spacing and displacement use true conductor arclength, before projection.
# The helix and the wires share endpoints in world space; the sketch is its display.
wire_lane = np.vstack((upper_wire, coil_points[1:], lower_wire[1:]))
upper_world = np.column_stack((upper_wire[:,0], -upper_wire[:,1], np.full(len(upper_wire), -coil_radius)))
lower_world = np.column_stack((lower_wire[:,0], -lower_wire[:,1], np.full(len(lower_wire), -coil_radius)))
wire_world = np.vstack((upper_world, coil_world[1:], lower_world[1:]))
wire_lengths = np.r_[0, np.cumsum(np.linalg.norm(np.diff(wire_world, axis=0), axis=1))]
carrier_count = 24
carrier_pitch = wire_lengths[-1] / carrier_count
carrier_sites = (np.arange(carrier_count) + .5) * carrier_pitch
# s(t) = s_rest + a*Q(t)/Qmax, hence ds/dt = -a*omega*i(t)/Imax.
# One display scale enlarges drift to 24% of sample spacing; identities never cross.
DRIFT = .24 * carrier_pitch
# Straight leads stay visible; winding depth is the actual normalized z coordinate.
wire_depth = np.r_[np.ones(len(upper_wire)), (coil_world[:,2]/coil_radius)[1:], np.ones(len(lower_wire)-1)]
electron_symbol = el(defs, "g", id="electron-symbol")
el(electron_symbol, "circle", r=5.1, fill=BLUE)
el(electron_symbol, "path", d="M-2.3 .05Q0 -.12 2.3 0", fill="none",
   stroke="var(--ve-surface)", stroke_width=1.25, stroke_linecap="round")
electrons = el(defs, "g", id="negative-carriers", data_sample_count=carrier_count,
               data_drift_amplitude=f"{DRIFT:.4f}", data_spacing=f"{carrier_pitch:.4f}")
# Both paint layers reference the same animated carriers; depth alone selects a layer.
back_carriers = el(coil, "g", id="carriers-back")
coil.remove(back_carriers)
coil.insert(1, back_carriers)
front_carriers = el(svg, "g", id="carriers-front")
for number, site in enumerate(carrier_sites):
    distances = site + DRIFT*V
    assert distances.min() > 0 and distances.max() < wire_lengths[-1]
    positions = np.column_stack([np.interp(distances, wire_lengths, wire_lane[:,j]) for j in (0, 1)])
    front = (np.interp(distances, wire_lengths, wire_depth) >= 0).astype(float)
    carrier = el(electrons, "g", id=f"electron-{number}", data_arclength=f"{site:.4f}",
                 transform=f"translate({positions[0,0]:.3f} {positions[0,1]:.3f})")
    el(carrier, "use", href="#electron-symbol")
    translate_anim(carrier, positions)
    for layer, visibility in ((back_carriers, .68*(1-front)), (front_carriers, front)):
        paint = el(layer, "use", href=f"#electron-{number}", opacity=f"{visibility[0]:.4f}")
        anim(paint, "opacity", visibility)
el(svg, "use", href="#electron-symbol", transform="translate(253 484)")
text(svg, "электроны", x=266, y=490, font_size=16, style=f"fill:{BLUE}")

# Current and electron motion are compared along the same upper wire.
for name, direction, y in (("current", 1, TOP-18), ("electron", -1, TOP+23)):
    arrow_group = faded(svg, f"{name}-direction", np.minimum(1, np.abs(I)*8))
    arrow = el(arrow_group, "line", id=f"{name}-vector", x1=CURRENT_X, x2=CURRENT_X, y1=y, y2=y,
               stroke=BLUE, stroke_width=1.7, stroke_linecap="round")
    anim(arrow, "x1", CURRENT_X-29*direction*I)
    anim(arrow, "x2", CURRENT_X+29*direction*I)
    for sign in (1, -1):
        head = faded(arrow_group, f"{name}-head-{'forward' if sign > 0 else 'reverse'}",
                     np.minimum(1, np.maximum(sign*direction*I, 0)*8))
        tip = el(head, "g", transform=f"translate({CURRENT_X} {y})")
        arrowhead(tip, 0, 0, sign, 0, BLUE, 6)
        translate_anim(tip, zip(CURRENT_X+29*direction*I, np.full(SAMPLES, y)))
    label = text(arrow_group, "i" if name == "current" else "e", x=CURRENT_X,
                 y=y-12 if name == "current" else y+25, text_anchor="middle", font_size=22, style=f"fill:{BLUE}")
    if name == "electron":
        el(label, "tspan", baseline_shift="super", font_size="65%").text = "−"

energy = el(svg, "g", id="field-energy")
for cx, key, sub, label, share, color in (
    (CX, "capacitor", "C", "электрическое поле", V*V, COPPER),
    (LX, "inductor", "L", "магнитное поле", I*I, PURPLE),
):
    x, y, side = cx-26, 535, 52
    variable(energy, "W", sub, x=cx, y=520, text_anchor="middle", font_size=23, style=f"fill:{color}")
    clip = el(defs, "clipPath", id=f"energy-{key}-clip")
    window = el(clip, "rect", x=x-1, y=y+side*(1-share[0]), width=side+2, height=side*share[0])
    anim(window, "y", y+side*(1-share))
    anim(window, "height", side*share)
    d = f"M{x+2} {y}Q{cx} {y-.7} {x+side-2} {y}Q{x+side} {y} {x+side} {y+2}Q{x+side+.7} {y+26} {x+side} {y+side-2}Q{x+side} {y+side} {x+side-2} {y+side}Q{cx} {y+side+.7} {x+2} {y+side}Q{x} {y+side} {x} {y+side-2}Q{x-.7} {y+26} {x} {y+2}Q{x} {y} {x+2} {y}Z"
    el(energy, "path", d=d, fill=color, fill_opacity=.34, clip_path=f"url(#energy-{key}-clip)")
    el(energy, "path", d=d, fill="none", stroke=color, stroke_width=1.4, stroke_linejoin="round")
    text(energy, label, x=cx, y=614, text_anchor="middle", font_size=19, style=f"fill:{color}")
el(energy, "path", d=f"M{CX+45} 561Q{WIRE_MID} 557 {LX-45} 561", fill="none", stroke=PENCIL, stroke_width=1.3)
arrowhead(energy, CX+45, 561, -1, 0, PENCIL, 7)
arrowhead(energy, LX-45, 561, 1, 0, PENCIL, 7)
sum_label = variable(energy, "W", "C", id="energy-conservation", x=WIRE_MID, y=660, text_anchor="middle", font_size=24)
el(sum_label, "tspan", baseline_shift="baseline").text = " + W"
el(sum_label, "tspan", baseline_shift="sub", font_size="65%").text = "L"
el(sum_label, "tspan", baseline_shift="baseline").text = " = const"

# Faint complete curves give context; the growing stroke and points show the phase.
clip = el(defs, "clipPath", id="trace-window", clipPathUnits="userSpaceOnUse")
window = el(clip, "rect", x=66, y=PLOT_Y-55, width=PLOT_X[0]-66, height=112)
anim(window, "width", PLOT_X-66)
axes = el(svg, "g", id="plot-axes", fill="none", stroke=PENCIL, stroke_width=1)
el(axes, "path", d=f"M68 {PLOT_Y+58}V{PLOT_Y-54} M68 {PLOT_Y}H660", stroke_linecap="round")
arrowhead(axes, 660, PLOT_Y, 1, 0, PENCIL, 5)
text(svg, "t", x=669, y=PLOT_Y+7, font_size=18)
for seconds, value in ((0, "0"), (4, "T"), (8, "2T")):
    x = 68 + 580*seconds/DURATION
    el(axes, "path", d=f"M{x} {PLOT_Y+57}v5")
    text(svg, value, x=x, y=PLOT_Y+81, font_size=17, text_anchor="middle", **{"class": "note"})
legend = el(svg, "g", id="plot-legend")
waveforms = el(svg, "g", id="waveforms", fill="none", stroke_linecap="round", stroke_linejoin="round")
for name, sub, data, d, color, x in zip(("voltage", "current"), ("C", "L"), (V, I), plot_paths(), (COPPER, BLUE), (76, 236)):
    variable(legend, "v" if name == "voltage" else "i", sub, x=x, y=PLOT_Y-70, font_size=23, style=f"fill:{color}")
    text(legend, "напряжение" if name == "voltage" else "ток", x=x+31, y=PLOT_Y-70, font_size=17, style=f"fill:{color}")
    el(waveforms, "path", d=d, stroke=color, stroke_width=1.3, stroke_opacity=.18)
    el(waveforms, "path", id=f"{name}-trace", d=d, stroke=color, stroke_width=2.2, clip_path="url(#trace-window)")
    point = el(waveforms, "circle", id=f"{name}-point", cx=PLOT_X[0], cy=PLOT_Y-AMPLITUDE*data[0], r=3.1, fill=color)
    anim(point, "cx", PLOT_X)
    anim(point, "cy", PLOT_Y-AMPLITUDE*data)
cursor = el(svg, "path", d=f"M360 {PLOT_Y-48}V{PLOT_Y+50}", id="phase-cursor", stroke=PENCIL, stroke_width=.8, stroke_opacity=.5)
translate_anim(cursor, zip(PLOT_X-360, np.zeros(SAMPLES)))

# The equation follows the graph on its own line, with a clear reading gap.
equation = el(svg, "g", id="equation", transform="translate(270 909)", font_size=20, aria_label="Вторая производная напряжения плюс напряжение, делённое на LC, равна нулю")
variable(equation, "d²v", "C", x=0, y=0)
text(equation, "dt²", x=11, y=52)
text(equation, "+", x=62, y=30)
variable(equation, "v", "C", x=104, y=0, text_anchor="middle")
text(equation, "LC", x=104, y=52, text_anchor="middle")
text(equation, "= 0", x=133, y=30)
el(equation, "path", id="fraction-bars", d="M-3 22Q22 21.4 47 22 M85 22Q104 22.6 123 22",
   fill="none", stroke=INK, stroke_width=1.1, stroke_linecap="round")
text(svg, "Знаки ± — заряд пластин · синие носители − — электроны", id="model-note",
     x=360, y=1001, text_anchor="middle", font_size=14, **{"class": "note"})
text(svg, "Фрагмент поля в продольном сечении · дрейф увеличен",
     x=360, y=1024, text_anchor="middle", font_size=14, **{"class": "note"})

ET.indent(svg, space="  ")
target = HERE / "LC-oscillator.svg"
target.write_text(themed(ET.tostring(svg, encoding="unicode")))
print(f"Wrote {target} ({target.stat().st_size:,} bytes)")
assert np.max(np.abs(V*V + I*I - 1)) < 1e-12
assert all(abs(float(values[0]-values[-1])) < 1e-12 for values in (V, I))
assert 2*DRIFT < np.min(np.diff(carrier_sites))
assert np.all((-DRIFT*(2*pi/PERIOD)*I)*I <= 0)
assert not svg.findall(f".//{{{NS}}}animate[@attributeName='stroke-dashoffset']")
