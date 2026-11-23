"""Generate the synthetic Indian vehicle registry (data/registry.json).

* Up to 50,000 records, fixed seed, all owner data synthetic.
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
    # --- Northern India ---
    "DL": [(str(i), f"Delhi zone {i}") for i in range(1, 15)],
    "UP": [("14", "Ghaziabad"), ("15", "Meerut"), ("16", "Noida"), ("32", "Lucknow"),
           ("65", "Varanasi"), ("70", "Allahabad"), ("78", "Kanpur"), ("80", "Agra"),
           ("81", "Mathura"), ("25", "Bareilly")],
    "HR": [("01", "Ambala"), ("02", "Hisar"), ("03", "Panchkula"), ("06", "Rohtak"),
           ("26", "Gurugram"), ("29", "Faridabad"), ("38", "Karnal"), ("51", "Panipat")],
    "PB": [("01", "Amritsar"), ("02", "Jalandhar"), ("03", "Patiala"), ("05", "Bathinda"),
           ("10", "Ludhiana"), ("11", "Mohali"), ("13", "Chandigarh Road")],
    "RJ": [("01", "Ajmer"), ("02", "Alwar"), ("09", "Bikaner"), ("14", "Jaipur"),
           ("19", "Jodhpur"), ("25", "Udaipur"), ("27", "Sikar"), ("45", "Kota")],
    "HP": [("01", "Shimla"), ("02", "Mandi"), ("03", "Kangra"), ("05", "Kullu"),
           ("07", "Una")],
    "UK": [("01", "Dehradun"), ("02", "Almora"), ("04", "Haridwar"), ("07", "Nainital"),
           ("13", "Mussoorie")],
    "JK": [("01", "Srinagar"), ("02", "Jammu"), ("03", "Anantnag"), ("08", "Kathua")],
    "CH": [("01", "Chandigarh"), ("02", "Chandigarh"), ("03", "Chandigarh")],
    "LA": [("01", "Leh"), ("02", "Kargil")],
    # --- Western India ---
    "MH": [("01", "Mumbai Central"), ("02", "Mumbai West"), ("03", "Mumbai East"),
           ("04", "Thane"), ("05", "Kalyan"), ("06", "Raigad"), ("12", "Pune"),
           ("14", "Pimpri-Chinchwad"), ("20", "Aurangabad"), ("31", "Nagpur"),
           ("43", "Nashik"), ("46", "Kolhapur"), ("47", "Satara"), ("48", "Solapur")],
    "GJ": [("01", "Ahmedabad"), ("02", "Mehsana"), ("05", "Surat"), ("06", "Vadodara"),
           ("10", "Jamnagar"), ("11", "Junagadh"), ("15", "Rajkot"), ("18", "Gandhinagar"),
           ("27", "Anand")],
    "GA": [("01", "North Goa"), ("02", "South Goa"), ("03", "Mapusa"), ("04", "Ponda"),
           ("05", "Margao"), ("06", "Vasco"), ("07", "Bicholim"), ("08", "Panaji")],
    "DD": [("01", "Daman"), ("02", "Diu"), ("03", "Silvassa")],
    # --- Central India ---
    "MP": [("01", "Bhopal"), ("04", "Gwalior"), ("07", "Indore"), ("09", "Jabalpur"),
           ("10", "Rewa"), ("13", "Ujjain"), ("20", "Sagar"), ("50", "Satna")],
    "CG": [("04", "Raipur"), ("07", "Durg"), ("10", "Bilaspur"), ("13", "Raigarh"),
           ("15", "Ambikapur"), ("17", "Korba"), ("18", "Jagdalpur")],
    # --- Southern India ---
    "KA": [("01", "Bengaluru Central"), ("02", "Bengaluru West"), ("03", "Bengaluru East"),
           ("04", "Bengaluru North"), ("05", "Bengaluru South"), ("09", "Mysuru"),
           ("10", "Belgaum"), ("19", "Mangaluru"), ("34", "Dharwad"), ("41", "Davangere"),
           ("50", "Tumkur"), ("51", "Electronic City"), ("53", "Hosur Road")],
    "TN": [("01", "Chennai Central"), ("02", "Chennai West"), ("03", "Chennai South"),
           ("04", "Chennai North"), ("06", "Chengalpattu"), ("07", "Vellore"),
           ("09", "Salem"), ("10", "Erode"), ("11", "Tiruppur"), ("14", "Madurai"),
           ("18", "Tiruchirapalli"), ("20", "Coimbatore"), ("22", "Thanjavur"),
           ("33", "Cuddalore"), ("37", "Krishnagiri"), ("38", "Dharmapuri"),
           ("39", "Namakkal"), ("45", "Virudhunagar"), ("66", "Tirunelveli")],
    "KL": [("01", "Thiruvananthapuram"), ("02", "Kollam"), ("04", "Alappuzha"),
           ("07", "Kottayam"), ("09", "Ernakulam"), ("11", "Palakkad"),
           ("14", "Malappuram"), ("16", "Kozhikode"), ("20", "Kannur"),
           ("58", "Thrissur")],
    "AP": [("05", "Anantapur"), ("09", "Guntur"), ("11", "Kadapa"), ("16", "Nellore"),
           ("28", "Visakhapatnam"), ("31", "Vijayawada"), ("37", "Tirupati"),
           ("39", "Rajahmundry")],
    "TS": [("02", "Hyderabad East"), ("03", "Hyderabad West"), ("04", "Hyderabad South"),
           ("07", "Secunderabad"), ("08", "Medchal"), ("09", "Ranga Reddy"),
           ("11", "Warangal"), ("13", "Karimnagar"), ("14", "Nizamabad"),
           ("22", "Nalgonda"), ("28", "Khammam"), ("29", "Mahbubnagar")],
    "PY": [("01", "Puducherry"), ("02", "Karaikal"), ("05", "Yanam")],
    # --- Eastern India ---
    "WB": [("01", "Kolkata North"), ("02", "Kolkata South"), ("06", "Howrah"),
           ("14", "Siliguri"), ("18", "Asansol"), ("23", "Durgapur"),
           ("26", "Haldia"), ("31", "Barrackpore"), ("74", "Burdwan")],
    "BR": [("01", "Patna"), ("02", "Gaya"), ("06", "Muzaffarpur"), ("09", "Bhagalpur"),
           ("19", "Darbhanga"), ("21", "Purnia"), ("24", "Ara"), ("31", "Saharsa")],
    "JH": [("01", "Ranchi"), ("02", "Dhanbad"), ("04", "Jamshedpur"), ("05", "Bokaro"),
           ("10", "Hazaribagh"), ("14", "Deoghar")],
    "OD": [("02", "Bhubaneswar"), ("05", "Cuttack"), ("06", "Berhampur"),
           ("08", "Rourkela"), ("13", "Sambalpur"), ("19", "Balasore")],
    "AN": [("01", "Port Blair")],
    # --- North-Eastern India ---
    "AS": [("01", "Guwahati"), ("02", "Nagaon"), ("03", "Jorhat"), ("04", "Silchar"),
           ("06", "Tinsukia"), ("09", "Dibrugarh"), ("12", "Tezpur")],
    "NL": [("01", "Kohima"), ("02", "Dimapur"), ("04", "Mokokchung")],
    "MN": [("01", "Imphal East"), ("02", "Imphal West")],
    "ML": [("02", "Shillong"), ("04", "Jowai"), ("06", "Tura")],
    "MZ": [("01", "Aizawl"), ("02", "Lunglei"), ("04", "Champhai")],
    "TR": [("01", "Agartala"), ("02", "Udaipur")],
    "AR": [("01", "Itanagar"), ("02", "Tawang"), ("06", "Pasighat")],
    "SK": [("01", "Gangtok"), ("02", "Namchi"), ("04", "Mangan")],
    "DN": [("01", "Silvassa")],
    "LD": [("01", "Kavaratti")],
}

# Weights reflect realistic Indian traffic distribution
STATE_WEIGHTS = {
    # Metros & high-density states
    "UP": 0.12, "MH": 0.11, "DL": 0.08, "KA": 0.07, "TN": 0.07,
    "GJ": 0.06, "RJ": 0.05, "WB": 0.04, "TS": 0.04, "AP": 0.03,
    "KL": 0.03, "MP": 0.03, "HR": 0.03, "PB": 0.02, "BR": 0.02,
    # Chhattisgarh (project origin state — overweighted for demo clips)
    "CG": 0.04,
    # Medium-density
    "JH": 0.02, "OD": 0.015, "UK": 0.015, "HP": 0.01,
    "AS": 0.01, "JK": 0.01, "CH": 0.005, "GA": 0.005,
    # Bharat series
    "BH": 0.04,
    # Low-density (NE, islands, UTs)
    "NL": 0.003, "MN": 0.003, "ML": 0.003, "MZ": 0.002,
    "TR": 0.003, "AR": 0.002, "SK": 0.002, "AN": 0.002,
    "PY": 0.003, "DD": 0.002, "DN": 0.001, "LD": 0.001, "LA": 0.001,
}

BH_CITIES = [
    "Raipur, CG", "Pune, MH", "Bengaluru, KA", "New Delhi, DL", "Durg, CG",
    "Nagpur, MH", "Hyderabad, TS", "Chennai, TN", "Ahmedabad, GJ", "Lucknow, UP",
    "Jaipur, RJ", "Kolkata, WB", "Chandigarh, CH", "Kochi, KL", "Guwahati, AS",
    "Bhopal, MP", "Patna, BR", "Noida, UP", "Gurugram, HR", "Coimbatore, TN",
]

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
        while f"REG-{next_id:05d}" in used_ids:
            next_id += 1
        body = _weighted(rng, BODY_WEIGHTS)
        make, model, body_type, style = rng.choice(models_by_body[body])
        state = _weighted(rng, STATE_WEIGHTS)
        plate, region = _plate(rng, state, body_type)
        if plate in used_plates or plate[:6] in demo_prefixes or not is_valid_plate(plate):
            continue
        color = _weighted(rng, COLOR_WEIGHTS.get(body_type, COLOR_WEIGHTS["default"]))
        rid = f"REG-{next_id:05d}"
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
    ap.add_argument("--n", type=int, default=50000)
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
