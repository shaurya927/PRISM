from hypothesis import given, settings
from hypothesis import strategies as st

from prism.config import FusionConfig, OCRConfig
from prism.fusion import ReadObservation, align, fuse_reads, merge_hint, normalize_hint
from prism.masking import mask_read

FC = FusionConfig()
OC = OCRConfig()


def obs(rid, text, confs, sharp=120.0):
    m = mask_read(text, confs, OC)
    return ReadObservation(rid, m.chars, m.raw_chars, m.raw_confs, sharp)


def raw_obs(rid, chars, confs, sharp=120.0):
    """Observation built directly (bypasses format masking)."""
    return ReadObservation(rid, list(chars), list(chars), list(confs), sharp)


def test_single_sharp_confident_frame_is_enough():
    f = fuse_reads([obs("F1", "CG04MX4821", [0.95] * 10, sharp=150)], FC)
    assert f.text == "CG04MX4821"


def test_single_blurry_frame_is_not_enough():
    # 0.95 * 50/100 = 0.475 < 0.9
    f = fuse_reads([obs("F1", "CG04MX4821", [0.95] * 10, sharp=50)], FC)
    assert f.text == "?" * 10


def test_several_weak_frames_add_up():
    reads = [obs(f"F{i}", "CG04MX4821", [0.9] * 10, sharp=50) for i in range(3)]
    f = fuse_reads(reads, FC)  # 3 * 0.45 = 1.35
    assert f.text == "CG04MX4821"


def test_disagreement_8_vs_B_stays_unknown():
    a = raw_obs("F1", "CG04MX4821", [0.95] * 10, sharp=150)
    b_chars = list("CG04MX4821")
    b_chars[7] = "B"
    b = raw_obs("F2", b_chars, [0.95] * 10, sharp=150)
    f = fuse_reads([a, b], FC)
    assert f.text[7] == "?"
    pos = f.positions[7]
    assert set(pos.votes) == {"8", "B"}
    assert "F1" in pos.supporting or "F2" in pos.supporting
    assert pos.note and "share" in pos.note


def test_clear_majority_wins_the_share_test():
    reads = [raw_obs(f"F{i}", "CG04MX4821", [0.95] * 10, 150) for i in range(4)]
    odd = list("CG04MX4821")
    odd[7] = "B"
    reads.append(raw_obs("F9", odd, [0.95] * 10, 150))
    f = fuse_reads(reads, FC)
    assert f.text[7] == "8"
    assert f.positions[7].dissenting == ["F9"]
    assert abs(f.positions[7].confidence - 0.8) < 1e-6


def test_sharpness_weight_is_capped():
    # One extremely sharp B (cap 2.0 * 0.95 = 1.9) vs two ordinary 8s (2 * 0.95 * 1.2 = 2.28)
    a = raw_obs("F1", "CG04MX4B21", [0.95] * 10, sharp=5000)
    b = raw_obs("F2", "CG04MX4821", [0.95] * 10, sharp=120)
    c = raw_obs("F3", "CG04MX4821", [0.95] * 10, sharp=120)
    f = fuse_reads([a, b, c], FC)
    assert f.positions[7].votes["B"] == 1.9
    assert f.text[7] == "?"  # share 2.28/4.18 = 0.55 < 0.60


def test_alignment_handles_lost_first_character():
    mapping = align(list("G04MX4821"), list("CG04MX4821"))
    assert mapping[0] is None and mapping[1] == 0 and mapping[-1] == 8
    reads = [obs("F1", "CG04MX4821", [0.95] * 10, 150), obs("F2", "CG04MX4821", [0.95] * 10, 150),
             obs("F3", "G04MX4821", [0.95] * 9, 150)]
    f = fuse_reads(reads, FC)
    assert f.length == 10 and f.text == "CG04MX4821"
    assert f.positions[1].votes["G"] > 2.5  # all three frames vote for G at position 2


def test_few_confident_hallucinations_among_many_low_confidence_reads_stay_unknown():
    """A half-hidden '2' read as '8' confidently in 4 of 20 reads (rest below 0.70) must stay '?'."""
    reads = []
    for i in range(16):
        confs = [0.99] * 10
        confs[8] = 0.45
        reads.append(obs(f"F{i}", "CG04MX4881", confs, 300))
    for i in range(16, 20):
        confs = [0.99] * 10
        confs[8] = 0.85
        reads.append(obs(f"F{i}", "CG04MX4881", confs, 300))
    f = fuse_reads(reads, FC)
    assert f.text == "CG04MX48?1"
    assert "4 of 20" in f.positions[8].note
    # A second camera that reads the position clearly is judged on its own reads.
    cam_b = []
    for i in range(3):
        o = obs(f"BF{i}", "CG04MX4821", [0.99] * 10, 300)
        cam_b.append(o)
    f2 = fuse_reads(reads[:16] + cam_b, FC)
    assert f2.positions[8].char == "2"
    # Disabling the guard shows it is what blocks the hallucination.
    from prism.config import FusionConfig as FCfg

    assert fuse_reads(reads, FCfg(vote_min_consistency=0.0)).text == "CG04MX4881"


