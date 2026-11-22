"""Generate the synthetic Indian vehicle registry (data/registry.json).

* 500 records, fixed seed, all owner data synthetic.
* Plates from Chhattisgarh, Maharashtra, Delhi (old DL 1C AB format), Karnataka and
  Bharat-series (BH).
* Make/model fixes the body type; colours follow realistic frequencies.
* Each demo vehicle gets 3-5 near-duplicate decoys that differ in one plate
  position (sometimes a confusable one), the colour, or the body type.

Usage:  python data/generate_registry.py [--n 500] [--seed 42] [--out data/registry.json]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from prism.config import REGISTRY_PATH, SEED, VEHICLE_MODELS  # noqa: E402
from prism.plate_grammar import is_valid_plate  # noqa: E402

# Demo vehicles: their plates are rendered into the synthetic demo clips
# (scripts/make_demo_clips.py), so the correct answer is known.
DEMO_VEHICLES: list[dict] = [
    {"registry_id": "REG-0001", "plate": "CG04MX4821", "color": "white", "body_type": "car",
     "make": "Hyundai", "model": "Verna", "body_style": "sedan", "owner_region": "Raipur, CG",
     "image": "vid_front2_white_car.jpg"},
    {"registry_id": "REG-0010", "plate": "MH12DE5678", "color": "black", "body_type": "SUV",
     "make": "Toyota", "model": "Innova", "body_style": "MPV", "owner_region": "Pune, MH",
     "image": "vid_front2_black_car.jpg"},
    {"registry_id": "REG-0020", "plate": "KA05MN2023", "color": "blue", "body_type": "car",
     "make": "Maruti Suzuki", "model": "Alto", "body_style": "hatchback", "owner_region": "Bengaluru South, KA",
     "image": "vid_back_blue_car.jpg"},
]

# Near-duplicate decoys (3-5 per demo vehicle).
DECOYS: list[dict] = [
    # CG04MX4821: REG-0002 differs only at position 9 (the AMBIGUOUS demo: that digit is smeared
    # in the night clip), then position 8, colour, body type and position 5.
    {"registry_id": "REG-0002", "plate": "CG04MX4851", "color": "white", "body_type": "car",
     "make": "Hyundai", "model": "Verna", "body_style": "sedan", "owner_region": "Raipur, CG"},
    {"registry_id": "REG-0003", "plate": "CG04MX4621", "color": "white", "body_type": "car",
     "make": "Honda", "model": "City", "body_style": "sedan", "owner_region": "Raipur, CG"},
    {"registry_id": "REG-0004", "plate": "CG04MX4827", "color": "silver", "body_type": "car",
     "make": "Hyundai", "model": "Verna", "body_style": "sedan", "owner_region": "Raipur, CG"},
    {"registry_id": "REG-0005", "plate": "CG04HX4821", "color": "white", "body_type": "SUV",
     "make": "Hyundai", "model": "Creta", "body_style": "SUV", "owner_region": "Raipur, CG"},
    {"registry_id": "REG-0006", "plate": "CG04NX4821", "color": "white", "body_type": "car",
     "make": "Maruti Suzuki", "model": "Dzire", "body_style": "sedan", "owner_region": "Raipur, CG"},
    # MH12DE5678
    {"registry_id": "REG-0011", "plate": "MH12DE5670", "color": "black", "body_type": "SUV",
     "make": "Toyota", "model": "Innova", "body_style": "MPV", "owner_region": "Pune, MH"},
    {"registry_id": "REG-0012", "plate": "MH12DF5678", "color": "grey", "body_type": "SUV",
     "make": "Maruti Suzuki", "model": "Ertiga", "body_style": "MPV", "owner_region": "Pune, MH"},
    {"registry_id": "REG-0013", "plate": "MH12DE5878", "color": "black", "body_type": "SUV",
     "make": "Mahindra", "model": "Scorpio", "body_style": "SUV", "owner_region": "Pune, MH"},
    {"registry_id": "REG-0014", "plate": "MH14DE5678", "color": "black", "body_type": "car",
     "make": "Honda", "model": "City", "body_style": "sedan", "owner_region": "Pimpri-Chinchwad, MH"},
    # KA05MN2023
    {"registry_id": "REG-0021", "plate": "KA05MN2028", "color": "blue", "body_type": "car",
     "make": "Maruti Suzuki", "model": "Alto", "body_style": "hatchback", "owner_region": "Bengaluru South, KA"},
    {"registry_id": "REG-0022", "plate": "KA05MM2023", "color": "blue", "body_type": "car",
     "make": "Maruti Suzuki", "model": "WagonR", "body_style": "hatchback", "owner_region": "Bengaluru South, KA"},
    {"registry_id": "REG-0023", "plate": "KA03MN2023", "color": "green", "body_type": "car",
     "make": "Maruti Suzuki", "model": "Alto", "body_style": "hatchback", "owner_region": "Bengaluru East, KA"},
    {"registry_id": "REG-0024", "plate": "KA05MN2073", "color": "blue", "body_type": "car",
     "make": "Tata", "model": "Tiago", "body_style": "hatchback", "owner_region": "Bengaluru South, KA"},
]

# Extra format examples (Delhi old-style and Bharat series).
FORMAT_EXAMPLES: list[dict] = [
    {"registry_id": "REG-0030", "plate": "DL3CAB1234", "color": "black", "body_type": "SUV",
     "make": "Mahindra", "model": "Scorpio", "body_style": "SUV", "owner_region": "New Delhi, DL"},
    {"registry_id": "REG-0031", "plate": "22BH1234AA", "color": "white", "body_type": "SUV",
     "make": "Kia", "model": "Seltos", "body_style": "SUV", "owner_region": "Bharat series (Raipur, CG)"},
]

RTO = {
    "CG": [("04", "Raipur"), ("07", "Durg"), ("10", "Bilaspur"), ("13", "Raigarh"), ("15", "Ambikapur")],
    "MH": [("01", "Mumbai Central"), ("02", "Mumbai West"), ("04", "Thane"), ("12", "Pune"),
           ("14", "Pimpri-Chinchwad"), ("31", "Nagpur")],
    "KA": [("01", "Bengaluru Central"), ("03", "Bengaluru East"), ("05", "Bengaluru South"),
           ("19", "Mangaluru"), ("51", "Electronic City")],
    "DL": [(str(i), f"Delhi zone {i}") for i in range(1, 15)],
}
STATE_WEIGHTS = {"CG": 0.30, "MH": 0.25, "KA": 0.20, "DL": 0.15, "BH": 0.10}
BH_CITIES = ["Raipur, CG", "Pune, MH", "Bengaluru, KA", "New Delhi, DL", "Durg, CG", "Nagpur, MH"]

BODY_WEIGHTS = {"car": 0.40, "SUV": 0.25, "two-wheeler": 0.22, "auto-rickshaw": 0.06, "truck": 0.04, "bus": 0.03}
COLOR_WEIGHTS = {
    "default": {"white": 35, "silver": 15, "grey": 12, "black": 10, "red": 8, "blue": 8,
                "brown": 4, "green": 3, "yellow": 2, "orange": 3},
    "two-wheeler": {"black": 30, "red": 18, "blue": 14, "grey": 12, "white": 12, "silver": 6,
                    "brown": 3, "green": 2, "yellow": 1, "orange": 2},
    "auto-rickshaw": {"green": 50, "yellow": 40, "black": 10},
    "truck": {"orange": 30, "yellow": 20, "red": 15, "blue": 15, "white": 15, "green": 5},
    "bus": {"white": 30, "red": 25, "blue": 25, "orange": 15, "yellow": 5},
}
LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"   # I and O are not issued in series letters
DELHI_CATEGORY = {"car": "C", "SUV": "C", "two-wheeler": "S", "auto-rickshaw": "R", "truck": "L", "bus": "P"}


def _weighted(rng: random.Random, weights: dict[str, float]) -> str:
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys], k=1)[0]


def _plate(rng: random.Random, state: str, body: str) -> tuple[str, str]:
    num = f"{rng.randint(1, 9999):04d}"
    if state == "BH":
        yy = rng.choice(["21", "22", "23", "24", "25"])
        series = "".join(rng.choice(LETTERS) for _ in range(rng.choice([1, 2])))
        return f"{yy}BH{num}{series}", f"Bharat series ({rng.choice(BH_CITIES)})"
    code, city = rng.choice(RTO[state])
    if state == "DL":
        extra = "".join(rng.choice(LETTERS) for _ in range(rng.choice([1, 2])))
        return f"DL{code}{DELHI_CATEGORY[body]}{extra}{num}", f"{city}, DL"
    series = "".join(rng.choice(LETTERS) for _ in range(rng.choice([1, 2, 2, 2])))
    return f"{state}{code}{series}{num}", f"{city}, {state}"


def generate(n: int = 500, seed: int = SEED) -> list[dict]:
    rng = random.Random(seed)
    fixed = [dict(d) for d in DEMO_VEHICLES + DECOYS + FORMAT_EXAMPLES]
    for d in fixed:
        d.pop("image", None)
    used_ids = {d["registry_id"] for d in fixed}
    used_plates = {d["plate"] for d in fixed}
    # Keep random plates away from the demo plates so the decoys are the only near-duplicates.
    demo_prefixes = {d["plate"][:6] for d in DEMO_VEHICLES}
    models_by_body: dict[str, list[tuple[str, str, str, str]]] = {}
    for m in VEHICLE_MODELS:
        models_by_body.setdefault(m[2], []).append(m)

    records = list(fixed)
    next_id = 1
    while len(records) < n:
        while f"REG-{next_id:04d}" in used_ids:
            next_id += 1
        body = _weighted(rng, BODY_WEIGHTS)
        make, model, body_type, style = rng.choice(models_by_body[body])
        state = _weighted(rng, STATE_WEIGHTS)
        plate, region = _plate(rng, state, body_type)
        if plate in used_plates or plate[:6] in demo_prefixes or not is_valid_plate(plate):
            continue
        color = _weighted(rng, COLOR_WEIGHTS.get(body_type, COLOR_WEIGHTS["default"]))
        rid = f"REG-{next_id:04d}"
        used_ids.add(rid)
        used_plates.add(plate)
        records.append(
            {"registry_id": rid, "plate": plate, "color": color, "body_type": body_type, "make": make,
             "model": model, "body_style": style, "owner_region": region}
        )
    records.sort(key=lambda r: r["registry_id"])
    return records


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--out", type=Path, default=REGISTRY_PATH)
    args = ap.parse_args()
    recs = generate(args.n, args.seed)
    for r in recs:
        assert is_valid_plate(r["plate"]), r
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(recs, indent=2), encoding="utf-8")
    states = Counter("BH" if r["plate"][2:4] == "BH" else r["plate"][:2] for r in recs)
    bodies = Counter(r["body_type"] for r in recs)
    print(f"Wrote {len(recs)} records to {args.out}")
    print("States:", dict(sorted(states.items())))
    print("Body types:", dict(sorted(bodies.items())))


if __name__ == "__main__":
    main()
