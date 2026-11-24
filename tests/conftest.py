import sys
from pathlib import Path

import os

import pytest

# A local .env may hold Clerk keys; the API tests run without sign-in. test_auth.py turns it back on.
os.environ["PRISM_AUTH"] = "off"

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from prism.config import PrismConfig  # noqa: E402
from prism.schemas import AttributeValue, RegistryRecord  # noqa: E402


@pytest.fixture
def cfg() -> PrismConfig:
    return PrismConfig()


def attr(value: str, conf: float = 0.9, uncertain: bool = False) -> AttributeValue:
    return AttributeValue(value=value, confidence=conf, uncertain=uncertain, top2=[(value, conf)])


def rec(rid: str, plate: str, color: str = "white", body: str = "car", make: str = "Hyundai",
        model: str = "Verna") -> RegistryRecord:
    return RegistryRecord(registry_id=rid, plate=plate, color=color, body_type=body, make=make,
                          model=model, owner_region="Raipur, CG")


@pytest.fixture
def small_registry() -> list[RegistryRecord]:
    return [
        rec("REG-0001", "CG04MX4821"),
        rec("REG-0002", "CG04NX4821"),
        rec("REG-0003", "CG04MX4621"),
        rec("REG-0004", "CG04MX4827", color="silver"),
        rec("REG-0005", "CG04HX4821", body="SUV", make="Hyundai", model="Creta"),
        rec("REG-0100", "MH12DE5678", color="black", body="SUV", make="Toyota", model="Innova"),
        rec("REG-0101", "KA05MN2023", color="blue", make="Maruti Suzuki", model="Alto"),
        rec("REG-0102", "DL3CAB1234", color="black", body="SUV"),
        rec("REG-0103", "22BH1234AA", color="white", body="SUV"),
    ]