def test_truncated_reads_do_not_set_plate_length():
    reads = [obs(f"F{i}", "CG", [0.95, 0.95], 150) for i in range(6)]
    reads += [obs(f"G{i}", "CG04MX4821", [0.95] * 10, 150) for i in range(2)]
    f = fuse_reads(reads, FC)
    assert f.length == 10 and f.text == "CG04MX4821"
    assert set(f.excluded_reads) == {f"F{i}" for i in range(6)}


def test_non_plate_reads_cast_no_votes():
    """Scene-text words read off a blurry plate ('BLUEBONTOTO') must not produce characters."""
    from prism.fusion import ReadObservation as RO
    from prism.masking import mask_read as mr

    def full(rid, text):
        m = mr(text, [0.95] * len(text), OC)
        return RO(rid, m.chars, m.raw_chars, m.raw_confs, 150, sum(1 for x in m.reasons if x == "format"))

    reads = [full("F1", "BLUEBONTOTO"), full("F2", "BLUEBONTOTO"), full("F3", "WATER")]
    f = fuse_reads(reads, FC)
    assert f.text.replace("?", "") == ""
    assert set(f.excluded_reads) >= {"F1", "F2", "F3"}


def test_unknown_positions_carry_no_weight():
    f = fuse_reads([obs("F1", "CG04MX4821", [0.95, 0.95, 0.95, 0.95, 0.3, 0.95, 0.95, 0.95, 0.3, 0.95], 150)], FC)
    assert f.text == "CG04?X48?1"
    assert f.positions[4].votes == {}


def test_empty_input():
    f = fuse_reads([], FC)
    assert f.text == "" and f.length == 0


# ---------------------------------------------------------------- property test
plate_chars = st.sampled_from(list("CGMHKADL0123456789XBN"))
read_strategy = st.tuples(
    st.lists(plate_chars, min_size=8, max_size=11),
    st.lists(st.floats(min_value=0.0, max_value=1.0), min_size=11, max_size=11),
    st.floats(min_value=0.0, max_value=400.0),
)


@settings(max_examples=300, deadline=None)
@given(st.lists(read_strategy, min_size=1, max_size=8))
def test_every_fused_char_was_read_confidently_in_a_real_frame(reads):
    observations = []
    raw_lookup = {}
    for i, (chars, confs, sharp) in enumerate(reads):
        text = "".join(chars)
        o = obs(f"F{i}", text, confs[: len(text)], sharp)
        observations.append(o)
        raw_lookup[o.read_id] = o
    fused = fuse_reads(observations, FC)
    for pos in fused.positions:
        if pos.char == "?":
            continue
        assert pos.source == "video"
        # Some real read has this char at this aligned position with confidence >= 0.70.
        support = [c for c in pos.cells if c.char == pos.char and c.raw_conf >= OC.char_conf]
        assert support, (pos, fused.text)
        o = raw_lookup[support[0].read_id]
        assert pos.char in o.chars
        # Both vote conditions held.
        assert pos.weight >= FC.vote_min_weight - 1e-9
        assert pos.weight / pos.total_weight >= FC.vote_min_share - 1e-9


# ---------------------------------------------------------------- hints
def test_hint_fills_unknown_and_is_labelled():
    f = fuse_reads([obs("F1", "CG04MX4821", [0.95, 0.95, 0.95, 0.95, 0.3, 0.95, 0.95, 0.95, 0.3, 0.95], 150)], FC)
    m = merge_hint(f, "CG04M???2?")
    assert m.text == "CG04MX4821"[:4] + "M" + "X48" + "2" + "1"
    assert m.positions[4].source == "investigator-supplied"
    assert m.positions[8].source == "investigator-supplied"
    assert m.positions[0].source == "video+hint"
    assert m.video_text == "CG04?X48?1"


def test_hint_conflict_becomes_unknown():
    f = fuse_reads([obs("F1", "CG04MX4821", [0.95] * 10, 150)], FC)
    m = merge_hint(f, "CG07??????")
    assert m.text[3] == "?"
    assert m.positions[3].source == "conflict"
    assert m.hint_conflicts and "position 4" in m.hint_conflicts[0]


def test_hint_only_plate():
    m = merge_hint(fuse_reads([], FC), "cg04-??48??")
    assert m.text == "CG04??48??"
    assert all(p.source in ("investigator-supplied", "unknown") for p in m.positions)


def test_normalize_hint():
    assert normalize_hint(" cg 04 *x48_1 ") == "CG04?X48?1"
    assert normalize_hint("") is None
