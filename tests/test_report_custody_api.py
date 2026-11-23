import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from prism.config import PrismConfig, config_hash, with_overrides
from prism import custody
from prism.custody import CustodyLog, sha256_file, vendor_commits
from prism.report import evidence_strip_png, html_to_pdf, render_html, write_report
from prism.reid import body_compatible, implied_speed_kmh, link_tracks, plate_compatible
from prism.schemas import AttributeValue
from tests.helpers import make_case, night_frames


# ------------------------------------------------------------------ custody
def test_sha256_and_custody_log(tmp_path):
    p = tmp_path / "a.png"
    p.write_bytes(b"hello")
    assert sha256_file(p) == hashlib.sha256(b"hello").hexdigest()
    log = CustodyLog(tmp_path, "/artifacts/case")
    url = log.record(p, "plate_crop_raw")
    assert url == "/artifacts/case/a.png"
    assert log.items()[0].sha256 == hashlib.sha256(b"hello").hexdigest()


def test_config_hash_changes_with_thresholds():
    a = PrismConfig()
    assert config_hash(a) == config_hash(PrismConfig())
    assert config_hash(a) != config_hash(with_overrides(a, match={"tau": 0.6}))


def test_vendor_commits_reported():
    c = vendor_commits()
    assert set(c) == {"fast-alpr", "parseq", "lpsr-lacd", "vehicle-reidentification"}


def test_prism_commit_falls_back_to_env_without_git(monkeypatch, tmp_path):
    # Docker images ship without .git; the build passes the commit in PRISM_GIT_COMMIT.
    monkeypatch.setattr(custody, "ROOT", tmp_path)
    monkeypatch.setenv("PRISM_GIT_COMMIT", "abc1234")
    assert custody.prism_commit() == "abc1234"
    monkeypatch.delenv("PRISM_GIT_COMMIT")
    assert custody.prism_commit() is None


# ------------------------------------------------------------------ report
def test_report_html_contains_required_sections(small_registry, tmp_path):
    case = make_case(small_registry, night_frames())
    html = render_html(case, tmp_path)
    for needle in ["Chain of custody", "Frames used", "Scoring breakdown", "Advisor", "Limitations",
                   "Evidence-checked summary", case.custody.config_hash, "REG-0001", "REG-0002",
                   "does not identify a vehicle on its own", "Plate evidence strip", "AMBIGUOUS",
                   '<span class="q">?</span>', "F57", "0.62"]:
        assert needle in html, needle
    path, fmt = write_report(case, "html", tmp_path / "out", runs_dir=tmp_path)
    assert fmt == "html" and path.exists() and path.stat().st_size > 5000


def test_evidence_strip_png(small_registry):
    case = make_case(small_registry, night_frames())
    png = evidence_strip_png(case.tracks[0].fused)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_pdf_export_or_clean_fallback(small_registry, tmp_path):
    case = make_case(small_registry, night_frames())
    path, fmt = write_report(case, "pdf", tmp_path / "out", runs_dir=tmp_path)
    assert path.exists()
    if fmt == "pdf":
        assert path.read_bytes()[:4] == b"%PDF"
    else:
        assert path.suffix == ".html"


# ------------------------------------------------------------------ re-id helpers
def test_plate_compatibility():
    from prism.config import MatchConfig

    mc = MatchConfig()
    assert plate_compatible("CG04?X48?1", "?G04MX48?1", mc)[0]
    assert plate_compatible("CG04MX4821", "CG04MX4B21", mc)[0]  # 8/B mix-up tolerated
    assert not plate_compatible("CG04MX4821", "MH12DE5678", mc)[0]
    assert plate_compatible("", "CG04MX4821", mc)[0]


def test_body_and_speed():
    car = AttributeValue(value="car", confidence=0.8)
    suv = AttributeValue(value="SUV", confidence=0.8)
    unsure = AttributeValue(value="uncertain", confidence=0.3, uncertain=True, top2=[("SUV", 0.3), ("car", 0.28)])
    assert body_compatible(car, car) and not body_compatible(car, suv) and body_compatible(car, unsure)
    assert implied_speed_kmh(1.0, 60) == 60.0 and implied_speed_kmh(None, 10) is None


def test_link_requires_appearance_and_plate_and_body():
    import numpy as np
    from prism.config import MatchConfig

    e = np.ones(4) / 2
    car = AttributeValue(value="car", confidence=0.8)
    pairs = link_tracks({1: e}, {2: e}, {1: "CG04MX4821"}, {2: "MH12DE5678"}, {1: car}, {2: car}, 0.82, MatchConfig())
    assert pairs[0]["similarity"] == 1.0 and not pairs[0]["same_vehicle"]  # appearance alone never links
    pairs = link_tracks({1: e}, {2: e}, {1: "CG04?X4821"}, {2: "CG04MX48?1"}, {1: car}, {2: car}, 0.82, MatchConfig())
    assert pairs[0]["same_vehicle"]
    # Two unread plates never link, however similar the appearance.
    pairs = link_tracks({1: e}, {2: e}, {1: ""}, {2: ""}, {1: car}, {2: car}, 0.82, MatchConfig())
    assert not pairs[0]["same_vehicle"] and "appearance alone" in pairs[0]["plate_note"]


