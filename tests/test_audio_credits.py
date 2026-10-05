"""Rebuilding narration must retain authored asset and font attributions."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "audio"))
from credits import audio_credits, music_credit
from resources import MUSIC_CREDIT, SPEECH_CREDIT


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


if __name__ == "__main__":
    unittest.main()
