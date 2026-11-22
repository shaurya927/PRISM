"""Chain of custody: SHA-256 of inputs and artifacts, model versions, config hash,
and git commits of PRISM and every vendor repo."""

from __future__ import annotations

import hashlib
import subprocess
import threading
from importlib import metadata
from pathlib import Path
from typing import Iterable, Optional

from prism.config import PRISM_VERSION, ROOT, VENDOR_DIR, PrismConfig, config_dict, config_hash
from prism.schemas import ArtifactHash, ClipMeta, Custody

VENDOR_REPOS = ("fast-alpr", "parseq", "lpsr-lacd", "vehicle-reidentification")
TRACKED_PACKAGES = (
    "torch", "torchvision", "ultralytics", "open_clip_torch", "fast-alpr", "fast-plate-ocr",
    "open-image-models", "onnxruntime", "onnxruntime-gpu", "opencv-python-headless", "opencv-python",
    "numpy", "fastapi", "pydantic", "jinja2", "playwright", "pytorch-lightning", "timm",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _read_git_head(repo: Path) -> Optional[str]:
    git = repo / ".git"
    head = git / "HEAD"
    if not head.exists():
        return None
    ref = head.read_text().strip()
    if not ref.startswith("ref:"):
        return ref
    ref_path = git / ref.split(" ", 1)[1]
    if ref_path.exists():
        return ref_path.read_text().strip()
    packed = git / "packed-refs"
    if packed.exists():
        name = ref.split(" ", 1)[1]
        for line in packed.read_text().splitlines():
            if line.endswith(name):
                return line.split(" ", 1)[0]
    return None


def git_commit(repo: Path) -> Optional[str]:
    if not (repo / ".git").exists():
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return _read_git_head(repo)


def vendor_commits(vendor_dir: Path = VENDOR_DIR) -> dict[str, str]:
    return {name: (git_commit(vendor_dir / name) or "not present") for name in VENDOR_REPOS}


def package_versions(names: Iterable[str] = TRACKED_PACKAGES) -> dict[str, str]:
    out: dict[str, str] = {}
    for n in names:
        try:
            out[n] = metadata.version(n)
        except metadata.PackageNotFoundError:
            continue
    return out


class CustodyLog:
    """Collects artifact hashes as they are written (thread-safe)."""

    def __init__(self, base_dir: Path, url_prefix: str):
        self.base_dir = Path(base_dir)
        self.url_prefix = url_prefix.rstrip("/")
        self._items: dict[str, ArtifactHash] = {}
        self._lock = threading.Lock()

    def url_for(self, path: Path) -> str:
        rel = Path(path).resolve().relative_to(self.base_dir.resolve()).as_posix()
        return f"{self.url_prefix}/{rel}"

    def record(self, path: Path, kind: str) -> str:
        url = self.url_for(path)
        digest = sha256_file(path)
        with self._lock:
            self._items[url] = ArtifactHash(path=url, sha256=digest, kind=kind)
        return url

    def items(self) -> list[ArtifactHash]:
        with self._lock:
            return sorted(self._items.values(), key=lambda a: a.path)


def build_custody(
    cfg: PrismConfig,
    clips: list[ClipMeta],
    models: dict[str, str],
    artifacts: list[ArtifactHash],
    registry_path: Optional[Path] = None,
) -> Custody:
    reg_hash = sha256_file(registry_path) if registry_path and Path(registry_path).exists() else None
    return Custody(
        clip_sha256=clips[0].sha256 if clips else None,
        clips=clips,
        models={"prism": PRISM_VERSION, **models},
        packages=package_versions(),
        vendor_commits=vendor_commits(),
        prism_commit=git_commit(ROOT),
        config_hash=config_hash(cfg),
        config=config_dict(cfg),
        artifacts=artifacts,
        registry_sha256=reg_hash,
    )
