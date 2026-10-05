"""Script controls, cue intent and audition safety without loading audio models."""
import json
from contextlib import redirect_stdout
import io
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'audio'))
from script import read_script, timed_cues, check_action_windows, check_timeline
from resources import SPEECH_REPO, SPEECH_REVISION
from audition import audition


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

    def script(self, cue, extra=()):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'narration.json'
            path.write_text(json.dumps({
                'version': 3, 'music': None, 'segments': [{
                    'id': 'chapter', 'text': 'Перенесём две фишки.', 'cues': [cue, *extra],
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

    def test_action_timing_preserves_aligned_words_and_validates_authored_windows(self):
        words = [{'text': text, 'start': i + 1, 'end': i + 1.5}
                 for i, text in enumerate(['Перенесём', 'две', 'фишки'])]
        for timing in [{'duration': 9, 'delay': .5}, {'until': 'finish'}]:
            segment = self.script({'id': 'move', 'quote': 'две фишки', 'timing': timing},
                                  [{'id': 'finish', 'quote': 'фишки'}])['segments'][0]
            cues = timed_cues(segment, words)
            cue = cues['move']
            self.assertEqual(cue, {'text': 'две фишки', 'start': 2, 'end': 3.5, 'timing': timing})
            self.assertEqual(segment['spoken'], 'Перенесём две фишки.')
            check_action_windows(cues, 12)
        for timing in [{'duration': 20}, {'until': 'chapter'}, {'until': 'finish', 'delay': 2}]:
            cues['move']['timing'] = timing
            with self.subTest(timing=timing), self.assertRaisesRegex(ValueError, 'positive action window'):
                check_action_windows(cues, 12)
        for timing in [None, {}, {'duration': 0}, {'duration': -1}, {'duration': True},
                       {'duration': 2, 'delay': -1}, {'duration': 2, 'until': 'chapter'},
                       {'until': 'missing'}, {'until': 'move'}, {'until': 5}, {'duration': 2, 'typo': 1}]:
            with self.subTest(timing=timing), self.assertRaisesRegex(ValueError, 'timing'):
                self.script({'id': 'move', 'quote': 'две фишки', 'timing': timing})

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

    def test_segment_seed_overrides_voice_without_changing_neighbors(self):
        spec = {"version": 3, "voice": {"seed": 17}, "segments": [
            {"id": "question", "text": "Сколько здесь предметов?"},
            {"id": "answer", "text": "Всего шесть.", "seed": 0},
            {"id": "conclusion", "text": "Теперь проверим вместе."},
        ]}
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "narration.json"
            script.write_text(json.dumps(spec, ensure_ascii=False))
            loaded = read_script(script)
            self.assertEqual(loaded["voice"]["seed"], 17)
            self.assertEqual([s["seed"] for s in loaded["segments"]], [17, 0, 17])
            self.assertEqual(json.loads(script.read_text()), spec)

    def test_voice_and_segment_seeds_reject_non_uint32_values(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "narration.json"
            for owner in ("voice", "segment"):
                for value in (True, 42.0, -1, 2**32, "42", None):
                    with self.subTest(owner=owner, seed=value):
                        spec = {"version": 3, "voice": {}, "segments": [
                            {"id": "question", "text": "Сколько здесь предметов?"},
                        ]}
                        target = spec["voice"] if owner == "voice" else spec["segments"][0]
                        target["seed"] = value
                        script.write_text(json.dumps(spec, ensure_ascii=False))
                        with self.assertRaisesRegex(ValueError, "seed must be an integer"):
                            read_script(script)


class AuditionSafety(unittest.TestCase):
    def test_invalid_requests_leave_authored_files_untouched_without_loading_models(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script = root / "narration.json"
            script.write_text(json.dumps({"version": 3, "segments": [
                {"id": "question", "text": "Сколько здесь предметов?"},
            ]}, ensure_ascii=False))
            authored = root / "authored"
            authored.mkdir()
            (authored / "index.html").write_text("Keep my authored page")
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            cases = [
                ("missing", root / "takes", [42], "Unknown segment"),
                ("question", root / "takes", [], "at least one"),
                ("question", root / "takes", [True], "audition seed"),
                ("question", root / "takes", [2**32], "audition seed"),
                ("question", root, [42], "separate audition"),
                ("question", authored, [42], "empty directory"),
            ]
            with patch.dict(sys.modules, {"alignment": None, "assembly": None, "speech": None}):
                for segment, output, seeds, message in cases:
                    with self.subTest(segment=segment, output=output.name, seeds=seeds):
                        with self.assertRaisesRegex(ValueError, message):
                            audition(script, segment, output, seeds)
            after = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            self.assertEqual(after, before)
            self.assertFalse((root / "takes").exists())

    def test_failed_reaudition_preserves_the_complete_previous_comparison(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script, output = root / "narration.json", root / "takes"
            spec = {"version": 3, "segments": [
                {"id": "question", "text": "Сколько здесь предметов?"},
            ]}
            script.write_text(json.dumps(spec, ensure_ascii=False))
            fail_seed = None

            def build_take(source, destination, device, **shared):
                segment = json.loads(source.read_text())["segments"][0]
                if segment["seed"] == fail_seed:
                    raise RuntimeError("Interrupted synthesis")
                (destination / "audio.wav").write_bytes(segment["text"].encode())
                return {"duration": 1.0, "warnings": []}

            modules = {
                "alignment": SimpleNamespace(Aligner=lambda device: object()),
                "speech": SimpleNamespace(Speaker=lambda voice: object()),
                "assembly": SimpleNamespace(build_audio=build_take),
            }
            with patch.dict(sys.modules, modules), redirect_stdout(io.StringIO()):
                audition(script, "question", output, [42, 43])
                before = {p.relative_to(output): p.read_bytes() for p in output.rglob("*") if p.is_file()}
                spec["segments"][0]["text"] = "А теперь попробуй угадать сам."
                script.write_text(json.dumps(spec, ensure_ascii=False))
                fail_seed = 43
                with self.assertRaisesRegex(RuntimeError, "Interrupted synthesis"):
                    audition(script, "question", output, [42, 43])
                after = {p.relative_to(output): p.read_bytes() for p in output.rglob("*") if p.is_file()}
                changed = [str(p) for p in sorted(before.keys() | after.keys()) if before.get(p) != after.get(p)]
                self.assertEqual(changed, [], "A failed audition changed these published files")
                self.assertEqual(json.loads(script.read_text()), spec)


if __name__ == '__main__':
    unittest.main()
