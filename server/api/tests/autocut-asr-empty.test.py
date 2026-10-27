"""Exercise the actual bridge function without loading models or invoking CLI."""
import ast
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / "scripts" / "autocut-asr.py"
function = next(n for n in ast.parse(source.read_text(encoding="utf-8")).body
                if isinstance(n, ast.FunctionDef) and n.name == "transcribe")

class EmptySpeechTests(unittest.TestCase):
    def run_result(self, result):
        class Model:
            def generate(self, **kwargs):
                return result
        scope = {"model": Model()}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), scope)
        return scope["transcribe"]("test.wav")

    def test_explicit_no_speech(self):
        self.assertEqual(self.run_result([{"key": "speech", "text": "", "timestamp": []}]), {"segments": []})

    def test_missing_timestamps_are_not_silently_empty(self):
        for result in [[], None, [{}], [{"text": "有声音", "timestamp": []}], [{"text": ""}]]:
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                self.run_result(result)

    def test_measured_speech_is_preserved(self):
        self.assertEqual(self.run_result([{"sentence_info": [{"start": 12, "end": 345, "text": "原句"}]}]),
                         {"segments": [{"start": 12, "end": 345, "text": "原句", "confidence": None}]})

if __name__ == "__main__":
    unittest.main()
