"""Focused checks for CTC repeats, cue ambiguity and montage offsets/cache reuse."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "audio"))
import numpy as np
import soundfile as sf

from alignment import ctc_path
from assembly import build_audio
from audition import audition
from resources import REFERENCE_AUDIO, REFERENCE_TEXT

EXAMPLE = Path(__file__).resolve().parents[2] / "examples" / "remainder-story" / "narration.json"


class AudioChecks(unittest.TestCase):
    def test_selected_whole_take_reuses_audio_and_preserves_other_segments(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            # Exercise relative voice-reference paths through the audition snapshot.
            (root / "reference.wav").write_bytes(REFERENCE_AUDIO.read_bytes())
            script = root / "narration.json"
            spec = {"version": 3, "intro": .1, "outro": .2, "music": None,
                    "voice": {"reference_audio": "reference.wav", "reference_text": REFERENCE_TEXT},
                    "segments": [
                        {"id": "question", "text": "Три пары — сколько это предметов? Попробуй посчитать.",
                         "cues": [{"id": "think", "quote": "Попробуй посчитать", "hold": "Сосчитать пары"}]},
                        {"id": "answer", "text": "Всего шесть предметов.",
                         "cues": [{"id": "total", "quote": "шесть", "action": "Появляется итог"}]}]}
            script.write_text(json.dumps(spec, ensure_ascii=False))
            original = script.read_bytes()
            audition(script, "question", root / "takes", [42, 43])
            self.assertEqual(script.read_bytes(), original)
            first = build_audio(script, root / "first", "auto")
            spec["segments"][0]["seed"] = 43
            script.write_text(json.dumps(spec, ensure_ascii=False))
            (root / "second").mkdir()
            authored_html = "<!doctype html><title>Authored scene</title>"
            (root / "second/index.html").write_text(authored_html)
            second = build_audio(script, root / "second", "auto")
            self.assertEqual((root / "second/index.html").read_text(), authored_html)
            self.assertIn('<audio controls', (root / "second/voice-preview.html").read_text())
            chosen = json.loads((root / "takes/seed-43/timeline.json").read_text())

            def clip(output, record):
                data, rate = sf.read(output / "voice.wav", dtype="int16")
                return data[round(record["audio_start"] * rate):round(record["audio_end"] * rate)]

            self.assertTrue(np.array_equal(clip(root / "takes/seed-43", chosen["segments"][0]),
                                           clip(root / "second", second["segments"][0])))
            self.assertTrue(np.array_equal(clip(root / "first", first["segments"][1]),
                                           clip(root / "second", second["segments"][1])))
            self.assertEqual([s["seed"] for s in second["segments"]], [43, 42])
            self.assertTrue(all(s["synthesis"]["cached"] for s in second["build"]["segments"]))
            self.assertEqual(set(second["cues"]), {"question", "think", "answer", "total"})
            self.assertAlmostEqual(second["cues"]["think"]["start"] - second["segments"][0]["audio_start"],
                                   chosen["cues"]["think"]["start"] - chosen["segments"][0]["audio_start"], places=4)

    def test_repeated_ctc_letters_need_a_blank(self):
        logp = np.log(np.array([[.02,.97,.01],[.96,.02,.02],[.02,.97,.01],[.98,.01,.01]]))
        self.assertEqual(ctc_path(logp, [1,1], 0).tolist(), [1,2,3,4])

    def test_long_ctc_path_keeps_state_index_above_uint8_range(self):
        tokens = [1, 2] * 80
        logp = np.full((len(tokens), 3), -12.0, dtype=np.float32)
        logp[np.arange(len(tokens)), tokens] = 0
        self.assertEqual(ctc_path(logp, tokens, 0).tolist(), list(range(1, 320, 2)))

    def test_montage_offsets_stems_and_cached_rebuild(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script, output = root/"script.json", root/"output"
            spec = json.loads(EXAMPLE.read_text())
            script.write_text(json.dumps(spec, ensure_ascii=False))
            first = build_audio(script, output, "auto")
            for name in ["audio.wav", "voice.wav", "music.wav"]:
                data, rate = sf.read(output/name)
                self.assertEqual(rate, 48000)
                self.assertEqual(len(data), round(first["duration"] * rate))
                self.assertTrue(np.isfinite(data).all())
            voice, rate = sf.read(output/"voice.wav")
            self.assertEqual(np.max(np.abs(voice[:round(spec["intro"]*rate)])), 0)
            spec["intro"] += .5
            spec["segments"][0]["pause_after"] += .4
            spec["music"] = None
            script.write_text(json.dumps(spec, ensure_ascii=False))
            second = build_audio(script, output, "auto")
            for i,(before,after) in enumerate(zip(first["segments"],second["segments"])):
                shift = .5 if i==0 else .9
                for a,b in zip(before["words"],after["words"]):
                    self.assertAlmostEqual(a["start"]+shift,b["start"],places=4)
                    self.assertAlmostEqual(a["end"]+shift,b["end"],places=4)
                receipt = second["build"]["segments"][i]
                self.assertTrue(receipt["synthesis"]["cached"] and receipt["alignment"]["cached"])
            self.assertFalse((output/"music.wav").exists())
            self.assertIn("Boson AI", (output/"CREDITS.txt").read_text())
            self.assertNotIn("Kevin MacLeod", (output/"CREDITS.txt").read_text())
            self.assertEqual((output/"audio.wav").read_bytes(),(output/"voice.wav").read_bytes())
            self.assertTrue((output/"timeline.json").is_file())


if __name__ == "__main__":
    unittest.main()
