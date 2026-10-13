"""Mastering regression proofs use measured tones and injected takes, never a TTS model."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/audio"))
from assembly import build_audio
from mastering import PROFILE, PROFILE_SHA256, measure, master
from mixing import mix
from remaster import reuse_audio
from resources import file_digest
from script import read_script, words, check_timeline
from speech import SAMPLE_RATE


def tone(amplitude=.008, seconds=3):
    t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    audio = amplitude * np.sin(2 * np.pi * 330 * t)
    padding = min(4800, len(audio) // 10)
    audio[:padding] = 0
    audio[-padding:] = 0
    return audio.astype(np.float32)


class FixtureAligner:
    device = "fixture"
    def align(self, audio, text, key):
        return ([{"text": word, "start": .1 + i * .25, "end": .3 + i * .25, "score": .9}
                 for i, word in enumerate(words(text))], {"cached": True, "seconds": 0})


class FixtureSpeaker:
    def __init__(self, voice, audio):
        self.voice, self.audio = voice, audio
        self.identity = {"model": "fixture", "reference_sha256": file_digest(voice["reference_audio"])}
    def synthesize(self, segment):
        return self.audio.copy(), "fixture", {"cached": True, "seconds": 0}


class MasteringChecks(unittest.TestCase):
    def music(self, root):
        source = root / "source.wav"
        sf.write(source, .1 * np.sin(np.arange(4 * SAMPLE_RATE) * .03), SAMPLE_RATE)
        return {"path": str(source), "offset": 0, "level_db": -18,
                "credit": {"title": "Fixture", "artist": "Fixture", "source": "synthetic", "license": "0BSD"}}

    def build(self, root, audio, music=None, text="Один шаг вперёд."):
        source = root / "narration.json"
        spec = {"version": 3, "intro": .1, "outro": .1, "music": music,
                "segments": [{"id": "step", "text": text, "seed": 42}]}
        source.write_text(json.dumps(spec, ensure_ascii=False))
        normalized = read_script(source)
        return build_audio(source, root / "out", "cpu", report=False,
                           speaker=FixtureSpeaker(normalized["voice"], audio), aligner=FixtureAligner())

    def test_quiet_voice_and_music_have_stable_loudness_balance_and_additive_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            music = self.music(root)
            balances = []
            for amplitude in [.008, .08, .8]:
                output = root / str(amplitude)
                output.mkdir()
                result = mix(tone(amplitude), music, output)
                json.dumps(result, allow_nan=False)
                audio, rate = sf.read(output / "audio.wav")
                voice, _ = sf.read(output / "voice.wav")
                bed, _ = sf.read(output / "music.wav")
                self.assertEqual(len(audio), len(tone()))
                self.assertEqual(rate, SAMPLE_RATE)
                self.assertTrue(np.any(audio))
                self.assertLess(np.max(np.abs(audio - voice[:, None] - bed)), 2 / 32768)
                measured = result["mastering"]
                self.assertLess(abs(measured["integrated_lufs"] + 16), .15)
                self.assertLessEqual(measured["true_peak_dbtp"], -1.5)
                part = slice(SAMPLE_RATE, 2 * SAMPLE_RATE)
                balances.append(20 * np.log10(np.sqrt(np.mean(bed[part] ** 2)) / np.sqrt(np.mean(voice[part] ** 2))))
            self.assertLess(max(balances) - min(balances), .05)

    def test_gain_only_short_and_peak_limited_audio_keep_their_sample_positions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for index, source in enumerate([tone(.008, .2), tone(.008)]):
                if index:
                    source[12345] = .9
                output = root / str(index)
                output.mkdir()
                result = mix(source, None, output)
                audio, _ = sf.read(output / "audio.wav")
                self.assertEqual(len(source), len(audio))
                gain = 10 ** (result["mastering"]["gain_db"] / 20)
                self.assertLess(np.max(np.abs(audio - source * gain)), 2 / 32768)
                self.assertTrue(np.all(audio[source == 0] == 0))
                if index:
                    self.assertTrue(result["mastering"]["peak_limited"])
                else:
                    self.assertEqual(result["mastering"]["method"], "short-rms")

    def test_invalid_data_never_replaces_an_accepted_recording(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.build(root, tone())
            original = {p.name: p.read_bytes() for p in (root / "out").iterdir()}
            for index, invalid in enumerate([np.zeros(1000), np.full(1000, np.nan), np.full(1000, np.inf), np.array([])]):
                with self.assertRaisesRegex(ValueError, "finite, non-empty and non-silent"):
                    self.build(root, invalid, text="Другой шаг вперёд." + " Ещё." * index)
                self.assertEqual(original, {p.name: p.read_bytes() for p in (root / "out").iterdir()})

    def test_opposite_polarity_stems_cannot_clip_when_the_combined_signal_is_quiet(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            voice = tone(.8)
            bed = np.repeat((-voice * .99)[:, None], 2, axis=1)
            receipt = master({"voice": voice, "music": bed}, output, SAMPLE_RATE)
            self.assertTrue(receipt["peak_limited"])
            for name, channels in [("audio", 2), ("voice", 1), ("music", 2)]:
                measured = measure(output / f"{name}.wav", channels)
                self.assertLessEqual(measured["true_peak_dbtp"], -1.5)
            audio, _ = sf.read(output / "audio.wav")
            voice, _ = sf.read(output / "voice.wav")
            music, _ = sf.read(output / "music.wav")
            self.assertLess(np.max(np.abs(audio - voice[:, None] - music)), 2 / 32768)

    def test_accepted_performance_remasters_without_models_then_becomes_a_byte_stable_noop(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first = self.build(root, tone(), self.music(root))
            receipt = root / "out/timeline.json"
            first["mix"].pop("mastering")
            receipt.write_text(json.dumps(first, ensure_ascii=False))
            with patch("assembly.Speaker", side_effect=AssertionError("No TTS")), patch("assembly.Aligner", side_effect=AssertionError("No alignment")):
                second = build_audio(root / "narration.json", root / "out", "cpu", report=False)
            self.assertEqual(first["segments"], second["segments"])
            self.assertEqual(first["cues"], second["cues"])
            self.assertEqual(second["mix"]["mastering"]["profile_sha256"], PROFILE_SHA256)
            check_timeline(root / "narration.json", receipt)
            original = {p.name: p.read_bytes() for p in (root / "out").iterdir()}
            with patch("mastering.measure", side_effect=AssertionError("No FFmpeg")):
                self.assertEqual(reuse_audio(root / "narration.json", root / "out"), second)
            self.assertEqual(original, {p.name: p.read_bytes() for p in (root / "out").iterdir()})
            # Matching duration cannot hide edited accepted audio.
            data, rate = sf.read(root / "out/audio.wav")
            sf.write(root / "out/audio.wav", data * .5, rate)
            with self.assertRaisesRegex(ValueError, "differs from its accepted receipt"):
                reuse_audio(root / "narration.json", root / "out")


if __name__ == "__main__":
    unittest.main()
