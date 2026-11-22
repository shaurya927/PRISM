"""Device selection and read-only vendor imports."""

from __future__ import annotations

import contextlib
import importlib
import logging
import sys
from pathlib import Path
from types import ModuleType
from typing import Iterator, Optional

from prism.config import VENDOR_DIR

log = logging.getLogger("prism.runtime")


def resolve_device(pref: str = "auto") -> str:
    """'cuda' if requested/available, else 'cpu'."""
    try:
        import torch

        if pref in ("auto", "cuda") and torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    if pref == "cuda":
        log.warning("CUDA requested but not available; using CPU")
    return "cpu"


def gpu_name() -> Optional[str]:
    try:
        import torch

        return torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    except Exception:
        return None


def vendor_path(repo: str) -> Path:
    return VENDOR_DIR / repo


@contextlib.contextmanager
def vendor_on_path(repo: str) -> Iterator[Optional[Path]]:
    """Temporarily put vendor/<repo> first on sys.path. Files are only read, never written."""
    p = vendor_path(repo)
    if not p.exists():
        yield None
        return
    s = str(p)
    sys.path.insert(0, s)
    try:
        yield p
    finally:
        with contextlib.suppress(ValueError):
            sys.path.remove(s)


def import_vendor_first(module: str, repo: str) -> tuple[ModuleType, str]:
    """Import `module` from vendor/<repo> if present, else from site-packages.

    Returns (module, origin) where origin is "vendor/<repo>" or "pip".
    """
    p = vendor_path(repo)
    if p.exists():
        sys.path.insert(0, str(p))
        try:
            mod = importlib.import_module(module)
            if Path(getattr(mod, "__file__", "") or "").resolve().is_relative_to(p.resolve()):
                return mod, f"vendor/{repo}"
            return mod, "pip"
        except ImportError as exc:
            log.warning("Could not import %s from vendor/%s (%s); trying pip", module, repo, exc)
            with contextlib.suppress(ValueError):
                sys.path.remove(str(p))
            for name in [m for m in sys.modules if m == module or m.startswith(module + ".")]:
                sys.modules.pop(name, None)
    return importlib.import_module(module), "pip"
