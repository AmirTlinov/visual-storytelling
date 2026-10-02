"""Russian CTC forced alignment of known text; never estimates time by length."""
import json
import os
import time

import numpy as np
from scipy.signal import resample_poly
import torch

from resources import ALIGN_MODEL, ALIGN_REVISION, CACHE, digest
from script import words


def ctc_path(logp, tokens, blank):
    """Viterbi over the CTC graph, including required blanks for repeated letters."""
    states = np.full(2 * len(tokens) + 1, blank, dtype=np.int32)
    states[1::2] = tokens
    count = len(states)
    previous = np.full(count, -np.inf, dtype=np.float32)
    previous[0] = logp[0, blank]
    previous[1] = logp[0, tokens[0]]
    back = np.zeros((len(logp), count), dtype=np.uint8)
    skip = np.zeros(count, dtype=bool)
    skip[2:] = (states[2:] != blank) & (states[2:] != states[:-2])
    for t in range(1, len(logp)):
        stay = previous
        step = np.r_[-np.inf, previous[:-1]]
        leap = np.r_[-np.inf, -np.inf, previous[:-2]]
        leap[~skip] = -np.inf
        candidates = np.stack((stay, step, leap))
        choice = candidates.argmax(axis=0)
        back[t] = choice
        previous = candidates[choice, np.arange(count)] + logp[t, states]
    state = count - 1 if previous[-1] > previous[-2] else count - 2
    if not np.isfinite(previous[state]):
        raise RuntimeError("Speech is too short to align the supplied text")
    path = np.empty(len(logp), dtype=np.int32)
    for t in range(len(logp) - 1, -1, -1):
        path[t] = state
        if t:
            state -= int(back[t, state])
    return path


class Aligner:
    def __init__(self, device):
        if not (ALIGN_MODEL / "pytorch_model.bin").exists():
            raise FileNotFoundError("Run sketch-audio setup first")
        self.device = ("mps" if torch.backends.mps.is_available() else "cpu") if device == "auto" else device
        self.processor = self.model = None

    def align(self, audio, text, audio_key):
        key = digest({"v": 1, "audio": audio_key, "text": text, "model": ALIGN_REVISION})
        destination = CACHE / "alignment" / f"{key}.json"
        if destination.exists():
            return json.loads(destination.read_text()), {"cached": True, "seconds": 0.0}
        if self.model is None:
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
            self.processor = Wav2Vec2Processor.from_pretrained(ALIGN_MODEL, local_files_only=True)
            self.model = Wav2Vec2ForCTC.from_pretrained(ALIGN_MODEL, local_files_only=True).to(self.device).eval()
        started = time.perf_counter()
        spoken_words = words(text)
        vocab = self.processor.tokenizer.get_vocab()
        tokens, owners = [], []
        for i, word in enumerate(spoken_words):
            if i:
                tokens.append(vocab["|"])
                owners.append(-1)
            for char in word.lower().replace("ё", "е").replace("‑", "-"):
                if char not in vocab:
                    raise ValueError(f"Unsupported spoken character {char!r}")
                tokens.append(vocab[char])
                owners.append(i)
        samples = resample_poly(audio, 1, 3).astype(np.float32)
        inputs = self.processor(samples, sampling_rate=16000, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            logits = self.model(**inputs).logits[0]
            logp = torch.log_softmax(logits.float(), dim=-1).cpu().numpy()
        path = ctc_path(logp, tokens, self.processor.tokenizer.pad_token_id)
        frame_seconds = len(audio) / 48000 / len(logp)
        result = []
        for index, word in enumerate(spoken_words):
            token_indices = [j for j, owner in enumerate(owners) if owner == index]
            frames = np.flatnonzero(np.isin(path, [2 * j + 1 for j in token_indices]))
            if not len(frames):
                raise RuntimeError(f"No acoustic alignment for {word!r}")
            probs = [np.exp(logp[t, tokens[(path[t] - 1) // 2]]) for t in frames]
            result.append({"text": word, "start": round(float(frames[0] * frame_seconds), 5),
                           "end": round(float((frames[-1] + 1) * frame_seconds), 5),
                           "score": round(float(np.mean(probs)), 3)})
        quality = float(np.mean([w["score"] for w in result]))
        if quality < .2:
            raise RuntimeError(f"Alignment confidence is too low ({quality:.2f}); check the spoken text")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(result, ensure_ascii=False) + "\n")
        return result, {"cached": False, "seconds": round(time.perf_counter() - started, 4)}
