"""Higgs TTS 3 on MLX with the accepted narrator and native delivery controls."""
from importlib.metadata import version
import math
import os
import time

import numpy as np
from scipy.signal import resample_poly
import soundfile as sf

from resources import (CACHE, SPEECH_MODEL,
                       SPEECH_REPO, SPEECH_REVISION, digest, file_digest, speech_ready)

SAMPLE_RATE = 48000
GENERATION = {"temperature": .8, "top_k": 50, "max_new_tokens": 1200}


def load_model():
    if not speech_ready():
        raise FileNotFoundError("Run sketch-audio setup first")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from mlx_audio.tts.utils import load_model as load
    return load(str(SPEECH_MODEL), model_type="higgs_audio_v3")


def resample(audio, source_rate, target_rate):
    common = math.gcd(source_rate, target_rate)
    return resample_poly(audio, target_rate // common, source_rate // common).astype(np.float32)


def render(model, text, seed, ref_audio_codes, ref_text):
    import mlx.core as mx
    mx.random.seed(seed)
    chunks = [np.array(result.audio, dtype=np.float32).reshape(-1) for result in model.generate(
        text=text, ref_audio_codes=ref_audio_codes, ref_text=ref_text, **GENERATION,
    )]
    if len(chunks) != 1:
        raise RuntimeError("Higgs must return one continuous narration segment")
    audio = np.concatenate(chunks)
    if not len(audio) or not np.isfinite(audio).all() or np.max(np.abs(audio)) < .001:
        raise RuntimeError("Higgs returned invalid or silent audio")
    if len(audio) / model.sample_rate > 40:
        raise ValueError("Speech exceeds 40 seconds; split at a sentence boundary")
    return resample(audio, model.sample_rate, SAMPLE_RATE)


def save_clip(path, audio):
    audio *= min(1.0, .95 / float(np.max(np.abs(audio))))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp.wav")
    sf.write(temporary, audio, SAMPLE_RATE, subtype="PCM_16")
    temporary.replace(path)
    # Align the exact PCM waveform reused by later cache hits.
    return sf.read(path, dtype="float32")[0]


class Speaker:
    def __init__(self, voice):
        if not speech_ready():
            raise FileNotFoundError("Run sketch-audio setup first")
        self.voice = voice
        self.model = None
        self.reference_codes = None
        self.reference_path = voice["reference_audio"]
        if not os.path.isfile(self.reference_path):
            raise FileNotFoundError("Voice reference is missing; run sketch-audio setup")
        self.identity = {"model": SPEECH_REPO, "revision": SPEECH_REVISION,
                         "runtime": "mlx-audio", "runtime_version": version("mlx-audio"),
                         "reference_sha256": file_digest(self.reference_path),
                         "parameters": GENERATION}

    def synthesize(self, segment):
        key = digest({"v": 3, **self.identity, "reference_text": self.voice["reference_text"],
                      "seed": segment["seed"], "text": segment["text"],
                      "delivery": segment["delivery"], "sample_rate": SAMPLE_RATE})
        wav = CACHE / "clips" / f"{key}.wav"
        if wav.exists():
            return sf.read(wav, dtype="float32")[0], key, {"cached": True, "seconds": 0.0}
        started = time.perf_counter()
        if self.model is None:
            model = load_model()
            reference_codes = model.encode_reference_audio(self.reference_path)
            self.model, self.reference_codes = model, reference_codes
        audio = render(self.model, segment["delivery"] + segment["text"], segment["seed"],
                       self.reference_codes, self.voice["reference_text"])
        audio = save_clip(wav, audio)
        return audio, key, {"cached": False, "seconds": round(time.perf_counter() - started, 4)}
