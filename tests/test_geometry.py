from src.geometry import Dimensions, media_geometry


def test_center_crop_16_9_to_square():
    r = media_geometry(Dimensions(1920, 1080), Dimensions(1080, 1080))
    assert r['crop'] == {'x': 420, 'y': 0, 'width': 1080, 'height': 1080}
    assert r['deterministic'] is True


def test_contain_16_9_to_square():
    r = media_geometry(Dimensions(1920, 1080), Dimensions(1080, 1080), mode='contain')
    assert r['scaled_dimensions'] == {'width': 1080, 'height': 608}
    assert r['padding']['top'] == 236
    assert r['padding']['bottom'] == 236


def test_ratio_reduction():
    r = media_geometry(Dimensions(3840, 2160), Dimensions(1280, 720))
    assert r['source_aspect_ratio'] == '16:9'
    assert r['target_aspect_ratio'] == '16:9'
    assert r['crop'] == {'x': 0, 'y': 0, 'width': 1280, 'height': 720}
