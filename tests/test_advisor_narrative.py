from prism import narrative
from prism.config import PrismConfig, with_overrides
from prism.narrative import build_evidence, check_sentence, summarize
from prism.schemas import MatchStatus
from tests.helpers import frame_read, make_case, night_frames


def test_advisor_names_separating_position_and_lead_frame(small_registry):
    case = make_case(small_registry, night_frames())
    t = case.tracks[0]
    assert t.fused.text == "CG04?X48?1"
    assert t.match.status == MatchStatus.AMBIGUOUS
    adv = t.advisor
    assert adv.needed and adv.position == 4
    assert {adv.candidate_chars["REG-0001"], adv.candidate_chars["REG-0002"]} == {"M", "N"}
    assert adv.lead_frame_idx == 57 and adv.lead_char == "M" and abs(adv.lead_conf - 0.62) < 1e-9
    assert "lead, not evidence" in adv.text


def test_advisor_never_changes_scores(small_registry):
    case = make_case(small_registry, night_frames())
    before = [c.score for c in case.tracks[0].match.top_candidates]
    from prism.advisor import advise

    cfg = PrismConfig()
    advise(case.tracks[0].fused, case.tracks[0].match, cfg.match, cfg.ocr)
    assert [c.score for c in case.tracks[0].match.top_candidates] == before


def test_advisor_not_needed_when_matched(small_registry):
    frames = [frame_read(i, "CG04MX4821", [0.95] * 10, 150) for i in (10, 20)]
    case = make_case(small_registry, frames)
    assert case.tracks[0].match.status == MatchStatus.MATCHED
    assert not case.tracks[0].advisor.needed


def test_template_summary_passes_its_own_check(small_registry):
    cfg = PrismConfig()
    for frames in (night_frames(), [frame_read(i, "CG04MX4821", [0.95] * 10, 150) for i in (10, 20)]):
        case = make_case(small_registry, frames)
        n = summarize(case, cfg)
        assert n.method == "template"
        assert n.removed == 0, [s for s in n.sentences if not s.passed]
        assert n.checked >= 2
        assert "CG04?X48?1" in n.text or "CG04MX4821" in n.text


def test_verifier_rejects_unsupported_claims(small_registry):
    cfg = PrismConfig()
    case = make_case(small_registry, night_frames())
    ev = build_evidence(case, cfg)
    assert check_sentence("The plate is `CG04?X48?1` [F42].", ev) == []
    assert any("no evidence citation" in p for p in check_sentence("The plate is `CG04?X48?1`.", ev))
    # A registry candidate's plate is part of the result data, so naming it is supported.
    assert check_sentence("Candidate REG-0001 has plate `CG04MX4821` [REG-0001].", ev) == []
    assert any("plate" in p for p in check_sentence("The plate is `CG04ZZ4821` [F42].", ev))
    assert any("REG-0999" in p for p in check_sentence("REG-0999 is the owner [F42].", ev))
    assert any("frame 99" in p for p in check_sentence("Frame 99 shows it clearly [F42].", ev))
    assert any("number 0.97" in p for p in check_sentence("It scored 0.97 [REG-0001].", ev))
    assert any("unknown citation" in p for p in check_sentence("It was seen [F999].", ev))


def test_llm_output_with_one_bad_sentence_is_filtered(small_registry, monkeypatch):
    cfg = with_overrides(PrismConfig(), narrative={"backend": "ollama"})
    case = make_case(small_registry, night_frames())
    good = "Track 4 showed `CG04?X48?1` [F42]. REG-0001 and REG-0002 tie at position 5 [POS-5]."
    monkeypatch.setattr(narrative, "ollama_summary", lambda c, n: good + " The car belongs to REG-0777 [REG-0777].")
    n = summarize(case, cfg)
    assert n.method.startswith("ollama:")
    assert n.removed == 1 and "REG-0777" not in n.text


def test_llm_output_with_two_bad_sentences_falls_back(small_registry, monkeypatch):
    cfg = with_overrides(PrismConfig(), narrative={"backend": "ollama"})
    case = make_case(small_registry, night_frames())
    monkeypatch.setattr(narrative, "ollama_summary",
                        lambda c, n: "The plate is CG04MX4821 [F42]. It scored 0.99 [REG-0001]. Owner is known.")
    n = summarize(case, cfg)
    assert "template" in n.method and n.removed == 0


def test_ollama_unavailable_falls_back(small_registry, monkeypatch):
    cfg = with_overrides(PrismConfig(), narrative={"backend": "ollama", "ollama_url": "http://127.0.0.1:9", "ollama_timeout_s": 0.5})
    case = make_case(small_registry, night_frames())
    n = summarize(case, cfg)
    assert n.method == "template (Ollama unavailable)"
