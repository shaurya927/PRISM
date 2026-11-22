from prism.config import OCRConfig
from prism.masking import mask_read

CFG = OCRConfig()


def test_low_confidence_becomes_unknown():
    r = mask_read("CG04MX4821", [0.99, 0.98, 0.95, 0.9, 0.62, 0.9, 0.9, 0.9, 0.69, 0.9], CFG)
    assert r.masked_text == "CG04?X48?1"
    assert r.reasons[4] == "low_confidence" and r.reasons[8] == "low_confidence"


def test_threshold_is_inclusive():
    r = mask_read("CG04MX4821", [0.70] * 10, CFG)
    assert r.masked_text == "CG04MX4821"


def test_non_alphanumeric_becomes_unknown():
    r = mask_read("CG04M#4821", [0.99] * 10, CFG)
    assert r.masked_text == "CG04M?4821"
    assert r.reasons[5] == "non_alphanumeric"


def test_lowercase_is_uppercased_not_changed():
    r = mask_read("cg04mx4821", [0.99] * 10, CFG)
    assert r.masked_text == "CG04MX4821"


def test_separators_are_dropped_with_their_confidences():
    r = mask_read("CG 04-MX 4821", [0.99, 0.99, 0.1, 0.99, 0.99, 0.1, 0.99, 0.99, 0.1, 0.99, 0.99, 0.99, 0.99], CFG)
    assert r.masked_text == "CG04MX4821"
    assert len(r.raw_confs) == 10


def test_format_masking_applies_after_confidence():
    r = mask_read("CG04MX482I", [0.99] * 10, CFG)
    assert r.masked_text == "CG04MX482?"
    assert r.reasons[9] == "format"
    assert r.conflicts


def test_missing_confidences_are_treated_as_zero():
    r = mask_read("CG04MX4821", [0.99] * 8, CFG)
    assert r.masked_text == "CG04MX48??"
    assert any("confidences" in c for c in r.conflicts)
