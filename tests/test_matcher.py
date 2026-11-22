import json

from hypothesis import given, settings
from hypothesis import strategies as st

from prism.config import REGISTRY_PATH, MatchConfig
from prism.matcher import coverage_factor, match, plate_similarity, score_candidate, specificity
from prism.schemas import MatchStatus, RegistryRecord
from tests.conftest import attr, rec

MC = MatchConfig()


def test_exact_match_full_score(small_registry):
    r = match("CG04MX4821", small_registry, MC, attr("white"), attr("car"))
    top = r.top_candidates[0]
    assert top.registry_id == "REG-0001"
    assert abs(top.score - 1.0) < 1e-9
    assert r.status == MatchStatus.MATCHED
    assert len(r.top_candidates) == 5


def test_score_breakdown_adds_up(small_registry):
    r = match("CG04?X48?1", small_registry, MC, attr("white"), attr("car"))
    for c in r.top_candidates:
        b = c.breakdown
        assert abs(b.plate + b.color + b.body + b.make_model - b.raw_total) < 1e-3


def test_ambiguous_when_candidates_differ_only_at_unknown_position(small_registry):
    r = match("CG04?X48?1", small_registry, MC, attr("white"), attr("car"))
    ids = [c.registry_id for c in r.top_candidates[:2]]
    assert set(ids) == {"REG-0001", "REG-0002"}
    assert r.status == MatchStatus.AMBIGUOUS
    assert r.gap is not None and r.gap < 0.05


def test_no_plate_chars_is_capped_and_never_matches(small_registry):
    r = match("??????????", small_registry, MC, attr("white"), attr("car"))
    assert all(c.score <= 0.45 + 1e-9 for c in r.top_candidates)
    assert r.status == MatchStatus.NO_CONFIDENT_MATCH
    assert "capped" in r.explanation


def test_fewer_than_three_known_chars_cannot_match():
    # Two known chars, perfect attributes: 0.65*(2/6) + 0.35 = 0.567 >= tau, still no match.
    reg = [rec("REG-0001", "CG04MX4821"), rec("REG-0002", "MH12DE5678", color="black", body="SUV")]
    r = match("CG????????", reg, MC, attr("white"), attr("car"), tau=0.55)
    assert r.top_candidates[0].score >= 0.55
    assert r.status == MatchStatus.NO_CONFIDENT_MATCH
    assert "at least 3 known characters" in r.explanation


def test_make_model_cannot_lift_over_threshold_alone():
    reg = [rec("REG-0001", "CG04MX4821", make="Hyundai", model="Verna")]
    # 6 known of 10 with 4 matching -> plate 0.65 * 4/6 = 0.433; + body 0.15 = 0.583 ... pick tau above it
    pv = "CG04??????"  # 4 known -> coverage 4/6, sim 1 -> 0.433; + color 0.2 = 0.633
    mm = attr("Hyundai Verna", 0.8)
    s_no, *_ = score_candidate(pv, reg[0], attr("white"), None, None, MC, tau=0.66)
    s_mm, bd, reasons, *_ = score_candidate(pv, reg[0], attr("white"), None, mm, MC, tau=0.66)
    assert s_no < 0.66 <= s_no + 0.05
    assert s_mm < 0.66
    assert bd.capped and "make/model" in bd.capped
    r = match(pv, reg, MC, attr("white"), None, mm, tau=0.66)
    assert r.status == MatchStatus.NO_CONFIDENT_MATCH


def test_make_model_breaks_ties_when_above_threshold():
    reg = [rec("REG-0002", "CG04NX4821", model="City", make="Honda"), rec("REG-0001", "CG04MX4821", model="Verna")]
    # Body unknown: 0.65 + 0.20 = 0.85 for both; the make/model bonus gives REG-0001 0.90.
    r = match("CG04?X4821", reg, MC, attr("white"), None, attr("Hyundai Verna", 0.7))
    assert r.top_candidates[0].registry_id == "REG-0001"
    assert r.top_candidates[0].breakdown.make_model == 0.05
    assert r.status == MatchStatus.MATCHED  # gap exactly 0.05


def test_make_model_orders_saturated_scores():
    reg = [rec("REG-0002", "CG04NX4821", model="City", make="Honda"), rec("REG-0001", "CG04MX4821", model="Verna")]
    r = match("CG04?X4821", reg, MC, attr("white"), attr("car"), attr("Hyundai Verna", 0.7))
    assert r.top_candidates[0].registry_id == "REG-0001"
    # Both scores clip to 1.00, so PRISM still refuses to separate them.
    assert r.status == MatchStatus.AMBIGUOUS


def test_uncertain_make_model_ignored():
    reg = [rec("REG-0001", "CG04MX4821")]
    s, bd, *_ = score_candidate("CG04MX4821", reg[0], attr("white"), attr("car"), attr("Hyundai Verna", 0.45),
                                MC, tau=0.55)
    assert bd.make_model == 0.0


def test_shift_tolerance_for_lost_first_char():
    ps = plate_similarity("G04MX4821", "CG04MX4821", MC)
    assert ps.shift == 1
    assert abs(ps.sim - 0.95) < 1e-9


def test_unshifted_wins_ties():
    ps = plate_similarity("CG04MX4821", "CG04MX4821", MC)
    assert ps.shift == 0 and ps.sim == 1.0


