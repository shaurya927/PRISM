"""OCR cross-check: a second OCR model can only turn committed characters into '?'."""

from hypothesis import given, settings
from hypothesis import strategies as st

from prism.config import OCRConfig
from prism.fusion import ReadObservation, fuse_reads
from prism.masking import char_reads, cross_check, mask_read
from prism.config import FusionConfig
from prism.plate_grammar import UNKNOWN

VETO = OCRConfig(cross_check_mode="veto", cross_check_veto_conf=0.50)
AGREE = OCRConfig(cross_check_mode="agree", cross_check_veto_conf=0.50, cross_check_keep_conf=0.98)


def _read(text="CG04MX4821", conf=0.95, cfg=VETO):
    return mask_read(text, [conf] * len(text), cfg)


def test_agreement_keeps_every_character():
    m = cross_check(_read(), "CG04MX4821", [0.9] * 10, VETO, "fpo")
    assert m.masked_text == "CG04MX4821"
    assert m.check_chars == list("CG04MX4821")


def test_confident_disagreement_is_masked_with_reason():
    m = cross_check(_read(), "CG04MX4B21", [0.9] * 10, VETO, "fpo")
    assert m.masked_text == "CG04MX4?21"
    assert m.reasons[7] == "ocr_disagreement"
    assert any("position 8" in c and "fpo read 'B'" in c for c in m.conflicts)
    cr = char_reads(m)[7]
    assert cr.char == UNKNOWN and cr.raw_char == "8" and cr.check_char == "B" and cr.check_conf == 0.9


def test_unsure_disagreement_does_not_veto():
    m = cross_check(_read(), "CG04MX4B21", [0.9] * 7 + [0.3] + [0.9] * 2, VETO, "fpo")
    assert m.masked_text == "CG04MX4821"


def test_second_model_missing_a_character_is_aligned():
    # the second model dropped the last character: everything else still lines up
    m = cross_check(_read(), "CG04MX482", [0.9] * 9, VETO, "fpo")
    assert m.masked_text == "CG04MX4821"
    assert m.check_chars[-1] is None


def test_agree_mode_needs_confirmation_unless_very_confident():
    m = mask_read("CG04MX4821", [0.95] * 9 + [0.99], AGREE)
    out = cross_check(m, "CG04MX48", [0.9] * 8, AGREE, "fpo")
    # positions 9-10 were not confirmed: position 9 (0.95) is masked, position 10 (0.99 >= 0.98) is kept
    assert out.masked_text == "CG04MX48?1"


def test_unalignable_second_read_vetoes_nothing_in_veto_mode():
    m = cross_check(_read(), "AB", [0.99, 0.99], VETO, "fpo")
    assert m.masked_text == "CG04MX4821"
    assert any("too different in length" in c for c in m.conflicts)


def test_unalignable_second_read_confirms_nothing_in_agree_mode():
    m = cross_check(_read(cfg=AGREE), "AB", [0.99, 0.99], AGREE, "fpo")
    assert m.masked_text == UNKNOWN * 10


def test_masked_characters_cast_no_fusion_votes():
    reads = []
    for i in range(4):
        m = cross_check(_read(), "CG04MX4B21", [0.9] * 10, VETO, "fpo")
        reads.append(ReadObservation(f"F{i}", m.chars, m.raw_chars, m.raw_confs, 150.0))
    fused = fuse_reads(reads, FusionConfig())
    assert fused.text == "CG04MX4?21"


PLATE_CHARS = st.sampled_from(list("ABCDGHKMNX0123456789"))


@settings(max_examples=300, deadline=None)
@given(
    primary=st.lists(PLATE_CHARS, min_size=1, max_size=12),
    pconf=st.lists(st.floats(0, 1), min_size=12, max_size=12),
    second=st.lists(PLATE_CHARS, min_size=0, max_size=13),
    sconf=st.lists(st.floats(0, 1), min_size=13, max_size=13),
    agree=st.booleans(),
)
def test_cross_check_never_invents_or_changes(primary, pconf, second, sconf, agree):
    cfg = AGREE if agree else VETO
    text = "".join(primary)
    before = mask_read(text, pconf[: len(text)], cfg)
    kept = list(before.chars)
    after = cross_check(mask_read(text, pconf[: len(text)], cfg), "".join(second), sconf[: len(second)], cfg, "fpo")
    assert len(after.chars) == len(kept)
    for b, a in zip(kept, after.chars):
        assert a == b or a == UNKNOWN
