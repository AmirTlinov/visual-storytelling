#!/usr/bin/env python3
"""Добавить корневые title и desc к экспортированному SVG."""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
KNOWN_NAMESPACES = {
    "": SVG_NS,
    "cc": "http://creativecommons.org/ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "xlink": "http://www.w3.org/1999/xlink",
}

for prefix, namespace in KNOWN_NAMESPACES.items():
    ET.register_namespace(prefix, namespace)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def unique_id(root: ET.Element, base: str) -> str:
    used = {element.get("id") for element in root.iter() if element.get("id")}
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def direct_child(root: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in root if local_name(child.tag) == name), None)


def add_accessibility(tree: ET.ElementTree, title: str, description: str) -> None:
    root = tree.getroot()
    if local_name(root.tag) != "svg":
        raise ValueError("корневой элемент должен быть <svg>")
    if root.tag.startswith("{") and not root.tag.startswith("{" + SVG_NS + "}"):
        raise ValueError("корневой <svg> использует неизвестное пространство имён")
    namespace = f"{{{SVG_NS}}}" if root.tag.startswith("{") else ""

    title_element = direct_child(root, "title")
    if title_element is None:
        title_element = ET.Element(f"{namespace}title")
        root.insert(0, title_element)
    title_element.text = title
    if not title_element.get("id"):
        title_element.set("id", unique_id(root, "svg-title"))

    description_element = direct_child(root, "desc")
    if description_element is None:
        description_element = ET.Element(f"{namespace}desc")
        root.insert(1, description_element)
    description_element.text = description
    if not description_element.get("id"):
        description_element.set("id", unique_id(root, "svg-description"))

    root.set("role", "img")
    root.set(
        "aria-labelledby",
        f"{title_element.get('id')} {description_element.get('id')}",
    )


def write_atomic(tree: ET.ElementTree, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=target.parent, prefix=f".{target.name}.", delete=False
        ) as handle:
            temporary = Path(handle.name)
            tree.write(handle, encoding="utf-8", xml_declaration=True)
        temporary.replace(target)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Добавить доступное название и описание к SVG."
    )
    parser.add_argument("svg", type=Path, help="Путь к исходному SVG")
    parser.add_argument("--title", required=True, help="Краткое название изображения")
    parser.add_argument(
        "--description",
        required=True,
        help="Описание показанного отношения или результата",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Новый SVG; без этого параметра исходный файл обновляется атомарно",
    )
    args = parser.parse_args()

    title = args.title.strip()
    description = args.description.strip()
    if not title:
        parser.error("--title должен содержать текст")
    if not description:
        parser.error("--description должен содержать текст")
    if not args.svg.is_file():
        parser.error(f"файл не найден: {args.svg}")

    try:
        tree = ET.parse(args.svg)
        add_accessibility(tree, title, description)
        target = args.output or args.svg
        write_atomic(tree, target)
        ET.parse(target)
    except (ET.ParseError, OSError, ValueError) as error:
        print(f"SVG_ACCESSIBILITY_ERROR {error}", file=sys.stderr)
        return 1

    print(f"SVG_ACCESSIBLE path={target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
