import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from check import differences, load, main, verify


class ComparatorTests(unittest.TestCase):
    def setUp(self):
        self.expected = {"schema": "crowd-port-output-v1", "id": "case", "frames": [
            {"tick": 1, "goals": [{"x": 10.0, "y": 0.0}], "agents": [
                {"id": "a", "flow": 0, "active": 1, "x": 100.0, "heading": 0.1}]}]}

    def test_tolerance_applies_only_to_continuous_fields(self):
        actual = copy.deepcopy(self.expected)
        actual["frames"][0]["agents"][0]["x"] += 1e-9
        self.assertEqual(differences(self.expected, actual), [])
        self.assertIn("$.frames[0].agents[0].x", differences(self.expected, actual, 0, 0)[0])
        actual["frames"][0]["agents"][0]["active"] += 1e-9
        self.assertTrue(any(".active" in error for error in differences(self.expected, actual)))

    def test_shape_identity_and_nonfinite_cannot_pass(self):
        for mutation in (lambda a: a.update(id="wrong"), lambda a: a["frames"].clear(),
                         lambda a: a["frames"][0]["agents"][0].update(x=float("nan")),
                         lambda a: a["frames"][0]["agents"][0].update(active=True),
                         lambda a: a.update(extra=1)):
            actual = copy.deepcopy(self.expected)
            mutation(actual)
            self.assertTrue(differences(self.expected, actual))

    def test_integrity_and_exit_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture = root / "case.json"
            fixture.write_text(json.dumps({"schema": "crowd-port-fixture-v1", "id": "case", "expected": self.expected}))
            manifest = {"schema": "crowd-port-manifest-v1", "files": {"case.json": hashlib.sha256(fixture.read_bytes()).hexdigest()}}
            (root / "manifest.json").write_text(json.dumps(manifest))
            self.assertEqual(len(verify(root)), 1)
            target = root / "target"
            target.mkdir()
            output = target / "case.json"
            output.write_text(json.dumps(self.expected))
            self.assertEqual(main(["compare-all", str(root), str(target)]), 0)
            changed = copy.deepcopy(self.expected)
            changed["frames"][0]["agents"][0]["x"] += 1
            output.write_text(json.dumps(changed))
            self.assertEqual(main(["compare", str(fixture), str(output)]), 1)
            self.assertEqual(main(["compare", str(fixture), str(output), "--atol=nan"]), 2)
            fixture.write_text("{}")
            with self.assertRaisesRegex(ValueError, "Integrity"):
                verify(root)

    def test_json_duplicate_keys_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "duplicate.json"
            path.write_text('{"x":1,"x":2}')
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                load(path)


if __name__ == "__main__":
    unittest.main()
