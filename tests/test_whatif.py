"""Counterfactual what-if simulator: exact ranking, guardrails, stability and the API."""

import json
import random

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from prism.config import REGISTRY_PATH, MatchConfig, PrismConfig
from prism.matcher import match
from prism.schemas import MatchStatus, RegistryRecord, WhatIfRequest
from prism.whatif import (
    CONTENDERS,
    WhatIfError,
    _Attrs,
    _PlateScorer,
    _rank,
    registry_index,
    run_whatif,
)
from tests.conftest import attr, rec
from tests.helpers import make_case, night_frames

MC = MatchConfig()


_FULL = tuple(RegistryRecord(**r) for r in json.loads(REGISTRY_PATH.read_text()))


@pytest.fixture(scope="module")
def full_registry():
    return _FULL


def _ranked(res):
    return [(c.registry_id, c.score) for c in res.top_candidates]


# ------------------------------------------------------------------ exactness
@settings(max_examples=15, deadline=None)  # each example scores the full 50,000-record registry twice
@given(
    st.text(alphabet="CGMHKADL0123456789XB?", min_size=8, max_size=11),
    st.sampled_from(["white", "black", "silver", None]),
    st.sampled_from(["car", "SUV", None]),
    st.booleans(),
)
def test_pooled_ranking_equals_full_registry_match(pv, color, body, low_light):
    """The contender pool must never change ranks, scores, status or explanation."""
    reg = _FULL
    c = attr(color) if color else None
    b = attr(body) if body else None
    full = match(pv, reg, MC, c, b, None, 0.55, low_light)
    pooled = _rank(registry_index(reg), _PlateScorer(registry_index(reg), len(pv), MC), pv,
                   _Attrs(c, b, None, MC), 0.55, low_light, [])
    assert _ranked(pooled) == _ranked(full)
    assert pooled.status == full.status and pooled.explanation == full.explanation
    assert pooled.specificity == full.specificity and pooled.registry_size == full.registry_size


def test_no_assumptions_reproduces_the_case(small_registry):
    case = make_case(small_registry, night_frames())
    r = run_whatif(case, WhatIfRequest(), small_registry)
    assert r.hypothetical and r.plate == case.tracks[0].fused.text
    assert _ranked(r.match) == _ranked(case.tracks[0].match)
    assert r.match.status == case.tracks[0].match.status
    assert not r.leader_changed and not r.status_changed


def test_whatif_never_changes_the_case(small_registry):
    case = make_case(small_registry, night_frames())
    before = case.model_dump_json()
    run_whatif(case, WhatIfRequest(slots={4: "N", 8: "2"}, color="sodium", threshold=0.7), small_registry)
    assert case.model_dump_json() == before


# ------------------------------------------------------------------ hypotheses
def test_filling_an_unread_slot_resolves_the_tie(small_registry):
    case = make_case(small_registry, night_frames())  # CG04?X48?1 -> AMBIGUOUS
    assert case.tracks[0].match.status == MatchStatus.AMBIGUOUS
    r = run_whatif(case, WhatIfRequest(slots={4: "M", 8: "2"}), small_registry)
    assert r.plate == "CG04MX4821"
    assert r.positions[4].source == "hypothesis" and r.positions[0].source == "video"
    assert r.match.status == MatchStatus.MATCHED and r.match.top_candidates[0].registry_id == "REG-0001"
    assert r.status_changed and any("Position 5 assumed 'M'" in a for a in r.assumptions)


def test_hypothesis_can_hand_the_lead_to_another_record(small_registry):
    case = make_case(small_registry, night_frames())
    r = run_whatif(case, WhatIfRequest(slots={4: "N", 8: "2"}), small_registry)
    assert r.match.top_candidates[0].registry_id == "REG-0002"
    assert r.leader_changed


def test_confusable_flip_and_unreadable(small_registry):
    case = make_case(small_registry, night_frames())
    flip = run_whatif(case, WhatIfRequest(slots={6: "B"}), small_registry)  # 4 at position 7 read as B
    assert flip.plate[6] == "B" and flip.positions[6].video_char == "4"
    blank = run_whatif(case, WhatIfRequest(slots={0: "?"}), small_registry)
    assert blank.plate[0] == "?" and blank.match.known_count == case.tracks[0].match.known_count - 1


