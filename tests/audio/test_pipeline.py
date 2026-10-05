"""Focused checks for CTC repeats, cue ambiguity and montage offsets/cache reuse."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "audio"))
import numpy as np
import soundfile as sf

from alignment import ctc_path
from assembly import build_audio
from audition import audition
from resources import REFERENCE_AUDIO, REFERENCE_TEXT, digest, file_digest
from script import read_script, words, check_timeline
from speech import Speaker, GENERATION, SAMPLE_RATE, SpeechLimitError, generation_parameters

EXAMPLE = Path(__file__).resolve().parents[2] / "examples" / "remainder-story" / "narration.json"


class AudioChecks(unittest.TestCase):
    def test_cached_whole_paragraph_precedes_new_sentence_splitting(self):
        paragraph = " ".join(start + " слово" * 28 + " " + end for start, end in [
            ("Первое", "завершено."), ("Второе", "готово."), ("Третье", "проверено."),
        ])
        for text, old_budget, quote in [
            (paragraph, 1200, "завершено Второе"),
            (paragraph, 2400, "завершено Второе"),
            ("Начало" + " слово" * 49 + " завершено.", 1200, "завершено"),
        ]:
            with self.subTest(budget=old_budget, words=len(words(text))), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                script, output = root / "narration.json", root / "output"
                script.write_text(json.dumps({"version": 3, "intro": 0, "outro": 0,
                    "music": None, "segments": [{"id": "whole", "text": text, "pause_after": 0,
                    "cues": [{"id": "boundary", "quote": quote, "action": "Продолжаем мысль"}]}]}, ensure_ascii=False))
                spec = read_script(script)
                segment = spec["segments"][0]
                speaker = Speaker.__new__(Speaker)
                speaker.identity = {"model": "fixture", "parameters": GENERATION,
                                    "reference_sha256": file_digest(Path(spec["voice"]["reference_audio"]))}
                speaker.voice, speaker.model = spec["voice"], None
                key = digest({"v": 3, **speaker.identity,
                    "parameters": {**GENERATION, "max_new_tokens": old_budget},
                    "reference_text": speaker.voice["reference_text"],
                    **{name: segment[name] for name in ("seed", "text", "delivery")}, "sample_rate": SAMPLE_RATE})
                path = root / "clips" / f"{key}.wav"
                path.parent.mkdir()
                sf.write(path, .1 * np.sin(np.linspace(0, 128 * np.pi, 2 * SAMPLE_RATE)), SAMPLE_RATE, subtype="PCM_16")
                expected, _ = sf.read(path, dtype="int16")
                aligned_texts = []
                class CachedAligner:
                    device = "cpu"
                    def align(self, audio, spoken, actual_key):
                        aligned_texts.append((spoken, actual_key))
                        tokens = words(spoken)
                        return [{"text": word, "start": .05 + 1.9 * i / len(tokens),
                                 "end": .05 + 1.9 * (i + 1) / len(tokens), "score": .9}
                                for i, word in enumerate(tokens)], {"cached": True, "seconds": 0}
                with patch('speech.CACHE', root), patch('speech.load_model', side_effect=AssertionError("A cached paragraph must not load TTS")):
                    timeline = build_audio(script, output, "cpu", speaker=speaker, aligner=CachedAligner(), report=False)
                self.assertEqual(aligned_texts, [(segment["spoken"], key)])
                self.assertNotIn("passages", timeline["segments"][0])
                self.assertEqual(timeline["duration"], 2)
                self.assertTrue(timeline["build"]["segments"][0]["synthesis"]["cached"])
                self.assertTrue(np.array_equal(sf.read(output / "voice.wav", dtype="int16")[0], expected))
                self.assertEqual([w["text"] for w in timeline["segments"][0]["words"]], words(text))
                check_timeline(script, output / "timeline.json")

    def test_larger_budget_reuses_a_complete_long_take_from_the_original_budget(self):
        speaker = Speaker.__new__(Speaker)
        speaker.identity = {"model": "fixture", "parameters": GENERATION}
        speaker.voice = {"reference_text": "Точный образец."}
        speaker.reference_codes = None
        calls = []
        def generate(**options):
            calls.append(options["max_new_tokens"])
            yield SimpleNamespace(audio=np.full(2400, .1), token_count=10)
        speaker.model = SimpleNamespace(generate=generate, sample_rate=24000)
        segment = {"seed": 42, "text": "слово " * 60, "delivery": ""}
        budget = generation_parameters(segment["text"])["max_new_tokens"]
        self.assertGreater(budget, 1200)
        with tempfile.TemporaryDirectory() as folder, patch('speech.CACHE', Path(folder)):
            key = digest({"v": 3, **speaker.identity, "parameters": {**GENERATION, "max_new_tokens": 1200},
                          "reference_text": speaker.voice["reference_text"], **segment, "sample_rate": SAMPLE_RATE})
            path = Path(folder) / "clips" / f"{key}.wav"
            path.parent.mkdir()
            sf.write(path, np.full(4800, .1), SAMPLE_RATE, subtype="PCM_16")
            self.assertTrue(speaker.has_cached(segment))
            audio, actual, record = speaker.synthesize(segment)
            self.assertEqual(actual, key)
            self.assertTrue(record["cached"])
            self.assertEqual(calls, [])
            segment["seed"] = 43
            speaker.synthesize(segment)
            self.assertEqual(calls, [budget])

    def test_complete_sentences_share_cues_and_keep_a_cached_receipt_byte_stable(self):
        class FakeSpeaker:
            identity = {"model": "fixture", "reference_sha256": file_digest(REFERENCE_AUDIO)}
            cached = False
            def synthesize(self, segment):
                return np.full(SAMPLE_RATE, .1, dtype=np.float32), segment["text"], {"cached": self.cached, "seconds": 0 if self.cached else 1}
        class FakeAligner:
            device = "cpu"
            def align(self, audio, text, key):
                tokens = words(text)
                return [{"text": word, "start": .05 + .85 * i / len(tokens),
                         "end": .05 + .85 * (i + 1) / len(tokens), "score": .9}
                        for i, word in enumerate(tokens)], {"cached": speaker.cached, "seconds": 0}
        text = " ".join(start + " слово" * 28 + " " + end for start, end in [
            ("Первое", "завершено."), ("Второе", "готово."), ("Третье", "проверено."),
        ])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script, output = root / "narration.json", root / "output"
            spec = {"version": 3, "intro": 0, "outro": 0, "segments": [
                {"id": "thought", "text": text, "pause_after": .3,
                 "cues": [{"id": "boundary", "quote": "завершено Второе", "action": "Следующее предложение"}]},
            ]}
            script.write_text(json.dumps(spec, ensure_ascii=False))
            speaker = FakeSpeaker()
            speaker.voice = read_script(script)["voice"]
            first = build_audio(script, output, "cpu", speaker=speaker, aligner=FakeAligner(), report=False)
            aligned = first["segments"][0]["words"]
            self.assertEqual([w["text"] for w in aligned], words(text))
            self.assertEqual([p["word_end"] for p in first["segments"][0]["passages"]], [30, 60, 90])
            self.assertAlmostEqual(aligned[30]["start"] - aligned[29]["end"], .2, places=5)
            self.assertAlmostEqual(aligned[60]["start"] - aligned[59]["end"], .2, places=5)
            self.assertAlmostEqual(first["duration"], 3.4, places=5)  # 3 clips, two .05 gaps, one .3 pause.
            self.assertEqual(first["cues"]["boundary"]["start"], aligned[29]["start"])
            self.assertEqual(first["cues"]["boundary"]["end"], aligned[30]["end"])
            check_timeline(script, output / "timeline.json")
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            speaker.cached = True
            build_audio(script, output, "cpu", speaker=speaker, aligner=FakeAligner(), report=False)
            self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)
            spec["segments"][0]["text"] = "слово " * 51
            spec["segments"][0]["cues"] = []
            script.write_text(json.dumps(spec, ensure_ascii=False))
            with self.assertRaisesRegex(ValueError, 'natural sentence boundary'):
                build_audio(script, output, "cpu", speaker=speaker, aligner=FakeAligner(), report=False)
            self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)

    def test_token_budget_keeps_short_keys_and_reuses_a_completed_larger_take(self):
        speaker = Speaker.__new__(Speaker)
        speaker.identity = {"model": "fixture", "parameters": GENERATION}
        speaker.voice = {"reference_text": "Точный образец."}
        speaker.reference_codes = None
        calls = []
        capped = False
        def generate(**options):
            limit = options["max_new_tokens"]
            calls.append(limit)
            yield SimpleNamespace(audio=np.full(2400, .1), token_count=limit if capped or limit == 1200 else 10)
        speaker.model = SimpleNamespace(generate=generate, sample_rate=24000)
        segment = {"seed": 42, "text": "Цепь замкнута.", "delivery": ""}
        legacy = {**GENERATION, "max_new_tokens": 1200}
        self.assertEqual(generation_parameters(segment["text"]), legacy)
        self.assertGreater(generation_parameters("слово " * 100)["max_new_tokens"], 1200)
        with tempfile.TemporaryDirectory() as folder, patch('speech.CACHE', Path(folder)):
            key = digest({"v": 3, **speaker.identity, "parameters": legacy,
                          "reference_text": speaker.voice["reference_text"], **segment, "sample_rate": SAMPLE_RATE})
            path = Path(folder) / "clips" / f"{key}.wav"
            path.parent.mkdir()
            sf.write(path, np.full(4800, .1), SAMPLE_RATE, subtype="PCM_16")
            self.assertEqual(speaker.synthesize(segment)[1], key)
            self.assertEqual(calls, [])
            segment["seed"] = 43
            first = speaker.synthesize(segment)
            self.assertEqual(calls, [1200, 2400])
            second = speaker.synthesize(segment)
            self.assertEqual(calls, [1200, 2400])
            self.assertEqual(first[1], second[1])
            self.assertTrue(second[2]["cached"])
            self.assertTrue(np.array_equal(first[0], second[0]))
            self.assertEqual(len(list(path.parent.glob('*.wav'))), 2)
            capped = True
            segment["seed"] = 44
            with self.assertRaisesRegex(SpeechLimitError, '4096-token budget'):
                speaker.synthesize(segment)
            self.assertEqual(calls[-3:], [1200, 2400, 4096])
            self.assertEqual(len(list(path.parent.glob('*.wav'))), 2)

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
