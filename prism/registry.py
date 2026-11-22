"""Load the vehicle registry."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from prism.config import REGISTRY_PATH
from prism.schemas import RegistryRecord


def load_registry(path: Path | str = REGISTRY_PATH) -> list[RegistryRecord]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"Registry not found at {p}. Generate it with: python data/generate_registry.py"
        )
    return [RegistryRecord(**r) for r in json.loads(p.read_text(encoding="utf-8"))]


@lru_cache(maxsize=4)
def cached_registry(path: str = str(REGISTRY_PATH)) -> tuple[RegistryRecord, ...]:
    return tuple(load_registry(path))
