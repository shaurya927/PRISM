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