def test_colour_assumptions(small_registry):
    # Video reads silver; REG-0004 is silver, REG-0001 white. Sodium lighting makes white/silver alike.
    reg = [rec("REG-0001", "CG04MX4821", color="white"), rec("REG-0004", "CG04MX4827", color="silver")]
    case = make_case(reg, night_frames(), color="silver")
    recorded = run_whatif(case, WhatIfRequest(slots={4: "M"}), reg)
    sodium = run_whatif(case, WhatIfRequest(slots={4: "M"}, color="sodium"), reg)
    ignored = run_whatif(case, WhatIfRequest(slots={4: "M"}, color="ignore"), reg)
    by = lambda r: {c.registry_id: c for c in r.match.top_candidates}  # noqa: E731
    assert by(recorded)["REG-0001"].breakdown.color_sim == 0.5          # white/silver already adjacent
    assert by(ignored)["REG-0001"].breakdown.color == 0 and by(ignored)["REG-0004"].breakdown.color == 0
    assert all(c.breakdown.color_sim > 0 for c in sodium.match.top_candidates)
    assumed = run_whatif(case, WhatIfRequest(color="white"), reg)
    assert by(assumed)["REG-0001"].breakdown.color_sim == 1.0
    assert any("sodium" in a for a in sodium.assumptions)


def test_threshold_assumption(small_registry):
    case = make_case(small_registry, night_frames())
    r = run_whatif(case, WhatIfRequest(slots={4: "M", 8: "2"}, threshold=0.99), small_registry)
    assert r.match.threshold_used == 0.99
    assert any("Threshold" in a for a in r.assumptions)


def test_invalid_hypotheses_are_refused(small_registry):
    case = make_case(small_registry, night_frames())
    for bad in [WhatIfRequest(slots={12: "A"}), WhatIfRequest(slots={2: "AB"}), WhatIfRequest(slots={2: "#"}),
                WhatIfRequest(color="purple"), WhatIfRequest(body_type="boat"), WhatIfRequest(track_id=99)]:
        with pytest.raises(WhatIfError):
            run_whatif(case, bad, small_registry)


# ------------------------------------------------------------------ stability matrix
def test_stability_matrix_finds_the_pivotal_slots(small_registry):
    case = make_case(small_registry, night_frames())
    s = run_whatif(case, WhatIfRequest(), small_registry).stability
    assert s.n_scenarios == s.n_combinations and not s.sampled
    assert 0.0 <= s.leader_share <= 1.0 and 0.0 <= s.tie_share <= 1.0
    assert abs(s.leader_share + s.tie_share + sum(w.share for w in s.win_shares if w.registry_id != s.leader_id)
               - 1.0) < 1e-3
    axes = {a.index: a for a in s.axes if a.kind == "position"}
    assert {4, 8} <= set(axes)                      # both unread slots are varied
    assert axes[4].pivotal                           # 'N' at position 5 hands #1 to REG-0002
    assert any(c.value == "N" and c.leader_id == "REG-0002" for c in axes[4].cells)
    for a in s.axes:                                 # every cell counted, every scenario in every axis
        assert sum(c.n for c in a.cells) == s.n_scenarios
    assert "%" in s.text


def test_pinned_slots_are_not_perturbed(small_registry):
    case = make_case(small_registry, night_frames())
    s = run_whatif(case, WhatIfRequest(slots={4: "M", 8: "2"}), small_registry).stability
    assert not any(a.index in (4, 8) for a in s.axes if a.kind == "position")
    assert s.leader_id == "REG-0001" and s.leader_share == 1.0


def test_perturbations_respect_the_plate_layout(small_registry):
    """A slot only takes characters an Indian layout allows there (no '6' for the state letter 'G')."""
    case = make_case(small_registry, night_frames())
    s = run_whatif(case, WhatIfRequest(), small_registry).stability
    by = {a.index: {c.value for c in a.cells} for a in s.axes if a.kind == "position"}
    assert 1 not in by                               # G in CG has no allowed look-alike
    assert all(v == "?" or v.isdigit() for v in by.get(8, {"?"}))  # the last digit block stays digits


