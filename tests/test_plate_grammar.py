from hypothesis import given, settings
from hypothesis import strategies as st

from prism.plate_grammar import format_mask, is_valid_plate, pretty

CHARS = st.sampled_from(list("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?"))


@settings(max_examples=600, deadline=None)
@given(st.lists(CHARS, min_size=0, max_size=13))
def test_format_check_never_invents_or_changes(chars):
    out = format_mask(chars)
    assert len(out.chars) == len(chars)
    for before, after in zip(chars, out.chars):
        # Either untouched or turned into '?'; '?' always stays '?'.
        assert after == before or after == "?"
        if before == "?":
            assert after == "?"
    assert set(out.masked_positions) == {i for i, (a, b) in enumerate(zip(chars, out.chars)) if a != b}


def test_valid_plates_pass_untouched():
    for p in ["CG04MX4821", "MH12DE5678", "KA05MN2023", "DL3CAB1234", "DL1CA1234", "22BH1234AA", "CG4M1234"]:
        res = format_mask(list(p))
        assert "".join(res.chars) == p, p
        assert res.masked_positions == []


def test_letter_in_digit_slot_is_masked_not_replaced():
    res = format_mask(list("CG04MX482I"))
    assert "".join(res.chars) == "CG04MX482?"
    assert res.conflicts and "position 10" in res.conflicts[0]


def test_digit_in_state_slot_is_masked():
    res = format_mask(list("C604MX4821"))
    assert "".join(res.chars) == "C?04MX4821"


def test_invalid_state_code_is_masked():
    res = format_mask(list("QQ04MX4821"))
    assert "".join(res.chars) == "??04MX4821"


def test_unknown_length_is_left_alone():
    res = format_mask(list("ABC"))
    assert res.chars == list("ABC") and res.layout is None


def test_ambiguous_layout_only_masks_common_violations():
    # Length 10 fits several standard layouts and BH; '?' everywhere but one char.
    res = format_mask(list("?????????A"))
    # Position 10 is a digit in every standard 10-char layout but a letter in BH -> keep.
    assert res.chars[-1] == "A"


def test_is_valid_plate_and_pretty():
    assert is_valid_plate("CG04MX4821")
    assert is_valid_plate("22BH1234AA")
    assert not is_valid_plate("XX04MX4821")
    assert not is_valid_plate("CG04MX482")
    assert pretty("CG04MX4821") == "CG 04 MX 4821"
    assert pretty("22BH1234AA") == "22 BH 1234 AA"
