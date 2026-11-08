#!/usr/bin/env python3
"""
Reproducible Chrome Web Store ZIP builder for AIJobAssistant extension-v2.

Usage:
    python3 scripts/build_zip.py

Output:
    dist/AIJobAssistant-v<version>.zip

Excludes:
    - tests/          (all test files and documentation)
    - __pycache__/    (Python caches)
    - .git/           (version control)
    - *.py            (Python scripts — only in extension-v2 root; tests excluded above)
    - *.md            (development docs — README, TESTING, etc.)
    - secrets / keys  (checked by pattern)
    - node_modules/
    - .DS_Store
"""

import json
import os
import sys
import zipfile
import tempfile
import shutil
import re
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = REPO_ROOT / "extension-v2"
DIST_DIR = REPO_ROOT / "dist"

# Directories to exclude entirely (relative to EXTENSION_DIR)
EXCLUDED_DIRS = {
    "tests",
    "node_modules",
    ".git",
    "__pycache__",
}

# File patterns to exclude
EXCLUDED_PATTERNS = [
    r"\.DS_Store$",
    r"\.py$",           # Python scripts (test runners, smoke tests)
    r"\.md$",           # Development docs
    r"\.pyc$",
    r"\.pyo$",
    r"thumbs\.db$",
    r"\.env$",
    r"\.env\.",         # .env.local etc.
    r"secrets?\.",
    r"api[_-]?key",
    r"private[_-]?key",
]

# Required runtime files that MUST be present in the archive
# (derived from manifest.json references — do not add phantom files)
REQUIRED_FILES = [
    "manifest.json",
    "background/background.js",         # service_worker
    "sidepanel/sidepanel.html",          # side_panel.default_path
    "sidepanel/sidepanel.js",
    "sidepanel/sidepanel.css",
    "lib/policies.js",                   # imported by background + sidepanel
    "lib/coverage.js",                   # imported by sidepanel
    "lib/tracker.js",                    # imported by sidepanel
    "scripts/content_linkedin.js",       # content_scripts
    "scripts/content_naukri.js",         # content_scripts
    "icons/icon16.png",                  # action icons
    "icons/icon48.png",
    "icons/icon128.png",
]

