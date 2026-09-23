"""Native port handoff checker. Python standard library only; never executes a generator."""
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import sys


def reject_constant(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=unique_object, parse_constant=reject_constant)


def bundle_path(root, relative):
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or ".." in path.parts or "\\" in relative or ":" in relative:
        raise ValueError(f"Invalid bundle path: {relative}")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"Bundle path escapes root: {relative}")
    return resolved


def load_manifest(root):
    manifest = read_json(root / "manifest.json")
    if manifest.get("format") != "native-building-port-v1" or manifest.get("projection") != "semantic-v1":
        raise ValueError("Unsupported bundle format/projection")
    ids = [case["id"] for case in manifest["fixtures"]]
    if len(ids) != len(set(ids)) or len(ids) != manifest["coverage"]["cases"]:
        raise ValueError("Invalid fixture index")
    for case_id in ids:
        if not case_id or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in case_id):
            raise ValueError(f"Invalid case id: {case_id}")
    return manifest


def expand_references(value, root, manifest, active=()):
    if isinstance(value, dict):
        if set(value) == {"$ref"}:
            path = value["$ref"]
            if path not in manifest["files"] or path in active:
                raise ValueError(f"Missing or cyclic data reference: {path}")
            return expand_references(read_json(bundle_path(root, path)), root, manifest, (*active, path))
        return {key: expand_references(item, root, manifest, active) for key, item in value.items()}
    if isinstance(value, list):
        return [expand_references(item, root, manifest, active) for item in value]
    return value


def pointer_child(path, key):
    return path + "/" + str(key).replace("~", "~0").replace("/", "~1")


def first_difference(expected, actual, path=""):
    """Object order is irrelevant; array order, absent/null and bool/number differ."""
    if isinstance(expected, bool) or isinstance(actual, bool):
        return None if type(expected) is type(actual) and expected == actual else (path, expected, actual)
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return None if math.isfinite(expected) and math.isfinite(actual) and expected == actual else (path, expected, actual)
    if type(expected) is not type(actual):
        return path, expected, actual
    if isinstance(expected, dict):
        for key in sorted(expected.keys() | actual.keys()):
            child = pointer_child(path, key)
            if key not in expected:
                return child, "<absent>", actual[key]
            if key not in actual:
                return child, expected[key], "<absent>"
            difference = first_difference(expected[key], actual[key], child)
            if difference:
                return difference
        return None
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return path + "/<length>", len(expected), len(actual)
        for index, (left, right) in enumerate(zip(expected, actual)):
            difference = first_difference(left, right, pointer_child(path, index))
            if difference:
                return difference
        return None
    return None if expected == actual else (path, expected, actual)


def verify_mesh(mesh):
    if mesh.get("format") != "native-face-mesh-v1":
        raise ValueError("Unsupported mesh format")
    geometry = mesh["geometry"]
    position = geometry["attributes"]["position"]
    if position["itemSize"] != 3 or len(position["array"]) % 3:
        raise ValueError("Invalid position buffer")
    count = len(position["array"]) // 3
    for attribute in geometry["attributes"].values():
        if attribute["itemSize"] <= 0 or len(attribute["array"]) != count * attribute["itemSize"]:
            raise ValueError("Mismatched vertex attribute length")
        if not all(type(n) in (float, int) and math.isfinite(n) for n in attribute["array"]):
            raise ValueError("Invalid vertex value")
    indices = geometry["index"]
    if len(indices) % 3 or any(type(i) is not int or not 0 <= i < count for i in indices):
        raise ValueError("Invalid triangle index")
    covered = 0
    for group in geometry["groups"]:
        if (group["start"] != covered or group["count"] < 0 or group["count"] % 3
                or group["materialIndex"] not in (0, 1, 2, 3)):
            raise ValueError("Invalid mesh material group")
        covered += group["count"]
    if covered != len(indices):
        raise ValueError("Material groups do not cover all triangles")


