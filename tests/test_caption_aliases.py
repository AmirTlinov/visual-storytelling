"""Caption aliases validate against speech and survive assembly without loading TTS."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'audio'))
from script import read_script


class CaptionAliases(unittest.TestCase):
    def test_plain_aliases_must_occur_in_speech_as_whole_phrases(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'narration.json'
            source = {'version': 3, 'segments': [{'id': 'line', 'text': 'Пэ дэ эф: двадцать три страницы.'}]}
            valid = {'пэ дэ эф': 'PDF', 'двадцать три': '23'}
            source['captionAliases'] = valid
            path.write_text(json.dumps(source, ensure_ascii=False))
            self.assertEqual(read_script(path)['captionAliases'], valid)
            self.assertEqual(json.loads(path.read_text()), source)
            for aliases in [None, [], {'': 'PDF'}, {'пэ': ''}, {'пэ': 2}, {'пэ': '<b>PDF</b>'},
                            {'пэ': 'P\nDF'}, {'дэ': 'D', 'ДЭ ': 'other'}, {'страниц': 'pages'},
                            {'двадцать четыре': '24'}]:
                with self.subTest(aliases=aliases):
                    source['captionAliases'] = aliases
                    path.write_text(json.dumps(source, ensure_ascii=False))
                    with self.assertRaisesRegex(ValueError, 'captionAliases'):
                        read_script(path)

    def test_assembly_passes_aliases_without_changing_spoken_text_words_or_cues(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'narration.json'
            source = {'version': 3, 'intro': 0, 'outro': 0, 'music': None,
                      'captionAliases': {'пэ дэ эф': 'PDF', 'двадцать три': '23'},
                      'segments': [{'id': 'line', 'text': 'Пэ дэ эф: двадцать три.',
                                    'cues': [{'id': 'pdf', 'quote': 'пэ дэ эф', 'action': 'Показать PDF'}]}]}
            path.write_text(json.dumps(source, ensure_ascii=False))
            loaded = read_script(path)
            tokens = ['Пэ', 'дэ', 'эф', 'двадцать', 'три']
            aligned = [{'text': text, 'start': i * .2, 'end': i * .2 + .15, 'score': 1}
                       for i, text in enumerate(tokens)]
            speaker = SimpleNamespace(voice=loaded['voice'], identity={'model': 'fixture'},
                                      synthesize=lambda segment: ([0] * 100, 'fixture', {'cached': True}))
            aligner = SimpleNamespace(device='fixture', align=lambda audio, spoken, key: (aligned, {'cached': True}))
            modules = {
                'numpy': SimpleNamespace(float32=float, zeros=lambda length, dtype: [0] * length,
                                         concatenate=lambda chunks: [value for chunk in chunks for value in chunk]),
                'alignment': SimpleNamespace(Aligner=None),
                'speech': SimpleNamespace(Speaker=None, SAMPLE_RATE=100),
                'mixing': SimpleNamespace(mix=lambda voice, music, staging: {'music': None}),
                'listening': SimpleNamespace(write_listening_page=lambda *args, **kwargs: None),
            }
            spec = importlib.util.spec_from_file_location('caption_alias_assembly', ROOT / 'tools/audio/assembly.py')
            assembly = importlib.util.module_from_spec(spec)
            with patch.dict(sys.modules, modules), redirect_stdout(io.StringIO()):
                spec.loader.exec_module(assembly)
                timeline = assembly.build_audio(path, Path(directory) / 'built', 'fixture',
                                                speaker=speaker, aligner=aligner, report=False)
            self.assertEqual(timeline['captionAliases'], source['captionAliases'])
            self.assertEqual(timeline['segments'][0]['text'], source['segments'][0]['text'])
            self.assertEqual([word['text'] for word in timeline['segments'][0]['words']], tokens)
            self.assertEqual(timeline['cues']['pdf']['text'], 'Пэ дэ эф')
            self.assertEqual((timeline['cues']['pdf']['start'], timeline['cues']['pdf']['end']), (0, .55))
            self.assertEqual(json.loads((Path(directory) / 'built/timeline.json').read_text())['captionAliases'], source['captionAliases'])


if __name__ == '__main__':
    unittest.main()
