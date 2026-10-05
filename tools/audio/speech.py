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
from script import without_controls, words

SAMPLE_RATE = 48000
GENERATION = {"temperature": .8, "top_k": 50}
MAX_TOKENS = 4096


def token_budgets(first):
    budgets = [first]
    while budgets[-1] < MAX_TOKENS:
        budgets.append(min(MAX_TOKENS, budgets[-1] * 2))
    return budgets


class SpeechLimitError(RuntimeError):
    pass


def generation_parameters(text):
    # One native token is one codec frame. Leave room for normal pauses and long
    # Russian words, while preserving the accepted 1200-token short-take cache.
    spoken = without_controls(text)
    count = len(words(spoken))
    limit = 1200 if count <= 40 else min(MAX_TOKENS, max(1200, 128 + 24 * count, 128 + 3 * len(spoken)))
    return {**GENERATION, "max_new_tokens": limit}


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


def render(model, text, seed, ref_audio_codes, ref_text, parameters):
    import mlx.core as mx
    mx.random.seed(seed)
    results = list(model.generate(
        text=text, ref_audio_codes=ref_audio_codes, ref_text=ref_text, **parameters,
    ))
    if len(results) != 1:
        raise RuntimeError("Higgs must return one continuous narration segment")
    if results[0].token_count >= parameters["max_new_tokens"]:
        raise SpeechLimitError(f'Higgs reached its {parameters["max_new_tokens"]}-token budget before completing speech')
    audio = np.array(results[0].audio, dtype=np.float32).reshape(-1)
    if not len(audio) or not np.isfinite(audio).all() or np.max(np.abs(audio)) < .001:
        raise RuntimeError("Higgs returned invalid or silent audio")
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

    def _candidates(self, segment):
        parameters = generation_parameters(segment["delivery"] + segment["text"])
        minimum_budget = parameters["max_new_tokens"]
        candidates = []
        # Prefer current completed takes, then the whole original retry chain.
        # A changed generation budget must not invalidate accepted performances.
        budgets = dict.fromkeys(token_budgets(minimum_budget) + token_budgets(1200))
        for limit in budgets:
            parameters = {**parameters, "max_new_tokens": limit}
            key = digest({"v": 3, **self.identity, "parameters": parameters,
                          "reference_text": self.voice["reference_text"],
                          "seed": segment["seed"], "text": segment["text"],
                          "delivery": segment["delivery"], "sample_rate": SAMPLE_RATE})
            wav = CACHE / "clips" / f"{key}.wav"
            candidates.append((parameters, key, wav))
        return candidates

    def has_cached(self, segment):
        return any(wav.exists() for _, _, wav in self._candidates(segment))

    def synthesize(self, segment):
        candidates = self._candidates(segment)
        fresh_budgets = token_budgets(generation_parameters(segment["delivery"] + segment["text"])["max_new_tokens"])
        # Look for a previously completed larger-budget take before repeating a
        # known short budget. Failed/truncated generations are never cached.
        for parameters, key, wav in candidates:
            if wav.exists():
                return sf.read(wav, dtype="float32")[0], key, {"cached": True, "seconds": 0.0, "parameters": parameters}
        started = time.perf_counter()
        if self.model is None:
            model = load_model()
            reference_codes = model.encode_reference_audio(self.reference_path)
            self.model, self.reference_codes = model, reference_codes
        for parameters, key, wav in candidates:
            if parameters["max_new_tokens"] not in fresh_budgets:
                continue
            try:
                audio = render(self.model, segment["delivery"] + segment["text"], segment["seed"],
                               self.reference_codes, self.voice["reference_text"], parameters)
            except SpeechLimitError:
                if parameters["max_new_tokens"] == MAX_TOKENS:
                    raise
                continue
            audio = save_clip(wav, audio)
            return audio, key, {"cached": False, "seconds": round(time.perf_counter() - started, 4), "parameters": parameters}
