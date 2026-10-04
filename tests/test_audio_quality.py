import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'audio'))
from quality import validate_alignment, complete_take, AlignmentQualityError

class SpeechQuality(unittest.TestCase):
    def test_good_mean_cannot_hide_a_missing_tail_or_middle(self):
        good = [{'text': 'слово', 'score': .9}] * 80
        missing = [{'text': 'конец', 'score': .07}] * 16
        for words in [good + missing, good[:30] + missing + good[30:], missing + good]:
            with self.assertRaises(AlignmentQualityError):
                validate_alignment(words)
        validate_alignment(good + [{'text': 'термин', 'score': .02}])
        for score in [float('nan'), float('inf'), -1, 1.2, True, None]:
            with self.assertRaisesRegex(AlignmentQualityError, 'invalid alignment scores'):
                validate_alignment([{'text': 'слово', 'score': score}])

    def test_cached_bad_take_is_retried_whole_and_failure_is_bounded(self):
        class Speaker:
            def __init__(self): self.seeds = []
            def synthesize(self, segment):
                self.seeds.append(segment['seed'])
                return b'whole-take', segment['seed'], {'cached': True}
        class Aligner:
            def align(self, audio, text, key):
                self.asserted = (audio, text)
                return [{'text': 'слово', 'score': .03 if key == 42 else .9}] * 8, {}
        speaker, aligner = Speaker(), Aligner()
        segment = {'id': 'explain', 'seed': 42, 'spoken': 'Одна цельная мысль'}
        result = complete_take(speaker, aligner, segment)
        self.assertEqual(speaker.seeds, [42,43])
        self.assertEqual(result[0]['seed'], 43)
        self.assertEqual(aligner.asserted, (b'whole-take', 'Одна цельная мысль'))
        class Missing:
            def align(self,*_): raise AlignmentQualityError('missing tail')
        speaker = Speaker()
        with self.assertRaisesRegex(AlignmentQualityError, 'after 3 attempts'):
            complete_take(speaker, Missing(), segment)
        self.assertEqual(speaker.seeds, [42,43,44])

if __name__ == '__main__': unittest.main()