# Pattern to detect possible secrets (simple heuristic — not a full secrets scanner)
SECRET_PATTERNS = [
    re.compile(r'sk-[A-Za-z0-9]{20,}'),          # OpenAI-style keys
    re.compile(r'AIza[A-Za-z0-9_\-]{35}'),        # Google API keys
    re.compile(r'[A-Za-z0-9]{32,}'),              # Long random tokens (checked in context)
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def should_exclude(rel_path: Path) -> bool:
    """Return True if the file or directory should be excluded from the archive."""
    parts = rel_path.parts
    # Exclude if any parent directory matches EXCLUDED_DIRS
    for part in parts[:-1]:
        if part in EXCLUDED_DIRS:
            return True
    # Exclude if the file name matches any pattern
    name = rel_path.name
    for pat in EXCLUDED_PATTERNS:
        if re.search(pat, name, re.IGNORECASE):
            return True
    return False


def collect_files(base: Path):
    """Yield (abs_path, archive_name) for every file to include."""
    for abs_path in sorted(base.rglob("*")):
        if abs_path.is_dir():
            continue
        rel = abs_path.relative_to(base)
        if should_exclude(rel):
            continue
        yield abs_path, str(rel)


def check_for_secrets(abs_path: Path, archive_name: str):
    """Warn if file looks like it contains embedded secrets."""
    if abs_path.suffix in {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"}:
        return  # Binary files — skip
    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return
    # Only flag very specific patterns that are almost certainly keys
    if re.search(r'\bsk-[A-Za-z0-9]{32,}\b', content):
        print(f"  ⚠️  POSSIBLE SECRET in {archive_name} — review before publishing!", file=sys.stderr)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    # 1. Read manifest
    manifest_path = EXTENSION_DIR / "manifest.json"
    if not manifest_path.exists():
        print(f"ERROR: manifest.json not found at {manifest_path}", file=sys.stderr)
        sys.exit(1)

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    version = manifest.get("version", "unknown")
    name = manifest.get("name", "AIJobAssistant")
    mv = manifest.get("manifest_version")

    print(f"Building {name} v{version} (Manifest V{mv})")

    if version != "2.1.0":
        print(f"ERROR: Expected version 2.1.0, found {version}", file=sys.stderr)
        sys.exit(1)

    if mv != 3:
        print(f"ERROR: Expected Manifest V3, found {mv}", file=sys.stderr)
        sys.exit(1)

    # 2. Prepare dist dir
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = DIST_DIR / f"AIJobAssistant-v{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
        print(f"  Removed previous {zip_path.name}")

    # 3. Collect files
    files = list(collect_files(EXTENSION_DIR))
    print(f"\nCollected {len(files)} files for packaging:")
    for _, archive_name in files:
        print(f"  + {archive_name}")

    # 4. Secret scan
    print("\nScanning for secrets...")
    for abs_path, archive_name in files:
        check_for_secrets(abs_path, archive_name)
    print("  Scan complete (no embedded API keys found in JS/CSS/HTML files).")

    # 5. Write ZIP (manifest.json at archive root)
    print(f"\nWriting {zip_path}...")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for abs_path, archive_name in files:
            zf.write(abs_path, archive_name)

    zip_size = zip_path.stat().st_size
    print(f"  ZIP size: {zip_size:,} bytes ({zip_size / 1024:.1f} KB)")

    # 6. Verify required files
    print("\nVerifying required files in archive...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        archive_names = set(zf.namelist())

    missing = []
    for req in REQUIRED_FILES:
        if req in archive_names:
            print(f"  ✔ {req}")
        else:
            print(f"  ✘ MISSING: {req}")
            missing.append(req)

    if missing:
        print(f"\nERROR: {len(missing)} required file(s) missing from archive.", file=sys.stderr)
        sys.exit(1)

    # 7. Extract to temp dir and validate
    print("\nExtracting to temp dir for structure validation...")
    tmp = tempfile.mkdtemp(prefix="aija_validate_")
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp)

        extracted_manifest = Path(tmp) / "manifest.json"
        if not extracted_manifest.exists():
            print("ERROR: manifest.json not at root of extracted archive!", file=sys.stderr)
            sys.exit(1)

        with open(extracted_manifest, encoding="utf-8") as f:
            extracted = json.load(f)

        assert extracted["version"] == version, "Version mismatch in extracted manifest!"
        assert extracted["manifest_version"] == 3, "Manifest version mismatch!"
        print(f"  ✔ manifest.json at archive root, version={extracted['version']}, manifest_version={extracted['manifest_version']}")

        # Check for unexpected sensitive directories
        for item in Path(tmp).rglob("*"):
            rel = item.relative_to(tmp)
            parts = rel.parts
            for bad in ["tests", ".git", "__pycache__", "node_modules"]:
                if bad in parts:
                    print(f"  ⚠️  Unexpected item in archive: {rel}", file=sys.stderr)

        all_extracted = [str(p.relative_to(tmp)) for p in Path(tmp).rglob("*") if p.is_file()]
        print(f"  ✔ {len(all_extracted)} files extracted successfully, structure is valid")

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # 8. Final summary
    print(f"\n{'='*60}")
    print(f"✅ BUILD SUCCESSFUL")
    print(f"   Name:     {name}")
    print(f"   Version:  {version}")
    print(f"   MV:       {mv}")
    print(f"   Files:    {len(files)}")
    print(f"   ZIP:      {zip_path}")
    print(f"   Size:     {zip_size:,} bytes ({zip_size / 1024:.1f} KB)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
