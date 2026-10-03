"""Cue intent must survive alignment without changing any spoken-word boundaries."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'audio'))
from script import read_script, timed_cues


class NarrationCues(unittest.TestCase):
    def script(self, cue):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'narration.json'
            path.write_text(json.dumps({
                'version': 3, 'music': None, 'segments': [{
                    'id': 'chapter', 'text': 'Перенесём две фишки.', 'cues': [cue],
                }],
            }))
            return read_script(path)

    def test_aligned_action_and_hold_preserve_words(self):
        words = [{'text': text, 'start': i + 1, 'end': i + 1.5}
                 for i, text in enumerate(['Перенесём', 'две', 'фишки'])]
        for kind, meaning in [('action', 'Две фишки меняют положение'), ('hold', 'Пересчитать две фишки')]:
            segment = self.script({'id': 'move', 'quote': 'две фишки', kind: meaning})['segments'][0]
            cues = timed_cues(segment, words)
            self.assertEqual(cues['move'], {'text': 'две фишки', 'start': 2, 'end': 3.5, kind: meaning})
            self.assertEqual(cues['chapter']['end'], 3.5)

    def test_conflicting_or_empty_intent_is_rejected(self):
        for invalid in [{'action': 'move', 'hold': 'read'}, {'action': ''}, {'hold': 42}]:
            with self.assertRaisesRegex(ValueError, 'action or hold'):
                self.script({'id': 'move', 'quote': 'две фишки', **invalid})


if __name__ == '__main__':
    unittest.main()
