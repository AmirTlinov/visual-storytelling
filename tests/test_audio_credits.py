"""Rebuilding narration must retain authored asset and font attributions."""
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "audio"))
from credits import audio_credits, music_credit
from resources import MUSIC_CREDIT, SPEECH_CREDIT
from silent import silence_copy


class AudioCredits(unittest.TestCase):
    def test_legacy_migration_then_rebuild_and_music_removal(self):
        authored = "Product illustrations — Ortomatica\nFonts — OFL 1.1\n"
        music = {**MUSIC_CREDIT, "changes": "Excerpt, EQ, fades, automatic ducking and mix with narration."}
        legacy = authored + "\n" + SPEECH_CREDIT + "\n" + music_credit(music)
        built = audio_credits(legacy, music, music)
        self.assertTrue(built.startswith(authored))
        self.assertEqual(built.count(SPEECH_CREDIT), 1)
        self.assertEqual(built.count(music_credit(music)), 1)
        self.assertEqual(audio_credits(built, music, music), built)
        speech_only = audio_credits(built, None, music)
        self.assertTrue(speech_only.startswith(authored))
        self.assertEqual(speech_only.count(SPEECH_CREDIT), 1)
        self.assertNotIn("Kevin MacLeod", speech_only)

    def test_unknown_authored_music_is_preserved(self):
        authored = "Another music attribution — written by the author\n"
        built = audio_credits(authored, None)
        self.assertTrue(built.startswith(authored))
        self.assertEqual(audio_credits(built, None), built)

    def test_silent_copy_preserves_cue_timing_and_non_audio_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            music = {**MUSIC_CREDIT, "changes": "Excerpt and mix."}
            (directory / "CREDITS.txt").write_text("Product logo and fonts\n" + SPEECH_CREDIT + music_credit(music))
            for name in ("narration.json", "narration.txt", "voice-preview.html", "audio.wav", "voice.wav", "music.wav", "scene.js", "logo.svg"):
                (directory / name).write_text("source")
            story = {"version": 1, "duration": 4, "segments": [{"id": "start", "text": "Move", "start": 0, "end": 4}], "cues": {"move": {"start": 1, "end": 3}}}
            (directory / "timeline.json").write_text(json.dumps({**story, "audio": "audio.wav", "source_sha256": "old", "mix": {"music": music}}))
            silence_copy(directory)
            self.assertEqual(json.loads((directory / "timeline.json").read_text()), story)
            self.assertEqual((directory / "CREDITS.txt").read_text(), "Product logo and fonts\n")
            self.assertEqual(sorted(p.name for p in directory.iterdir()), ["CREDITS.txt", "logo.svg", "scene.js", "timeline.json"])
            silence_copy(directory)
            self.assertEqual((directory / "CREDITS.txt").read_text(), "Product logo and fonts\n")


if __name__ == "__main__":
    unittest.main()
