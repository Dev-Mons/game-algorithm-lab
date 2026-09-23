import json
from pathlib import Path
import tempfile
import unittest

from check import first_difference, expand_references, read_json, compare_outputs, bundle_path, verify_mesh


class PortingContractChecks(unittest.TestCase):
    def test_native_number_and_object_encodings_are_accepted(self):
        self.assertIsNone(first_difference({"x": 1, "z": [-2, 0]}, {"z": [-2.0, 0.0], "x": 1.0}))

    def test_order_null_boolean_and_ownership_changes_are_rejected(self):
        for left, right, path in [
            (["PX", "NX"], ["NX", "PX"], "/0"),
            ({}, {"portal": None}, "/portal"),
            ({"accepted": True}, {"accepted": 1}, "/accepted"),
            ({"placements": [{"faceId": "0,0,0|PX"}]}, {"placements": [{"faceId": "0,0,0|NX"}]}, "/placements/0/faceId"),
        ]:
            self.assertEqual(first_difference(left, right)[0], path)

    def test_reference_expansion_needs_no_source_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "style.json").write_text('{"id":"shop","version":11}', encoding="utf-8")
            manifest = {"files": {"style.json": {}}}
            document = {"theme": {"$ref": "style.json"}, "anchor": [-2, 0, 1]}
            self.assertEqual(expand_references(document, root, manifest),
                             {"theme": {"id": "shop", "version": 11}, "anchor": [-2, 0, 1]})
            (root / "style.json").write_text('{"$ref":"style.json"}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cyclic"):
                expand_references(document, root, manifest)
            with self.assertRaises(ValueError):
                bundle_path(root, "../outside.json")

    def test_missing_output_and_missing_stage_do_not_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "expected.json").write_text('{"placements":[]}', encoding="utf-8")
            cases = [{"id": "A-low", "expected": "expected.json"}]
            self.assertIn("missing output", compare_outputs(root, {}, root, cases)[0])
            (root / "A-low.json").write_text('{}', encoding="utf-8")
            self.assertIn("missing section", compare_outputs(root, {}, root, cases, "placements")[0])

    def test_ambiguous_json_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.json"
            for text in ['{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}']:
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(ValueError):
                    read_json(path)

    def test_mesh_material_coverage_and_indices_are_checked(self):
        mesh = {"format": "native-face-mesh-v1", "geometry": {
            "attributes": {"position": {"itemSize": 3, "array": [0, 0, 0, 1, 0, 0, 0, 1, 0]}},
            "index": [0, 1, 2], "groups": [{"start": 0, "count": 3, "materialIndex": 3}]}}
        verify_mesh(mesh)
        broken = json.loads(json.dumps(mesh))
        broken["geometry"]["index"][2] = 3
        with self.assertRaisesRegex(ValueError, "index"):
            verify_mesh(broken)
        mesh["geometry"]["groups"][0]["count"] = 0
        with self.assertRaisesRegex(ValueError, "cover"):
            verify_mesh(mesh)


if __name__ == "__main__":
    unittest.main()
