#!/usr/bin/env python3
"""Exercise dependency setup in the real build entry point without compiling DuckDB."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
LIBRARIES = (
    "roaring", "avro", "aws-cpp-sdk-core", "ssl", "crypto", "curl", "jansson",
    "geos_c", "geos", "proj", "sqlite3", "expat",
)


class BuildDependenciesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ducklings-dependencies-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spatial = self.root / "deps/duckdb-spatial"
        for name in ("duckdb", "duckdb-httpfs", "duckdb-avro", "duckdb-iceberg", "duckdb-spatial"):
            (self.root / "deps" / name).mkdir(parents=True)
        (self.spatial / "CMakeLists.txt").touch()
        subprocess.run(["git", "init", "-q", str(self.spatial)], check=True)
        # Read pristine portfiles even if an earlier native build patched the submodule.
        for name in ("geos", "proj"):
            relative = f"vcpkg_ports/{name}/portfile.cmake"
            original = subprocess.check_output([
                "git", "-C", str(ROOT / "deps/duckdb-spatial"), "show", f"HEAD:{relative}",
            ])
            destination = self.spatial / relative
            destination.parent.mkdir(parents=True)
            destination.write_bytes(original)
        patches = self.root / "patches/duckdb-spatial"
        patches.mkdir(parents=True)
        shutil.copy(ROOT / "patches/duckdb-spatial/emscripten-exceptions.patch", patches)
        (self.root / "build/vcpkg").mkdir(parents=True)
        self.installed = self.root / "vcpkg_installed/wasm32-emscripten/lib"
        self.installed.mkdir(parents=True)
        self.log = self.root / "calls.log"
        installer = self.root / "build/vcpkg/vcpkg"
        installer.write_text("""#!/bin/bash
set -euo pipefail
test "$1" = install
for port in geos proj; do
    grep -q -- '-DCMAKE_CXX_FLAGS=-fexceptions' "$FIXTURE_ROOT/deps/duckdb-spatial/vcpkg_ports/$port/portfile.cmake"
done
echo install >> "$FIXTURE_ROOT/calls.log"
if [ "${FAIL_INSTALL:-0}" = 1 ]; then exit 23; fi
for name in """ + " ".join(LIBRARIES) + """; do
    touch "$FIXTURE_ROOT/vcpkg_installed/wasm32-emscripten/lib/lib$name.a"
