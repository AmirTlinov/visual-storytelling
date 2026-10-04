"""Listening pages for final narration and whole-take comparisons."""
from html import escape


def write_listening_page(path, *, title, transcript, takes, note):
    cards = []
    for take in takes:
        warnings = "; ".join(take.get("warnings", []))
        cards.append(
            f'<section><h2>{escape(take["label"])}</h2>'
            f'<audio controls preload="metadata" src="{escape(take["audio"], quote=True)}"></audio>'
            f'<p>{take["duration"]:.1f} с</p>'
            + (f'<details><summary>Проверить синхронизацию</summary><p>{escape(warnings)}</p></details>' if warnings else '')
            + '</section>')
    path.write_text(f'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)}</title>
<style>:root{{color-scheme:light dark}}body{{font:17px/1.55 system-ui;margin:40px auto;padding:0 24px;max-width:800px}}
h1{{font-size:1.6rem}}h2{{font-size:1.1rem}}section{{border-block-start:1px solid #8886;padding:14px 0}}
audio{{width:100%}}p{{max-width:70ch}}.transcript{{white-space:pre-line}}small{{opacity:.7}}</style></head>
<body><h1>{escape(title)}</h1><p class="transcript">{escape(transcript)}</p>
{''.join(cards)}<p>{escape(note)}</p>
<small>Акустические метки проверяют синхронизацию; естественность подачи оценивается прослушиванием.</small>
<script>document.querySelectorAll('audio').forEach(a=>a.addEventListener('play',()=>{{
document.querySelectorAll('audio').forEach(b=>{{if(b!==a)b.pause()}})}}))</script></body></html>''')
