"""Portable integrity and target-output comparison. Python standard library only."""
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import sys


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load(path):
    def reject(value):
        raise ValueError(f"Nonfinite JSON constant: {value}")
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_object, parse_constant=reject)


def verify(directory):
    directory = Path(directory).resolve()
    manifest = load(directory / "manifest.json")
    schema = manifest.get("schema")
    if schema not in ("crowd-port-manifest-v1", "crowd-port-bundle-v1"):
        raise ValueError("Unknown manifest schema")
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Empty or invalid manifest")
    for name, digest in files.items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
            raise ValueError(f"Unsafe manifest path: {name}")
        path = (directory / name).resolve()
        if not path.is_relative_to(directory):
            raise ValueError(f"Manifest path escapes package: {name}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Integrity failure: {name}")
    if schema == "crowd-port-manifest-v1":
        actual = {p.name for p in directory.glob("*.json") if p.name != "manifest.json"}
        if actual != set(files):
            raise ValueError("Fixture inventory differs from manifest")
    else:
        verify(directory / "fixtures")
    return files


def differences(expected, actual, atol=1e-8, rtol=1e-10, limit=20):
    errors = []
    exact_fields = {"tick", "flow", "active"}

    def visit(want, got, path, field=""):
        if len(errors) >= limit:
            return
        if isinstance(want, dict):
            if not isinstance(got, dict):
                errors.append(f"{path}: expected object")
                return
            for key in sorted(want.keys() - got.keys()):
                errors.append(f"{path}.{key}: missing")
            for key in sorted(got.keys() - want.keys()):
                errors.append(f"{path}.{key}: unexpected")
            for key in sorted(want.keys() & got.keys()):
                visit(want[key], got[key], f"{path}.{key}", key)
        elif isinstance(want, list):
            if not isinstance(got, list):
                errors.append(f"{path}: expected array")
            elif len(want) != len(got):
                errors.append(f"{path}: length expected {len(want)}, got {len(got)}")
            else:
                for index, (left, right) in enumerate(zip(want, got)):
                    visit(left, right, f"{path}[{index}]", field)
        elif type(want) in (int, float):
            if type(got) not in (int, float) or not math.isfinite(want) or not math.isfinite(got):
                errors.append(f"{path}: expected finite number, got {got!r}")
            else:
                tolerance = 0 if field in exact_fields else atol + rtol * abs(want)
                if abs(want - got) > tolerance:
                    errors.append(f"{path}: expected {want!r}, got {got!r}; absolute error {abs(want-got):.12g}, allowed {tolerance:.12g}")
        elif type(want) is not type(got) or want != got:
            errors.append(f"{path}: expected {want!r}, got {got!r}")

    visit(expected, actual, "$")
    return errors[:limit]


def compare(fixture_path, target_path, atol, rtol):
    fixture, target = load(fixture_path), load(target_path)
    if fixture.get("schema") != "crowd-port-fixture-v1" or not isinstance(fixture.get("expected"), dict):
        raise ValueError("Not a crowd port fixture")
    if not isinstance(target, dict) or target.get("schema") != "crowd-port-output-v1":
        raise ValueError("Not a crowd-port-output-v1 target output")
    errors = differences(fixture["expected"], target, atol, rtol)
    if errors:
        print(f"FAIL {fixture['id']} (atol={atol:g}, rtol={rtol:g}; up to 20 differences)")
        for error in errors:
            print(error)
        return False
    print(f"PASS {fixture['id']} (atol={atol:g}, rtol={rtol:g})")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    integrity = commands.add_parser("verify", help="Verify a fixture directory or exported package")
    integrity.add_argument("directory")
    for name in ("compare", "compare-all"):
        command = commands.add_parser(name)
        command.add_argument("fixture", help="Fixture JSON, or fixture directory for compare-all")
        command.add_argument("target", help="Target output JSON, or target directory for compare-all")
        command.add_argument("--atol", type=float, default=1e-8)
        command.add_argument("--rtol", type=float, default=1e-10)
    args = parser.parse_args(argv)
    try:
        if args.command == "verify":
            files = verify(args.directory)
            print(f"Verified {len(files)} files")
            return 0
        if not all(math.isfinite(t) and t >= 0 for t in (args.atol, args.rtol)):
            raise ValueError("Tolerances must be finite and nonnegative")
        if args.command == "compare":
            verify(Path(args.fixture).parent)
            return 0 if compare(args.fixture, args.target, args.atol, args.rtol) else 1
        files = verify(args.fixture)
        targets = {p.name for p in Path(args.target).glob("*.json")}
        if targets != set(files):
            raise ValueError(f"Target inventory mismatch; missing={sorted(set(files)-targets)}, extra={sorted(targets-set(files))}")
        passed = True
        for name in sorted(files):
            passed = compare(Path(args.fixture) / name, Path(args.target) / name, args.atol, args.rtol) and passed
        return 0 if passed else 1
    except (OSError, ValueError, TypeError, KeyError, OverflowError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