def test_combined_evidence_upgrades_ambiguous(small_registry):
    """Camera B reads position 5, which camera A could not: AMBIGUOUS -> MATCHED."""
    from prism.pipeline import _score_pairs
    from prism.schemas import CrossCamPair, CrossCamResult, MatchStatus
    from tests.helpers import frame_read

    case = make_case(small_registry, night_frames())
    assert case.tracks[0].match.status == MatchStatus.AMBIGUOUS
    b_frames = [frame_read(i, "CG04MX4821", [0.3] + [0.95] * 7 + [0.2, 0.95], 150) for i in (5, 9)]
    case_b = make_case(small_registry, b_frames)
    tb = case_b.tracks[0]
    tb.track_id, tb.clip_role = 2, "B"
    for f in tb.frames:
        f.read_id = "B" + f.read_id
    case.crosscam = CrossCamResult(encoder="test", threshold=0.82, tracks_b=[tb], pairs=[
        CrossCamPair(track_a=4, track_b=2, similarity=0.9, threshold=0.82, plate_compatible=True, plate_note="",
                     body_match=True, same_vehicle=True)])
    _score_pairs(case, small_registry, PrismConfig(), None)
    p = case.crosscam.pairs[0]
    assert p.combined.text[4] == "M"
    assert p.status_before == MatchStatus.AMBIGUOUS and p.status_after == MatchStatus.MATCHED and p.upgraded
    assert p.combined_match.top_candidates[0].registry_id == "REG-0001"


# ------------------------------------------------------------------ API
@pytest.fixture(scope="module")
def client():
    from backend.app.main import app

    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    # the bundled registry size changes when it is regenerated, so compare with the file itself
    from prism.registry import load_registry

    assert body["status"] == "ok" and body["device"] in ("cpu", "cuda")
    assert body["registry_size"] == len(load_registry()) > 0


def test_search_rescore_and_report(client):
    r = client.post("/api/search", json={"hint": "CG04MX4821", "color": "white", "body_type": "car"})
    assert r.status_code == 200, r.text
    case = r.json()
    t = case["tracks"][0]
    assert t["match"]["status"] == "MATCHED"
    assert t["match"]["top_candidates"][0]["registry_id"] == "REG-0001"
    assert abs(t["match"]["top_candidates"][0]["score"] - 1.0) < 1e-6
    assert all(p["source"] == "investigator-supplied" for p in t["fused"]["positions"])
    job = case["case_id"]
    r = client.get(f"/api/report/{job}?format=html")
    assert r.status_code == 200 and "Chain of custody" in r.text
    assert client.get(f"/api/jobs/{job}").json()["status"] == "done"
    assert client.delete(f"/api/jobs/{job}").status_code == 200


def test_threshold_slider_rescore(client):
    # Colour reads grey (no credit vs blue): REG-0020 scores 0.65 + 0.15 = 0.80.
    r = client.post("/api/search", json={"hint": "KA05MN2023", "color": "grey", "body_type": "car"})
    case = r.json()
    m = case["tracks"][0]["match"]
    assert m["status"] == "MATCHED" and abs(m["top_candidates"][0]["score"] - 0.80) < 1e-6
    r = client.post(f"/api/jobs/{case['case_id']}/rescore", json={"threshold": 0.85})
    m = r.json()["tracks"][0]["match"]
    assert r.status_code == 200 and m["status"] == "NO CONFIDENT MATCH" and m["threshold_used"] == 0.85
    client.delete(f"/api/jobs/{case['case_id']}")


def test_contradicting_decoy_never_outranks_true_vehicle(client):
    # Decoy REG-0004 (CG04MX4827) is silver. When the colour reads silver it scores higher than
    # REG-0001 (0.94 vs 0.90), but it contradicts a confidently read character, so it is ranked
    # below REG-0001 and is not counted as a rival for the ambiguity gap.
    r = client.post("/api/search", json={"hint": "CG04MX4821", "color": "silver", "body_type": "car"})
    m = r.json()["tracks"][0]["match"]
    assert m["top_candidates"][0]["registry_id"] == "REG-0001"
    assert m["status"] == "MATCHED" and "REG-0004" in m["explanation"]
    ids = [c["registry_id"] for c in m["top_candidates"]]
    assert ids.index("REG-0004") > 0
    client.delete(f"/api/jobs/{r.json()['case_id']}")


def test_search_partial_hint_is_ambiguous_or_no_match(client):
    r = client.post("/api/search", json={"hint": "CG04??48??", "color": "white", "body_type": "car"})
    assert r.status_code == 200
    assert r.json()["tracks"][0]["match"]["status"] in ("AMBIGUOUS", "NO CONFIDENT MATCH")
    client.delete(f"/api/jobs/{r.json()['case_id']}")


def test_search_validation(client):
    assert client.post("/api/search", json={"hint": "CG04", "color": "purple"}).status_code == 422


def test_upload_rejects_non_video(client):
    r = client.post("/api/jobs", files={"file": ("notes.txt", b"hi", "text/plain")})
    assert r.status_code == 400


def test_artifact_traversal_blocked(client):
    # Encoded traversal reaches the handler and is refused.
    assert client.get("/artifacts/..%2F..%2Fdata%2Fregistry.json").status_code == 404
    assert client.get("/artifacts/..%2Fjob.json").status_code == 404
    # A literal '..' is normalised by the client before routing; it must never serve registry data.
    r = client.get("/artifacts/../data/registry.json")
    assert "REG-0001" not in r.text
    assert client.get("/artifacts/nope/x.png").status_code == 404


def test_unknown_job_404(client):
    assert client.get("/api/jobs/doesnotexist").status_code == 404
