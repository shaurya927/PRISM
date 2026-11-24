from prism.config import MatchConfig, PlateConfig, TrackConfig
from prism.matcher import match
from prism.stages.plate_detect import plate_quality
from prism.track_merge import box_overlap, find_merge_groups
from tests.conftest import attr

TC, MC = TrackConfig(), MatchConfig()


def run(plates, classes=None, boxes=None, sizes=None):
    classes = classes or {t: "car" for t in plates}
    boxes = boxes or {t: {} for t in plates}
    sizes = sizes or {t: 10 for t in plates}
    return find_merge_groups(plates, classes, boxes, sizes, TC, MC)


def test_same_plate_split_ids_merge_into_biggest_track():
    # The real case: one Volvo got tracker IDs 4, 104 and 107.
    groups = run({4: "KA02?N182?", 104: "KA02MN1826", 107: "KA02MN182?", 109: "KA02MM90??"},
                 sizes={4: 315, 104: 8, 107: 9, 109: 419})
    assert groups == [(4, [104, 107], 9)]


def test_conflicting_character_never_merges():
    assert run({1: "CG04MX4821", 2: "CG04MX4851"}) == []


def test_two_wheeler_never_merges_with_car():
    assert run({1: "KA02MN1826", 2: "KA02MN1826"}, classes={1: "car", 2: "motorcycle"}) == []


def test_car_and_truck_labels_can_merge():
    assert run({1: "KA02MN1826", 2: "KA02MN1826"}, classes={1: "car", 2: "truck"}) == [(1, [2], 10)]


def test_short_text_like_a_shop_sign_never_merges():
    assert run({2: "MARKET", 44: "MARKET"}, classes={2: "motorcycle", 44: "motorcycle"}) == []


def test_too_few_agreeing_characters_never_merges():
    assert run({1: "KA02?????6", 2: "KA0?????26"}) == []


def test_two_vehicles_on_screen_together_never_merge():
    far = {1: {50: [0, 0, 100, 100]}, 2: {50: [400, 0, 500, 100]}}
    assert run({1: "KA02MN1826", 2: "KA02MN1826"}, boxes=far) == []
    nested = {1: {50: [0, 0, 200, 200]}, 2: {50: [20, 20, 120, 120]}}  # second box on the same car
    assert run({1: "KA02MN1826", 2: "KA02MN1826"}, boxes=nested) == [(1, [2], 10)]


def _moving(f0, f1, x0, dx=4, y=300, w=160, h=120):
    """Boxes of a car driving right: frame -> [x1, y1, x2, y2]."""
    return {f: [x0 + (f - f0) * dx, y, x0 + (f - f0) * dx + w, y + h] for f in range(f0, f1 + 1)}


def test_duplicate_box_on_same_car_merges_without_a_plate():
    # ByteTrack put a second, tighter box on the same car for 20 frames; neither box has a full plate.
    car = _moving(0, 40, 100)
    dup = {f: [b[0] + 12, b[1] + 15, b[2] - 10, b[3]] for f, b in car.items() if 10 <= f <= 30}
    groups = run({1: "CG04????", 2: ""}, boxes={1: car, 2: dup}, sizes={1: 41, 2: 21})
    assert groups == [(1, [2], 0)]


def test_small_far_car_inside_a_big_box_is_not_a_duplicate():
    # A far car seen through/behind a bus: inside its box, but its bottom edge is far higher.
    bus = {f: [100, 100, 700, 600] for f in range(20)}
    far = {f: [300, 200, 380, 260] for f in range(20)}
    assert run({1: "", 2: ""}, classes={1: "bus", 2: "car"}, boxes={1: bus, 2: far}) == []


def test_new_id_after_short_loss_merges():
    # Last seen at frame 30, picked up again at frame 41 (0.44 s at 25 fps) where the car was heading.
    before = _moving(0, 30, 100)
    after = _moving(41, 70, 100 + 41 * 4)
    groups = run({1: "CG04MX4821", 2: "CG0?MX????"}, boxes={1: before, 2: after}, sizes={1: 31, 2: 30})
    assert groups == [(1, [2], 5)]


def test_new_id_far_away_or_much_later_is_another_vehicle():
    before = _moving(0, 30, 100)
    far = _moving(35, 60, 900)                 # appears 800 px away
    late = _moving(80, 100, 100 + 80 * 4)      # 2 s later
    assert run({1: "", 2: ""}, boxes={1: before, 2: far}) == []
    assert run({1: "", 2: ""}, boxes={1: before, 2: late}) == []


def test_plate_conflict_blocks_box_and_handoff_merges():
    before = _moving(0, 30, 100)
    after = _moving(36, 60, 100 + 36 * 4)
    assert run({1: "CG04MX4821", 2: "CG04MX4851"}, boxes={1: before, 2: after}) == []


def test_merge_note_names_the_evidence():
    from prism.track_merge import explain_merge_groups, merge_note
    before = _moving(0, 30, 100)
    after = _moving(41, 70, 100 + 41 * 4)
    g = explain_merge_groups({1: "", 2: ""}, {1: "car", 2: "car"}, {1: before, 2: after}, {1: 31, 2: 30}, TC, MC)[0]
    assert "handoff" in g.evidence and "began 0.44 s later" in merge_note(g)


