"""Регрессии проверки корневых описаний и локальных ссылок SVG."""

from pathlib import Path
import tempfile
import unittest

from render_svg import validate_svg


METADATA = "<title>Схема</title><desc>Связь двух состояний.</desc>"


class ValidateSvgTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="svg-validation-")
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "figure.svg"

    def validate(self, body: str = "", metadata: str = METADATA) -> None:
        self.path.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'
            f"{metadata}{body}</svg>",
            encoding="utf-8",
        )
        validate_svg(self.path)

    def test_root_metadata_is_required(self) -> None:
        for metadata in ("", f"<g>{METADATA}</g>"):
            with self.subTest(metadata=metadata), self.assertRaisesRegex(ValueError, "title"):
                self.validate(metadata=metadata)

    def test_each_root_description_must_contain_text(self) -> None:
        for name, other in (("title", "desc"), ("desc", "title")):
            for empty in (f"<{name}/>", f"<{name}> \n\t </{name}>"):
                metadata = f"{empty}<{other}>Текст</{other}><g>{METADATA}</g>"
                with self.subTest(name=name, empty=empty):
                    with self.assertRaisesRegex(ValueError, name):
                        self.validate(metadata=metadata)

    def test_missing_css_targets_are_rejected(self) -> None:
        for value in ("url(#missing)", "url('#missing')", 'URL( "#missing" )'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "missing"):
                self.validate(f"<style><![CDATA[rect {{ fill: {value}; }}]]></style><rect/>")

    def test_existing_css_targets_are_accepted(self) -> None:
        self.validate(
            '<defs><linearGradient id="paint"/><clipPath id="clip"/></defs>'
            '<style>rect { fill: url( "#paint" ); clip-path: url(#clip); }</style>'
            '<rect style="fill: url(\'#paint\')"/>'
        )

    def test_comments_and_literal_strings_are_ignored(self) -> None:
        self.validate(
            "<style><![CDATA["
            "/* rect { fill: url(#old); } */"
            "text::after { content: 'url(#example)'; }"
            "]]></style>"
        )

    def test_real_reference_after_comment_and_string_is_checked(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing"):
            self.validate(
                "<style><![CDATA[/* url(#old) */"
                "text::after { content: 'url(#example)'; fill: url(#missing); }"
                "]]></style>"
            )

    def test_missing_attribute_targets_are_rejected(self) -> None:
        for body in ('<rect fill="url(#missing)"/>', '<use href="#missing"/>'):
            with self.subTest(body=body), self.assertRaisesRegex(ValueError, "missing"):
                self.validate(body)


if __name__ == "__main__":
    unittest.main()
