"""Layout-constrained decoding: the Bayesian Indian plate grammar over the OCR model's own probabilities."""

import dataclasses

from hypothesis import given, settings
from hypothesis import strategies as st

from prism.config import FusionConfig, OCRConfig
from prism.fusion import fuse_reads
from prism.layout_decode import layout_decode
from prism.masking import char_reads, mask_read, observation
from prism.plate_grammar import ALNUM, is_valid_plate

OC = OCRConfig()
FC = FusionConfig()


def point(text, conf=0.97):
    return [{c: conf} for c in text]


def night_b(b=0.62, eight=0.31):
    """CG0?MX4821 where the OCR read 'B' at position 4 and ranked '8' second."""
    d = point("CG0") + [{"B": b, "8": eight, "3": 0.03}] + point("MX4821")
    confs = [0.97, 0.97, 0.97, b] + [0.97] * 6
    return "CG0BMX4821", confs, d


# ------------------------------------------------------------------ the decision rule
def test_ruled_out_character_becomes_the_models_alternative():
    text, confs, d = night_b()
    m = mask_read(text, confs, OC, d)
    assert m.masked_text == "CG08MX4821"
    assert m.reasons[3] == "layout" and m.layout_from[3] == "B"
    assert m.model_probs[3] == 0.31 and m.layout_probs[3] >= OC.char_conf
    assert any("layout-constrained read '8'" in c for c in m.conflicts)
    cr = char_reads(m)[3]
    assert cr.char == "8" and cr.raw_char == "B" and cr.layout_from == "B" and cr.alts["8"] == 0.31


def test_alternative_the_model_barely_offered_is_not_written():
    text, confs, d = night_b(b=0.62, eight=0.04)
    m = mask_read(text, confs, OC, d)
    assert m.masked_text == "CG0?MX4821" and m.reasons[3] != "layout"


def test_confident_ruled_out_character_is_replaced_or_masked_never_kept():
    # B at 0.90 survives the count-based format check (two layouts, one violation each); the model's
    # probabilities rule out the single-digit-RTO layout (RTO 0 does not exist).
    text, confs, d = night_b(b=0.90, eight=0.04)
    confs = [0.97, 0.97, 0.97, 0.90] + [0.97] * 6
    without = mask_read(text, confs, OC)
    assert without.masked_text == "CG0BMX4821"           # the old behaviour kept a wrong 'B'
    m = mask_read(text, confs, OC, d)
    assert m.masked_text == "CG0?MX4821" and m.reasons[3] == "format"
    d[3] = {"B": 0.60, "8": 0.35}
    assert mask_read(text, confs, OC, d).masked_text == "CG08MX4821"


def test_read_breaking_the_layout_in_several_places_is_only_masked():
    # Two ruled-out characters (B in the RTO, 8 in the series): too unreliable to re-decide either.
    d = point("CG0") + [{"B": 0.62, "8": 0.31}] + [{"8": 0.6, "B": 0.38}] + point("X4821")
    confs = [0.97] * 3 + [0.62, 0.6] + [0.97] * 5
    m = mask_read("CG0B8X4821", confs, OC, d)
    assert "layout" not in m.reasons and m.masked_text[3:5] == "??"
    two = dataclasses.replace(OC, layout_max_ruled_out=2)
    assert mask_read("CG0B8X4821", confs, two, d).masked_text == "CG08BX4821"


def test_state_code_is_decoded_as_a_pair():
    d = [{"C": 0.97}, {"6": 0.70, "G": 0.25, "0": 0.02}] + point("04MX4821")
    m = mask_read("C604MX4821", [0.97, 0.70] + [0.97] * 8, OC, d)
    assert m.masked_text == "CG04MX4821" and m.layout_from[1] == "6"
    # 'O' then 'G' is no state code, so '0'->'O' cannot rescue "0G": it stays unknown.
    d = [{"0": 0.6, "O": 0.3, "C": 0.08}, {"G": 0.97}] + point("04MX4821")
    assert mask_read("0G04MX4821", [0.6, 0.97] + [0.97] * 8, OC, d).masked_text == "?G04MX4821"


def test_series_and_number_slots():
    d = point("MH12DE") + [{"S": 0.55, "5": 0.40}] + point("678")
    assert mask_read("MH12DES678", [0.97] * 6 + [0.55] + [0.97] * 3, OC, d).masked_text == "MH12DE5678"
    d = point("KA05M") + [{"8": 0.6, "B": 0.38}] + point("2023")  # digit read in the series slot
    assert mask_read("KA05M82023", [0.97] * 5 + [0.6] + [0.97] * 4, OC, d).masked_text == "KA05MB2023"


def test_valid_plates_are_never_changed():
    for p in ["CG04MX4821", "MH12DE5678", "KA05MN2023", "DL3CAB1234", "DL1CA1234", "22BH1234AA", "CG4M1234"]:
        d = [{c: 0.9, ("8" if c == "B" else "B"): 0.09} for c in p]
        m = mask_read(p, [0.9] * len(p), OC, d)
        assert m.masked_text == p, (p, m.conflicts)
        assert all(r != "layout" for r in m.reasons)