def verify_bundle(root, manifest):
    for relative, record in manifest["files"].items():
        path = bundle_path(root, relative)
        content = path.read_bytes()
        if len(content) != record["bytes"] or hashlib.sha256(content).hexdigest() != record["sha256"]:
            raise ValueError(f"Integrity mismatch: {relative}")
        if path.suffix not in (".json", ".md", ".py"):
            raise ValueError(f"Unexpected executable/runtime artifact: {relative}")
        if path.suffix == ".json":
            read_json(path)
    for case in manifest["fixtures"]:
        for role in ("input", "expected", "reference"):
            if case[role] not in manifest["files"]:
                raise ValueError(f"Unindexed fixture file: {case[role]}")
        packed = read_json(bundle_path(root, case["input"]))
        if packed.get("format") != "native-port-input-v1":
            raise ValueError("Unsupported input format")
        document = expand_references(packed["document"], root, manifest)
        if document["schemaVersion"] != 6 or document["catalog"]["version"] != 13:
            raise ValueError("Unsupported reference document/catalog")
    if len(manifest["meshes"]) != manifest["coverage"]["meshes"]:
        raise ValueError("Invalid mesh index")
    keys = set()
    for mesh in manifest["meshes"]:
        if mesh["path"] not in manifest["files"] or mesh["key"] in keys:
            raise ValueError("Missing or duplicate mesh")
        keys.add(mesh["key"])
        payload = read_json(bundle_path(root, mesh["path"]))
        if payload["key"] != mesh["key"]:
            raise ValueError("Mesh key mismatch")
        verify_mesh(payload)


def selected_cases(manifest, case_id):
    cases = [case for case in manifest["fixtures"] if case_id is None or case["id"] == case_id]
    if not cases:
        raise ValueError(f"Unknown case: {case_id}")
    return cases


def compare_outputs(root, manifest, actual_root, cases, section=None):
    failures = []
    for case in cases:
        path = actual_root / (case["id"] + ".json")
        if not path.is_file():
            failures.append(f"{case['id']}: missing output {path}")
            continue
        expected = read_json(bundle_path(root, case["expected"]))
        actual = read_json(path)
        if section:
            if not isinstance(actual, dict) or section not in actual or section not in expected:
                failures.append(f"{case['id']}: missing section {section}")
                continue
            expected, actual = expected[section], actual[section]
        difference = first_difference(expected, actual, "/" + section if section else "")
        if difference:
            pointer, left, right = difference
            failures.append(f"{case['id']} {pointer or '/'}: expected {repr(left)[:160]}, got {repr(right)[:160]}")
    return failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "materialize", "compare"):
        sub = commands.add_parser(command)
        sub.add_argument("bundle", type=Path)
        if command != "verify":
            sub.add_argument("directory", type=Path)
            sub.add_argument("--case")
        if command == "compare":
            sub.add_argument("--section", choices=["status", "diagnostics", "surfaces", "placements", "modules",
                "scenePlacements", "vertical", "entrances", "reservations", "stages"])
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.bundle)
        verify_bundle(args.bundle, manifest)
        if args.command == "verify":
            print(f"Verified {len(manifest['fixtures'])} cases and {len(manifest['meshes'])} meshes")
            return 0
        cases = selected_cases(manifest, args.case)
        if args.command == "materialize":
            args.directory.mkdir(parents=True, exist_ok=False)
            for case in cases:
                packed = read_json(bundle_path(args.bundle, case["input"]))
                document = expand_references(packed["document"], args.bundle, manifest)
                with (args.directory / (case["id"] + ".json")).open("x", encoding="utf-8") as stream:
                    json.dump(document, stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                    stream.write("\n")
            print(f"Materialized {len(cases)} schema-6 inputs; no generator was executed")
            return 0
        failures = compare_outputs(args.bundle, manifest, args.directory, cases, args.section)
        for failure in failures[:20]:
            print(failure, file=sys.stderr)
        if failures:
            print(f"FAILED: {len(failures)}/{len(cases)} cases", file=sys.stderr)
            return 1
        print(f"Matched {len(cases)} cases ({args.section or 'full semantic-v1'}); this checks outputs, not implementation provenance")
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
