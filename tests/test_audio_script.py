"""Cue intent must survive alignment without changing any spoken-word boundaries."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'audio'))
from script import read_script, timed_cues, check_timeline
from resources import SPEECH_REPO, SPEECH_REVISION


class NarrationCues(unittest.TestCase):
    def test_gallery_audio_matches_its_current_script_and_pcm_duration(self):
        examples = Path(__file__).resolve().parents[1] / 'examples'
        catalog = json.loads((examples / 'catalog.json').read_text())
        for name in catalog:
            source = examples / name / 'narration.json'
            if not source.exists():
                continue
            with self.subTest(scene=name):
                timeline = json.loads((source.parent / 'timeline.json').read_text())
                check_timeline(source, source.parent / 'timeline.json')
                self.assertEqual(timeline['synthesis']['model'], SPEECH_REPO)
                self.assertEqual(timeline['synthesis']['revision'], SPEECH_REVISION)
                script = read_script(source)
                cues = {}
                for segment, aligned in zip(script['segments'], timeline['segments'], strict=True):
                    self.assertEqual(segment['spoken'], aligned['text'])
                    self.assertEqual(segment.get('title'), aligned.get('title'))
                    cues.update(timed_cues(segment, aligned['words']))
                self.assertEqual(timeline['cues'], cues)
                for key in ('audio', 'voice', 'music'):
                    if timeline[key]:
                        with wave.open(str(source.parent / timeline[key])) as audio:
                            self.assertAlmostEqual(timeline['duration'], audio.getnframes() / audio.getframerate(), places=6)

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

    def test_repeated_quote_requires_occurrence(self):
        spec = {"version":3, "segments":[{"id":"line", "text":"Два и два.", "cues":[{"id":"second", "quote":"два"}]}]}
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder)/"script.json"
            script.write_text(json.dumps(spec))
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                read_script(script)
            spec["segments"][0]["cues"][0]["occurrence"] = 2
            script.write_text(json.dumps(spec))
            self.assertEqual(read_script(script)["segments"][0]["cues"][0]["word_start"], 2)

    def test_emotions_stay_in_synthesis_and_leave_spoken_cues(self):
        text = "<|style:whispering|>Сначала тихо. <|emotion:surprise|>А теперь — два предмета!"
        spec = {"version": 3, "segments": [{"id": "line", "text": text,
                "cues": [{"id": "count", "quote": "два предмета"}]}]}
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "script.json"
            script.write_text(json.dumps(spec, ensure_ascii=False))
            segment = read_script(script)["segments"][0]
            self.assertEqual(segment["text"], text)
            self.assertEqual(segment["spoken"], "Сначала тихо. А теперь — два предмета!")
            self.assertEqual((segment["cues"][0]["word_start"], segment["cues"][0]["word_end"]), (4, 6))


if __name__ == '__main__':
    unittest.main()
