"""Focused checks for CTC repeats, cue ambiguity and montage offsets/cache reuse."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent / "audio"))
import numpy as np
import soundfile as sf

from alignment import ctc_path
from assembly import build_audio
from script import read_script

EXAMPLE = Path(__file__).parent.parent / "examples" / "remainder-story" / "narration.json"


class AudioChecks(unittest.TestCase):
    def test_repeated_ctc_letters_need_a_blank(self):
        logp = np.log(np.array([[.02,.97,.01],[.96,.02,.02],[.02,.97,.01],[.98,.01,.01]]))
        self.assertEqual(ctc_path(logp, [1,1], 0).tolist(), [1,2,3,4])

    def test_long_ctc_path_keeps_state_index_above_uint8_range(self):
        tokens = [1, 2] * 80
        logp = np.full((len(tokens), 3), -12.0, dtype=np.float32)
        logp[np.arange(len(tokens)), tokens] = 0
        self.assertEqual(ctc_path(logp, tokens, 0).tolist(), list(range(1, 320, 2)))

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
            self.assertFalse((output/"timeline.js").exists())


if __name__ == "__main__":
    unittest.main()
