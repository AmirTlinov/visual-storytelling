"""Local, pinned BERT-mini inference; the visualization never invents weights."""
import json
import hashlib
import math
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch
from huggingface_hub import hf_hub_download
from transformers import BertModel, BertTokenizer

ROOT = Path(__file__).resolve().parent
MODEL = "prajjwal1/bert-mini"
REVISION = "5e123abc2480f0c4b4cac186d3b3f09299c258fc"
DEFAULT_TEXT = "our home"
MAX_TOKENS = 12


class Projection:
    def __init__(self):
        torch.set_num_threads(2)
        vocab_file = hf_hub_download(MODEL, "vocab.txt", revision=REVISION, local_files_only=True)
        self.tokenizer = BertTokenizer(
            vocab={token: index for index, token in enumerate(Path(vocab_file).read_text().splitlines())},
            do_lower_case=True,
        )
        self.model = BertModel.from_pretrained(
            MODEL, revision=REVISION, local_files_only=True,
            use_safetensors=False, weights_only=True, attn_implementation="eager"
        ).eval()
        self.lock = threading.Lock()
        self.query = self.model.encoder.layer[-1].attention.self.query
        weight = self.query.weight.detach()
        # PyTorch stores [head * output, input]. The picture uses
        # W[h, input, output], so x @ W_h + b_h is the actual projection.
        by_head = weight.reshape(4, 64, 256).transpose(1, 2)
        self.parameters = {
            "values": by_head[:, :4, :4].tolist(),
            "shape": [256, 64, 4],
            "visible_shape": [4, 4, 4],
            "color_limit": math.ceil(weight.abs().max().item() / .05) * .05,
            "sha256": hashlib.sha256(weight.numpy().tobytes() + self.query.bias.detach().numpy().tobytes()).hexdigest(),
        }

    def compute(self, text):
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Введите короткую фразу.")
        if len(text) > 512:
            raise ValueError("Фраза слишком длинная для этого примера.")
        inputs = self.tokenizer(text, return_tensors="pt", return_offsets_mapping=True)
        offsets = inputs.pop("offset_mapping")[0].tolist()
        ids = inputs["input_ids"][0].tolist()
        if len(ids) > MAX_TOKENS:
            raise ValueError(f"Получилось {len(ids)} токенов. Для читаемой записи сократите фразу до {MAX_TOKENS} токенов, включая [CLS] и [SEP].")
        start = perf_counter()
        with self.lock, torch.inference_mode():
            captured = {}
            handle = self.query.register_forward_hook(
                lambda module, args, output: captured.update(x=args[0][0], q=output[0])
            )
            try:
                self.model(**inputs)
            finally:
                handle.remove()
            # These are outputs of the full 256-component projection, not
            # multiplication by only the 4 x 4 fragment displayed in the cube.
            x = captured["x"][:, :4].tolist()
            q = captured["q"].reshape(len(ids), 4, 64).permute(1, 0, 2)[:, :, :4].tolist()
        return {
            "text": text,
            "tokens": self.tokenizer.convert_ids_to_tokens(ids),
            "token_ids": ids,
            "offsets": offsets,
            "parameters": self.parameters,
            "inputs": x,
            "queries": q,
            "model": MODEL,
            "revision": REVISION,
            "layer": self.model.config.num_hidden_layers,
            "heads": [1, 2, 3, 4],
            "total_heads": self.model.config.num_attention_heads,
            "head_dim": self.model.config.hidden_size // self.model.config.num_attention_heads,
            "milliseconds": round((perf_counter() - start) * 1000, 2),
        }


def serve(engine):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT / "dist" if (ROOT / "package.json").exists() else ROOT.parents[1] / "site" / "parameter-cube"), **kwargs)

        def reply(self, code, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != "/api/projection":
                return self.reply(404, {"error": "Not found"})
            if self.headers.get("Origin") not in (None, "http://127.0.0.1:8067", "http://localhost:8067"):
                return self.reply(403, {"error": "Local preview only"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("Некорректный размер запроса.")
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict):
                    raise ValueError("Некорректный запрос.")
                data = engine.compute(request.get("text"))
            except (ValueError, UnicodeError) as error:
                return self.reply(400, {"error": str(error)})
            except Exception:
                import traceback
                traceback.print_exc()
                return self.reply(500, {"error": "Не удалось вычислить проекцию. Попробуйте ещё раз."})
            self.reply(200, data)

    print("Projection preview: http://127.0.0.1:8067/cube.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8067), Handler).serve_forever()


if __name__ == "__main__":
    import sys
    engine = Projection()
    if "--snapshot" in sys.argv:
        (ROOT / "projection.json").write_text(
            json.dumps(engine.compute(DEFAULT_TEXT), ensure_ascii=False, indent=2)
        )
    else:
        serve(engine)