def test_sampling_is_capped_and_deterministic(small_registry, monkeypatch):
    from prism import whatif

    monkeypatch.setattr(whatif, "MAX_SCENARIOS", 8)
    case = make_case(small_registry, night_frames())
    a = run_whatif(case, WhatIfRequest(), small_registry).stability
    b = run_whatif(case, WhatIfRequest(), small_registry).stability
    assert a.sampled and a.n_scenarios == 8 and a.n_combinations > 8
    assert a.model_dump() == b.model_dump()


# ------------------------------------------------------------------ differential justification
def test_differential_names_substitutions_and_body_mismatch():
    reg = [rec("REG-0001", "CG04MX4821"),
           rec("REG-0009", "CG04MX4357", body="SUV", make="Hyundai", model="Creta")]
    case = make_case(reg, night_frames())
    r = run_whatif(case, WhatIfRequest(slots={4: "M", 8: "2"}), reg)
    d = r.differentials[0]
    assert d.leader_id == "REG-0001" and d.rival_id == "REG-0009" and d.gap > 0
    total = sum(c.delta for c in d.components)
    assert abs(total - (d.leader_score - d.rival_score)) < 0.02  # components explain the gap (score clipping aside)
    assert "substitution" in d.text and "body type differs" in d.text and "points" in d.text
    assert len(d.substitutions) >= 2


def test_differential_explains_a_tie(small_registry):
    case = make_case(small_registry, night_frames())
    d = run_whatif(case, WhatIfRequest(), small_registry).differentials[0]
    assert d.gap == 0 and "score the same" in d.text and "unknown position" in d.text


# ------------------------------------------------------------------ full registry and API
def test_full_registry_runs_fast_and_exactly(full_registry):
    case = make_case(list(full_registry), night_frames())
    r = run_whatif(case, WhatIfRequest(), full_registry)
    assert r.match.registry_size == len(full_registry)
    assert r.contenders == CONTENDERS
    assert r.elapsed_ms < 15000
    full = match(r.plate, full_registry, MC, case.tracks[0].attributes.color, case.tracks[0].attributes.body_type,
                 case.tracks[0].attributes.make_model, case.threshold)
    assert _ranked(r.match) == _ranked(full)


def test_api_whatif(client_registry):
    client = client_registry
    r = client.post("/api/search", json={"hint": "CG04MX48??", "color": "white", "body_type": "car"})
    job = r.json()["case_id"]
    w = client.post(f"/api/jobs/{job}/whatif", json={"slots": {"8": "2", "9": "1"}})
    assert w.status_code == 200, w.text
    body = w.json()
    assert body["hypothetical"] is True and body["plate"] == "CG04MX4821"
    assert body["match"]["top_candidates"][0]["registry_id"] == "REG-0001"
    assert "stability" in body and body["differentials"]
    assert client.post(f"/api/jobs/{job}/whatif", json={"slots": {"30": "A"}}).status_code == 422
    assert client.post("/api/jobs/nope/whatif", json={}).status_code == 404
    # read-only: the stored case is unchanged
    assert client.get(f"/api/jobs/{job}").json()["result"]["tracks"][0]["fused"]["text"] == "CG04MX48??"
    client.delete(f"/api/jobs/{job}")


@pytest.fixture
def client_registry():
    from fastapi.testclient import TestClient

    from backend.app.main import app

    return TestClient(app)


def test_random_hypotheses_keep_guardrails(small_registry):
    """Whatever is assumed, scores stay in [0, 1] and fewer than 3 known characters never MATCH."""
    rng = random.Random(7)
    case = make_case(small_registry, night_frames())
    for _ in range(25):
        slots = {k: rng.choice("?0123456789ABCMNXZ") for k in rng.sample(range(10), rng.randint(0, 6))}
        r = run_whatif(case, WhatIfRequest(slots=slots, color=rng.choice([None, "ignore", "sodium", "red"])),
                       small_registry)
        for c in r.match.top_candidates:
            assert 0.0 <= c.score <= 1.0
        if r.match.known_count < PrismConfig().match.min_known_for_match:
            assert r.match.status != MatchStatus.MATCHED
