#!/usr/bin/env python3
"""Проверить структуру SVG и создать PNG с сохранённым отношением сторон."""

from __future__ import annotations

import argparse
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
CSS_URL_REF = re.compile(
    r'''/\*.*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|'''
    r'''(?<![-\w])url\(\s*(?P<quote>['"]?)#(?P<id>[^'"\s)]+)(?P=quote)\s*\)''',
    re.IGNORECASE | re.DOTALL,
)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def css_references(value: str) -> set[str]:
    """Собрать локальные url(...), пропуская CSS-комментарии и обычные строки."""
    return {match["id"] for match in CSS_URL_REF.finditer(value) if match["id"]}


def parse_view_box(root: ET.Element) -> tuple[float, float, float, float]:
    raw = root.get("viewBox")
    if raw is None:
        raise ValueError("корневой <svg> должен иметь viewBox")
    values = [float(part) for part in re.split(r"[\s,]+", raw.strip()) if part]
    if len(values) != 4:
        raise ValueError("viewBox должен содержать четыре числа")
    x, y, width, height = values
    if not all(math.isfinite(value) for value in values) or width <= 0 or height <= 0:
        raise ValueError("viewBox должен задавать конечную положительную область")
    return x, y, width, height


def validate_svg(path: Path) -> tuple[ET.Element, float]:
    tree = ET.parse(path)
    root = tree.getroot()
    if local_name(root.tag) != "svg":
        raise ValueError("корневой элемент должен быть <svg>")
    if root.tag.startswith("{") and not root.tag.startswith("{" + SVG_NS + "}"):
        raise ValueError("корневой <svg> использует неизвестное пространство имён")

    _, _, width, height = parse_view_box(root)
    namespace = f"{{{SVG_NS}}}" if root.tag.startswith("{") else ""
    for name in ("title", "desc"):
        metadata = root.find(f"{namespace}{name}")
        if metadata is None or not "".join(metadata.itertext()).strip():
            raise ValueError(f"корневой <svg> должен содержать непустой дочерний <{name}>")

    ids: set[str] = set()
    references: set[str] = set()

    for element in root.iter():
        name = local_name(element.tag)
        if name == "style":
            references.update(css_references("".join(element.itertext())))
        identifier = element.get("id")
        if identifier:
            if identifier in ids:
                raise ValueError(f"повторяющийся id: {identifier}")
            ids.add(identifier)
        if element.text and "\ufffd" in element.text:
            raise ValueError("текст содержит символ замены U+FFFD")
        for key, value in element.attrib.items():
            if "\ufffd" in value:
                raise ValueError(f"атрибут {key} содержит символ замены U+FFFD")
            references.update(css_references(value))
            if local_name(key) == "href" and value.startswith("#"):
                references.add(value[1:])

    missing = sorted(references - ids)
    if missing:
        raise ValueError("отсутствуют элементы для ссылок: " + ", ".join(missing))
    return root, height / width


def render(path: Path, output: Path, width: int, aspect: float) -> tuple[int, int]:
    renderer = shutil.which("rsvg-convert")
    if renderer is None:
        raise RuntimeError("для точного PNG-рендера нужен rsvg-convert")
    height = max(1, round(width * aspect))
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [renderer, "-w", str(width), "-h", str(height), str(path), "-o", str(output)],
        check=True,
    )
    return width, height


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Проверить SVG и создать полноразмерный PNG-рендер."
    )
    parser.add_argument("svg", type=Path, help="Путь к исходному SVG")
    parser.add_argument("--output", type=Path, help="Путь к PNG")
    parser.add_argument("--width", type=int, default=1600, help="Ширина PNG")
    parser.add_argument(
        "--validate-only", action="store_true", help="Проверить структуру без рендера"
    )
    args = parser.parse_args()

    if args.width <= 0:
        parser.error("--width должен быть положительным")
    if not args.svg.is_file():
        parser.error(f"файл не найден: {args.svg}")

    try:
        _, aspect = validate_svg(args.svg)
        if args.validate_only:
            print(f"SVG_VALID path={args.svg}")
            return 0
        output = args.output or Path(tempfile.gettempdir()) / f"{args.svg.stem}.preview.png"
        width, height = render(args.svg, output, args.width, aspect)
    except (ET.ParseError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"SVG_INVALID {error}", file=sys.stderr)
        return 1

    print(f"SVG_RENDERED path={output} size={width}x{height}")
    print("Открой PNG через view_image и проведи целое, уменьшенное и детальное чтение.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