def test_without_distributions_behaviour_is_unchanged():
    for text in ["CG0BMX4821", "C604MX4821", "CG04MX482I"]:
        a = mask_read(text, [0.95] * 10, OC)
        b = mask_read(text, [0.95] * 10, OC, [None] * 10)
        assert a.masked_text == b.masked_text and a.reasons == b.reasons


def test_can_be_switched_off():
    text, confs, d = night_b()
    off = dataclasses.replace(OC, layout_decode=False)
    assert mask_read(text, confs, off, d).masked_text == "CG0?MX4821"


def test_single_digit_rto_cannot_be_zero():
    assert is_valid_plate("DL3CAB1234") and not is_valid_plate("DL0CAB1234")


# ------------------------------------------------------------------ property: what it may write
PLATE = st.sampled_from(["CG04MX4821", "MH12DE5678", "KA05MN2023", "DL3CAB1234", "22BH1234AA", "CG4M1234",
                         "TN09BX0042", "UP16AB1234"])
CH = st.sampled_from(list("0123456789ABCDEGHIMNOSXZ"))


@settings(max_examples=400, deadline=None)
@given(PLATE, st.lists(st.tuples(CH, st.floats(0.05, 0.99), CH, st.floats(0.0, 0.6)), min_size=11, max_size=11))
def test_decoder_only_writes_the_models_own_alternatives(plate, noise):
    text, confs, dists = [], [], []
    for (c, p, alt, q), true in zip(noise, plate):
        top = c if p > 0.5 else true
        d = {top: p}
        if alt != top:
            d[alt] = min(q, 1 - p)
        text.append(top)
        confs.append(p)
        dists.append(d)
    raw = "".join(text)
    base = mask_read(raw, confs, OC)
    m = mask_read(raw, confs, OC, dists)
    assert len(m.chars) == len(base.chars)
    for k, (b, a) in enumerate(zip(base.chars, m.chars)):
        if a == b:
            continue
        if a == "?":
            continue  # only masking is ever added on top of the old result
        # a written character: offered by the model, labelled, and above both bars
        assert m.reasons[k] == "layout" and m.layout_from[k] == raw[k]
        assert dists[k].get(a, 0.0) >= OC.layout_min_model_prob - 1e-9
        assert m.layout_probs[k] >= OC.char_conf - 1e-9
        assert a in ALNUM and a != raw[k]
    # a character the old masking kept, and the layouts allow, is never changed
    for k, (b, a) in enumerate(zip(base.chars, m.chars)):
        if b != "?" and a not in ("?", b):
            assert m.reasons[k] == "layout"


@settings(max_examples=200, deadline=None)
@given(PLATE)
def test_decoder_is_a_no_op_on_clean_reads(plate):
    m = mask_read(plate, [0.95] * len(plate), OC, point(plate, 0.95))
    assert m.masked_text == plate


# ------------------------------------------------------------------ fusion
def test_one_layout_constrained_frame_is_not_enough():
    text, confs, d = night_b()
    o = observation("F1", mask_read(text, confs, OC, d), 150)
    f = fuse_reads([o], FC)
    assert f.positions[3].char == "?"            # 0.31 * 1.5 = 0.47 < 0.9
    cell = f.positions[3].cells[0]
    assert cell.layout and cell.char == "8" and abs(cell.weight - 0.31 * 1.5) < 1e-3


def test_several_layout_constrained_frames_fuse_and_are_labelled():
    obs = []
    for i in range(3):
        text, confs, d = night_b()
        obs.append(observation(f"F{i}", mask_read(text, confs, OC, d), 150))
    f = fuse_reads(obs, FC)
    assert f.text == "CG08MX4821"
    p = f.positions[3]
    assert p.layout_supporting == ["F0", "F1", "F2"] and "layout-constrained" in p.note
    assert all(c.layout for c in p.cells)


def test_a_disagreeing_direct_read_still_outvotes():
    obs = []
    for i in range(2):
        text, confs, d = night_b()
        obs.append(observation(f"L{i}", mask_read(text, confs, OC, d), 150))
    for i in range(3):  # three clear frames of a real '3'
        obs.append(observation(f"D{i}", mask_read("CG03MX4821", [0.95] * 10, OC, point("CG03MX4821", 0.95)), 150))
    assert fuse_reads(obs, FC).text == "CG03MX4821"


def test_layout_decode_reports_the_layout_posterior():
    text, confs, d = night_b()
    dec = layout_decode(list(text), confs, list(mask_read(text, confs, OC).chars), d, OC)
    assert dec.layout_posterior and abs(sum(dec.layout_posterior.values()) - 1.0) < 0.05
    assert dec.accepted and dec.accepted[0].char == "8"


# ------------------------------------------------------------------ what-if uses the model's alternatives
def test_whatif_tries_the_models_second_choices_first(small_registry):
    from prism.schemas import WhatIfRequest
    from prism.whatif import run_whatif
    from tests.helpers import make_case, night_frames

    case = make_case(small_registry, night_frames())
    t = case.tracks[0]
    for fr in t.frames:  # the model ranked 'H' second at position 5 in every frame
        fr.chars[4].alts = {"M": 0.40, "H": 0.35}
    s = run_whatif(case, WhatIfRequest(), small_registry).stability
    ax = next(a for a in s.axes if a.index == 4)
    assert [c.value for c in ax.cells][:3] == ["?", "M", "H"]