def test_length_difference_over_one_scores_zero():
    assert plate_similarity("CG04MX4821", "CG4M1234", MC).sim == 0.0


def test_confusable_credit():
    ps = plate_similarity("CG04MX4B21", "CG04MX4821", MC)
    assert abs(ps.sim - (9 + 0.35) / 10) < 1e-9
    assert ps.confusable == [(7, "B", "8")]
    for a, b in [("0", "O"), ("1", "I"), ("8", "B"), ("5", "S"), ("2", "Z"), ("6", "G"), ("4", "A")]:
        assert abs(plate_similarity(a * 6, b * 6, MC).sim - 0.35) < 1e-9


def test_coverage_factor():
    assert coverage_factor(3, MC) == 0.5
    assert coverage_factor(6, MC) == 1.0
    assert coverage_factor(9, MC) == 1.0


def test_low_light_shifts_weights():
    reg = [rec("REG-0001", "CG04MX4821")]
    _, bd, reasons, *_ = score_candidate("CG04MX4821", reg[0], attr("white"), attr("car"), None, MC, 0.55, True)
    assert bd.w_plate == 0.75 and bd.w_color == 0.10
    assert any("Low-light" in r for r in reasons)


def test_adjacent_colours_get_half_credit():
    reg = [rec("REG-0001", "CG04MX4821", color="grey")]
    _, bd, *_ = score_candidate("CG04MX4821", reg[0], attr("silver"), attr("car"), None, MC, 0.55)
    assert bd.color_sim == 0.5
    _, bd, *_ = score_candidate("CG04MX4821", rec("R", "CG04MX4821", color="black"), attr("grey"), None, None,
                                MC, 0.55, low_light=True)
    assert bd.color_sim == 0.5


def test_uncertain_attributes_add_nothing():
    reg = [rec("REG-0001", "CG04MX4821")]
    _, bd, *_ = score_candidate("CG04MX4821", reg[0], attr("white", 0.3, True), attr("car", 0.3, True), None, MC, .55)
    assert bd.color == 0 and bd.body == 0


def test_mismatch_is_listed_and_blocks_match():
    reg = [rec("REG-0004", "CG04MX4827"), rec("REG-0099", "MH12DE5678", color="black", body="SUV")]
    r = match("CG04MX4821", reg, MC, attr("white"), attr("car"))
    top = r.top_candidates[0]
    assert top.registry_id == "REG-0004"
    assert any("position 10" in m for m in top.mismatches)
    assert r.status == MatchStatus.NO_CONFIDENT_MATCH


def test_specificity_count(small_registry):
    # CG04MX4821, CG04NX4821 and CG04HX4821 all fit.
    assert specificity("CG04?X4821", small_registry) == 3
    assert specificity("CG04MX4821", small_registry) == 1


def test_threshold_change_changes_status(small_registry):
    r1 = match("CG04MX4821", small_registry, MC, attr("white"), attr("car"), tau=0.55)
    r2 = match("CG04MX4821", small_registry, MC, attr("white"), attr("car"), tau=1.01 - 0.0)
    assert r1.status == MatchStatus.MATCHED
    assert r2.status == MatchStatus.NO_CONFIDENT_MATCH


def test_false_match_with_true_vehicle_removed():
    """The registry decoys must not be MATCHED when the true vehicle is absent."""
    reg = [RegistryRecord(**r) for r in json.loads(REGISTRY_PATH.read_text())]
    for true_id, plate, color, body in [("REG-0001", "CG04MX4821", "white", "car"),
                                        ("REG-0010", "MH12DE5678", "black", "SUV"),
                                        ("REG-0020", "KA05MN2023", "blue", "car")]:
        without = [r for r in reg if r.registry_id != true_id]
        with_true = match(plate, reg, MC, attr(color), attr(body))
        assert with_true.status == MatchStatus.MATCHED and with_true.top_candidates[0].registry_id == true_id
        r = match(plate, without, MC, attr(color), attr(body))
        assert r.status != MatchStatus.MATCHED, (plate, r.top_candidates[0])


@settings(max_examples=200, deadline=None)
@given(
    st.text(alphabet="CGMHKA0123456789X?", min_size=0, max_size=11),
    st.sampled_from(["white", "black", "silver", "grey"]),
    st.booleans(),
)
def test_scores_are_bounded_and_guardrails_hold(pv, color, low_light):
    reg = [rec("REG-0001", "CG04MX4821"), rec("REG-0002", "MH12DE5678", color="black"),
           rec("REG-0003", "KA05MN2023", color="grey")]
    r = match(pv, reg, MC, attr(color), attr("car"), attr("Hyundai Verna", 0.9), low_light=low_light)
    K = sum(1 for c in pv if c != "?")
    for c in r.top_candidates:
        assert 0.0 <= c.score <= 1.0
        if K == 0:
            assert c.score <= MC.no_plate_cap + 1e-9
    if K < 3:
        assert r.status == MatchStatus.NO_CONFIDENT_MATCH
    # Candidates without plate contradictions come first; each group is sorted by score.
    keyed = [(any(m.startswith("Mismatch at position") for m in c.mismatches), -c.score) for c in r.top_candidates]
    assert keyed == sorted(keyed)