done
""")
        installer.chmod(0o755)

    def run_build(self, target, fail_install=False):
        return subprocess.run(["bash", "-c", r'''
source "$BUILD_SCRIPT" "$BUILD_TARGET"
PROJECT_ROOT="$FIXTURE_ROOT"
DUCKDB_SRC="$PROJECT_ROOT/deps/duckdb"
HTTPFS_SRC="$PROJECT_ROOT/deps/duckdb-httpfs"
AVRO_SRC="$PROJECT_ROOT/deps/duckdb-avro"
ICEBERG_SRC="$PROJECT_ROOT/deps/duckdb-iceberg"
SPATIAL_SRC="$PROJECT_ROOT/deps/duckdb-spatial"
BUILD_DIR="$PROJECT_ROOT/build/emscripten"
DIST_DIR="$PROJECT_ROOT/dist"
VCPKG_INSTALLED="$PROJECT_ROOT/vcpkg_installed/wasm32-emscripten"
export EMSCRIPTEN_ROOT=/test-emscripten
# Keep the real patch application and dependency installer; replace network and compilation.
git() {
    case "$1" in fetch|checkout) return 0 ;; *) command git "$@" ;; esac
}
check_emscripten() { :; }
configure_duckdb() { echo configure >> "$FIXTURE_ROOT/calls.log"; }
build_duckdb() { :; }
build_httpfs() { :; }
build_http_wasm_client() { :; }
bundle_nanoarrow() { :; }
build_nanoarrow() { :; }
build_arrow_ipc_insert() { :; }
build_avro() { echo avro >> "$FIXTURE_ROOT/extensions.log"; }
build_iceberg() { echo iceberg >> "$FIXTURE_ROOT/extensions.log"; }
link_wasm_module() { echo "link:$EXTENSION_FLAVOR:$OUTPUT_SUFFIX" >> "$FIXTURE_ROOT/extensions.log"; }
print_summary() { :; }
main
'''], env={
            **os.environ,
            "BUILD_SCRIPT": str(ROOT / "scripts/build-duckdb.sh"),
            "BUILD_TARGET": target,
            "FIXTURE_ROOT": str(self.root),
            "FAIL_INSTALL": "1" if fail_install else "0",
        }, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def test_browser_then_spatial_patches_before_install_and_rechecks_dependencies(self):
        for target in ("browser", "workers-spatial"):
            result = self.run_build(target)
            self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.log.read_text().splitlines(), ["install", "configure", "install", "configure"])

    def test_existing_archives_do_not_bypass_vcpkg_abi_checks(self):
        for name in LIBRARIES:
            (self.installed / f"lib{name}.a").touch()
        result = self.run_build("browser")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.log.read_text().splitlines(), ["install", "configure"])

    def test_base_and_iceberg_build_distinct_artifacts_with_only_selected_extensions(self):
        for target in ("workers", "workers-iceberg"):
            result = self.run_build(target)
            self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual((self.root / "extensions.log").read_text().splitlines(), [
            "link:base:-workers", "avro", "iceberg", "link:iceberg:-workers-iceberg",
        ])

    def test_worker_profiles_and_link_aliases_preserve_the_selected_flavor(self):
        for prefix in ("", "link-", "release-", "link-release-", "debug-", "link-debug-"):
            for suffix, flavor in (("", "base"), ("-iceberg", "iceberg")):
                target = f"{prefix}workers{suffix}"
                with self.subTest(target=target):
                    result = subprocess.run([
                        "bash", "-c",
                        'source "$1" "$2"; echo "$EXTENSION_FLAVOR:$OUTPUT_SUFFIX:$LINK_ONLY:$WORKERS_PROFILE"',
                        "bash", str(ROOT / "scripts/build-duckdb.sh"), target,
                    ], text=True, capture_output=True, check=True)
                    profile = "local-debug" if "debug" in prefix else "release" if "release" in prefix else "build"
                    link = "true" if prefix.startswith("link-") else "false"
                    self.assertEqual(result.stdout.strip(), f"{flavor}:-workers{suffix}:{link}:{profile}")

    def test_install_failure_stops_native_build(self):
        result = self.run_build("browser", fail_install=True)
        self.assertEqual(result.returncode, 23, result.stdout)
        self.assertEqual(self.log.read_text().splitlines(), ["install"])

    def test_browser_requires_spatial_overlay_source(self):
        (self.spatial / "CMakeLists.txt").unlink()
        result = self.run_build("browser")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("all variants use its vcpkg ports", result.stdout)
        self.assertFalse(self.log.exists())

    def test_make_rebuilds_after_manifest_or_overlay_changes(self):
        shutil.copy(ROOT / "Makefile", self.root)
        shutil.copy(ROOT / "vcpkg.json", self.root)
        (self.root / "scripts").mkdir()
        shutil.copy(ROOT / "scripts/build-duckdb.sh", self.root / "scripts")
        (self.root / "vcpkg_ports/example").mkdir(parents=True)
        port = self.root / "vcpkg_ports/example/portfile.cmake"
        port.touch()
        dist = self.root / "dist"
        dist.mkdir()
        for name in ("duckdb.wasm", "duckdb.js"):
            (dist / name).touch()
            os.utime(dist / name, (2_000_000_000, 2_000_000_000))
        def make_status():
            return subprocess.run(["make", "-q", "duckdb-browser"], cwd=self.root, capture_output=True).returncode
        self.assertEqual(make_status(), 0)
        for source in (self.root / "vcpkg.json", port, self.spatial / "vcpkg_ports/proj/portfile.cmake"):
            with self.subTest(source=source):
                original = source.stat()
                os.utime(source, (2_000_000_001, 2_000_000_001))
                self.assertEqual(make_status(), 1)
                os.utime(source, ns=(original.st_atime_ns, original.st_mtime_ns))


if __name__ == "__main__":
    unittest.main(verbosity=2)