def test_dashboard_hides_unreadable_or_tiny_vehicles():
    from prism.track_merge import visibility_reason
    big = [[0, 0, 200, 150]]
    assert visibility_reason("CG04MX4821", big, TC) is None
    assert visibility_reason("??02MH7256", big, TC) is None      # partial plate, still a plate
    assert visibility_reason("KA02M9091", big, TC) is None
    assert visibility_reason("CG04??????", big, TC) is None      # 4 known characters is enough
    assert visibility_reason("", big, TC) == "no readable plate"
    assert visibility_reason("??????????", big, TC) == "no readable plate"
    assert visibility_reason("CG????????", big, TC) == "only 2 plate characters read"
    assert visibility_reason("CG04MX4821", [[0, 0, 40, 30]], TC) == "vehicle too small in frame"


def test_phone_number_on_two_trucks_is_not_plate_evidence():
    # Real read from the user's clip: the same painted number on trucks seen 30 s apart.
    assert run({123: "1134486324", 614: "1134486324"}, classes={123: "truck", 614: "truck"}) == []


def test_vehicles_parked_in_a_row_are_not_duplicate_boxes():
    a = {f: [100, 300, 260, 420] for f in range(50)}
    b = {f: [150, 300, 310, 420] for f in range(50)}   # neighbour, overlapping 69% of the smaller box
    assert run({1: "", 2: ""}, classes={1: "motorcycle", 2: "motorcycle"}, boxes={1: a, 2: b}) == []


def test_foreign_plates_are_shown():
    from prism.track_merge import visibility_reason
    big = [[0, 0, 200, 150]]
    # UK, US (California), Germany, UAE-style digits, France, partial UK read
    for plate in ("AB12CDE", "7ABC123", "BMW1234", "12345", "AB123CD", "AB12C?E"):
        assert visibility_reason(plate, big, TC) is None, plate


def test_foreign_plate_reads_keep_their_characters():
    from prism.config import OCRConfig
    from prism.masking import mask_read
    oc = OCRConfig()
    uk = mask_read("AB12 CDE", [0.95] * 8, oc)
    assert uk.masked_text == "AB12CDE" and uk.conflicts == []
    # an Indian plate is still checked: a letter in a digit slot is masked as before
    assert mask_read("CG04MX48B1", [0.95] * 10, oc).masked_text == "CG04MX48?1"


def test_foreign_plate_fuses_across_frames():
    from prism.config import FusionConfig
    from prism.fusion import ReadObservation, fuse_reads
    reads = [ReadObservation(f"F{i}", list(t), list(t), [0.95] * len(t), 400.0)
             for i, t in enumerate(["AB12CDE", "AB12CDE", "AB12C?E", "AB12CDE"])]
    assert fuse_reads(reads, FusionConfig()).text == "AB12CDE"
    # a shop sign still casts no votes
    words = [ReadObservation(f"F{i}", list("MARKET"), list("MARKET"), [0.95] * 6, 400.0) for i in range(4)]
    assert fuse_reads(words, FusionConfig()).text == ""


def test_same_foreign_plate_split_ids_merge():
    assert run({1: "AB12CDE", 2: "AB12C?E"}, sizes={1: 40, 2: 9}) == [(1, [2], 6)]


def test_shop_sign_text_is_not_a_plate():
    from prism.track_merge import visibility_reason
    big = [[0, 0, 200, 150]]
    # Real reads from the user's clip: shop signs behind the traffic.
    for sign in ("MARKET", "EDIC??", "ALCAR?", "POLICE", "PHARMACY", "SUPERMARKET", "1134486324", "134486324"):
        assert visibility_reason(sign, big, TC) == "text read is not a number plate", sign


def test_group_member_must_fit_every_member():
    # 2 fits 1 and 3, but 1 and 3 conflict at position 10: 3 stays separate.
    groups = run({1: "KA02MN1826", 2: "KA02MN182?", 3: "KA02MN1827"}, sizes={1: 30, 2: 20, 3: 10})
    assert len(groups) == 1 and 3 not in [groups[0][0], *groups[0][1]]


def test_close_up_plate_outranks_small_noisy_far_crop():
    # Real numbers from the Volvo clip: a 41 px far crop had Laplacian 31797, a 126 px close-up 16031.
    pc = PlateConfig()
    assert plate_quality(126, 16031, pc) > plate_quality(41, 31797, pc)
    # A blurry close-up is still discounted.
    assert plate_quality(126, 100, pc) < plate_quality(41, 31797, pc)


def test_box_overlap_is_relative_to_smaller_box():
    assert box_overlap([0, 0, 10, 10], [0, 0, 5, 5]) == 1.0
    assert box_overlap([0, 0, 10, 10], [20, 20, 30, 30]) == 0.0


def test_sign_text_is_not_called_a_missing_vehicle(small_registry):
    r = match("MARKET", small_registry, MC)
    assert "not in the loaded registry" not in r.explanation


def test_plate_not_in_registry_is_explained(small_registry):
    r = match("KA02MN1826", small_registry, MC, color=attr("brown"), body=attr("car"))
    assert r.status.value == "NO CONFIDENT MATCH"
    assert "not in the loaded registry" in r.explanation
    assert r.explanation.count("All 10 plate characters were read") == 1
