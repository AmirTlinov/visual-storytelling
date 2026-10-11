#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["torch==2.14.0"]
# ///
"""Reproduce the tiny, inspectable decoder used by the GPT explanation.

Uses CPU float64, a fixed seed, one thread and the complete disclosed corpus.
No external text, checkpoint or pretrained weights are used. The browser only
needs the resulting JSON; PyTorch is an authoring dependency, not a runtime one.

Run in an isolated, pinned authoring environment:
  uv run tools/train-teaching-gpt.py
"""

import argparse
import hashlib
import json
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F


ROOT = Path(__file__).resolve().parents[1]
SEED = 1729
CONFIG = {"modelWidth": 8, "heads": 2, "layers": 2, "hiddenWidth": 32, "context": 8, "epsilon": 1e-5}
VOCAB = ["<начало>", "<конец>", "кот", "пёс", "птица", "сидит", "на", "ковре", "полу", "ветке", "говорит", "мяу", "гав", "чирик", "сейчас", "там", "."]
SUBJECTS = [("кот", "ковре", "мяу"), ("пёс", "полу", "гав"), ("птица", "ветке", "чирик")]
CORPUS = [
    " ".join([*prefix, animal, *ending, "."])
    for prefix in [[], ["сейчас"], ["там"]]
    for animal, place, sound in SUBJECTS
    for ending in [["сидит", "на", place], ["говорит", sound]]
]


class Block(nn.Module):
    def __init__(self):
        super().__init__()
        d, h = CONFIG["modelWidth"], CONFIG["hiddenWidth"]
        self.ln1 = nn.LayerNorm(d, eps=CONFIG["epsilon"])
        self.qkv = nn.Linear(d, 3 * d)
        self.projection = nn.Linear(d, d)
        self.ln2 = nn.LayerNorm(d, eps=CONFIG["epsilon"])
        self.expand = nn.Linear(d, h)
        self.contract = nn.Linear(h, d)

    def forward(self, x):
        b, t, d = x.shape
        head_width = d // CONFIG["heads"]
        q, k, v = self.qkv(self.ln1(x)).chunk(3, dim=-1)
        q, k, v = [value.view(b, t, CONFIG["heads"], head_width).transpose(1, 2) for value in (q, k, v)]
        scores = (q @ k.transpose(-1, -2)) / head_width**0.5
        scores = scores.masked_fill(torch.ones(t, t, dtype=torch.bool).triu(1), -torch.inf)
        attention = scores.softmax(dim=-1)
        x = x + self.projection((attention @ v).transpose(1, 2).contiguous().view(b, t, d))
        return x + self.contract(F.gelu(self.expand(self.ln2(x)), approximate="tanh"))


class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        d = CONFIG["modelWidth"]
        self.tokens = nn.Embedding(len(VOCAB), d)
        self.positions = nn.Embedding(CONFIG["context"], d)
        self.blocks = nn.ModuleList(Block() for _ in range(CONFIG["layers"]))
        self.final_norm = nn.LayerNorm(d, eps=CONFIG["epsilon"])
        self.apply(self.initialize)

    @staticmethod
    def initialize(module):
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, std=0.08)
        if isinstance(module, nn.Linear):
            nn.init.zeros_(module.bias)

    def forward(self, ids):
        x = self.tokens(ids) + self.positions(torch.arange(ids.shape[1]))
        for block in self.blocks:
            x = block(x)
        # GPT-2-style tied embedding/unembedding, with no separate output bias.
        return self.final_norm(x) @ self.tokens.weight.T


def as_json(value):
    return value.detach().cpu().tolist()


def linear(module):
    return {"weight": as_json(module.weight.T), "bias": as_json(module.bias)}


def normalization(module):
    return {"scale": as_json(module.weight), "bias": as_json(module.bias)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=2400)
    parser.add_argument("--out", type=Path, default=ROOT / "examples/gpt-model/checkpoint.json")
    args = parser.parse_args()
    if args.steps < 1:
        parser.error("steps must be positive")
    torch.set_default_dtype(torch.float64)
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(SEED)
    lookup = {token: i for i, token in enumerate(VOCAB)}
    sequences = [[0, *[lookup[word] for word in text.split()], 1] for text in CORPUS]
    inputs = torch.zeros(len(sequences), CONFIG["context"], dtype=torch.long)
    targets = torch.full_like(inputs, -100)
    for row, sequence in enumerate(sequences):
        n = len(sequence) - 1
        if n > CONFIG["context"]:
            raise ValueError("Training sentence exceeds the declared context")
        inputs[row, :n] = torch.tensor(sequence[:-1])
        targets[row, :n] = torch.tensor(sequence[1:])
    model = Decoder()
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.012, weight_decay=0.01)
    initial_loss = F.cross_entropy(model(inputs).flatten(0, 1), targets.flatten(), ignore_index=-100).item()
    for step in range(args.steps):
        optimizer.zero_grad(set_to_none=True)
        logits = model(inputs)
        loss = F.cross_entropy(logits.flatten(0, 1), targets.flatten(), ignore_index=-100)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        if (step + 1) % 600 == 0:
            print(f"step={step + 1} loss={loss.item():.8f}", flush=True)
    model.eval()
    references = []
    for animal, place, sound in SUBJECTS:
        for prefix, expected in [([animal, "сидит", "на"], place), ([animal, "говорит"], sound), (["сейчас", animal, "сидит", "на"], place)]:
            ids = [0, *[lookup[token] for token in prefix]]
            with torch.no_grad():
                logits = model(torch.tensor([ids]))[0]
            references.append({"tokens": prefix, "expected": expected, "logits": as_json(logits), "probabilities": as_json(logits.softmax(-1))})
    weights = {
        "tokenEmbedding": as_json(model.tokens.weight),
        "positionEmbedding": as_json(model.positions.weight),
        "blocks": [
            {"ln1": normalization(block.ln1), "qkv": linear(block.qkv), "projection": linear(block.projection), "ln2": normalization(block.ln2), "expand": linear(block.expand), "contract": linear(block.contract)}
            for block in model.blocks
        ],
        "finalNorm": normalization(model.final_norm),
    }
    canonical_corpus = "\n".join(CORPUS).encode()
    output = {
        "format": "visual-storytelling.teaching-gpt.v1",
        "config": CONFIG,
        "vocab": VOCAB,
        "weights": weights,
        "training": {
            "description": "A tiny GPT-2-style causal decoder trained from scratch on this disclosed artificial Russian corpus. These are not weights from a commercial GPT model.",
            "tokenizer": "word-level; punctuation is its own token; explicit beginning/end tokens",
            "seed": SEED,
            "steps": args.steps,
            "dtype": "float64",
            "device": "cpu",
            "torch": torch.__version__,
            "optimizer": {"name": "AdamW", "learningRate": 0.012, "weightDecay": 0.01, "gradientClip": 1.0},
            "parameterCount": sum(parameter.numel() for parameter in model.parameters()),
            "initialLoss": initial_loss,
            "finalLoss": F.cross_entropy(model(inputs).flatten(0, 1), targets.flatten(), ignore_index=-100).item(),
            "corpusSha256": hashlib.sha256(canonical_corpus).hexdigest(),
            "corpus": CORPUS,
        },
        "references": references,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    for reference in references:
        last = reference["probabilities"][-1]
        index = max(range(len(last)), key=last.__getitem__)
        print(" ".join(reference["tokens"]), "→", VOCAB[index], f"{last[index]:.6f}", flush=True)
    print(f"saved={args.out} parameters={output['training']['parameterCount']}")


if __name__ == "__main__":
    main()
