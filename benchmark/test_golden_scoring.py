import unittest

from golden_scoring import score, aggregate


class GoldenScoringTests(unittest.TestCase):
    def test_optional_cut_does_not_replace_a_missing_required_cut(self):
        optional_only = score([5], [2], [2])
        self.assertEqual(optional_only['valid'], [2])
        self.assertEqual(optional_only['missing'], [5])
        self.assertFalse(optional_only['complete'])
        self.assertTrue(score([5], [2], [5])['complete'])
        self.assertTrue(score([5], [2], [2,5])['complete'])
        self.assertEqual(score([5], [2], [2,4,5])['invalid'], [4])
        m = aggregate([dict(required=[5], **optional_only)])
        self.assertEqual(m['cut_precision'],1)
        self.assertEqual(m['required_coverage'],0)
        self.assertTrue(score([], [2], [])['complete'])
        self.assertIsNone(aggregate([])['cut_precision'])

    def test_closing_quote_equivalence_is_symmetric_and_preserves_labels(self):
        text = '甲😀“乙”丙'
        # The right quote is at UTF-16 offset 5, not Python code-point index 4.
        for expected, prediction in ((5, 6), (6, 5)):
            with self.subTest(expected=expected):
                result = score([expected], [], [prediction], text=text)
                self.assertTrue(result['complete'])
                self.assertEqual(result['cuts'], [prediction])
                self.assertEqual(result['required_hits'], 1)
                self.assertEqual(result['matches'], [dict(expected=expected,
                    predicted=prediction, level=3, quote_equivalent=True)])
                optional = score([], [expected], [prediction], text=text)
                self.assertTrue(optional['complete'])
                self.assertEqual(optional['optional_hits'], 1)

    def test_two_sides_of_one_quote_do_not_receive_double_credit(self):
        result = score([2], [], [2, 3], text='甲乙”丙丁')
        self.assertEqual(result['valid'], [2])
        self.assertEqual(result['invalid'], [3])
        self.assertEqual(result['required_hits'], 1)
        self.assertFalse(result['complete'])
        metrics = aggregate([dict(required=[2], **result)])
        self.assertEqual(metrics['cut_precision'], .5)
        self.assertEqual(metrics['required_coverage'], 1)

    def test_quote_matching_does_not_cross_other_characters_or_sentence_edges(self):
        for symbol in ('“', '’', '」', '》', '。', '，', '甲', '"'):
            with self.subTest(symbol=symbol):
                result = score([2], [], [3], text='甲乙'+symbol+'丙丁')
                self.assertEqual(result['missing'], [2])
                self.assertEqual(result['invalid'], [3])
        for text, expected, prediction in (('甲乙”丙丁', 2, 4),
                                           ('甲乙””丙丁', 2, 4),
                                           ('甲乙”', 2, 3), ('”甲乙', 1, 0)):
            self.assertFalse(score([expected], [], [prediction], text=text)['complete'])

    def test_quote_matching_prioritizes_required_without_reusing_predictions(self):
        result = score([2], [3], [3], text='甲乙”丙丁')
        self.assertTrue(result['complete'])
        self.assertEqual(result['required_hits'], 1)
        self.assertEqual(result['optional_hits'], 0)
        # Overlapping quote neighborhoods still require one-to-one matching.
        result = score([2, 3], [], [1, 2], text='甲””乙')
        self.assertTrue(result['complete'])
        self.assertEqual(result['required_hits'], 2)
        self.assertEqual(len({m['predicted'] for m in result['matches']}), 2)

    def test_quote_match_cannot_hide_an_unrelated_missing_boundary(self):
        result = score([4], [2], [3], text='甲乙”丙丁戊')
        self.assertEqual(result['valid'], [3])
        self.assertEqual(result['missing'], [4])
        self.assertEqual(result['optional_hits'], 1)
        self.assertFalse(result['complete'])
        # Explicitly preserve the former strict policy for historical callers.
        self.assertFalse(score([2], [], [3])['complete'])


if __name__ == '__main__':
    unittest.main()
