from __future__ import annotations
from dataclasses import dataclass, asdict
from math import gcd
from typing import Literal

Mode = Literal['crop', 'contain']

@dataclass(frozen=True)
class Dimensions:
    width: int
    height: int


def _validate(d: Dimensions) -> None:
    if not isinstance(d.width, int) or not isinstance(d.height, int):
        raise TypeError('width and height must be integers')
    if d.width <= 0 or d.height <= 0:
        raise ValueError('width and height must be positive')


def reduce_ratio(width: int, height: int) -> tuple[int, int]:
    if width <= 0 or height <= 0:
        raise ValueError('dimensions must be positive')
    g = gcd(width, height)
    return width // g, height // g


def media_geometry(source: Dimensions, target: Dimensions, mode: Mode = 'crop', anchor: Literal['center', 'top-left'] = 'center') -> dict:
    _validate(source)
    _validate(target)
    if mode not in ('crop', 'contain'):
        raise ValueError('mode must be crop or contain')
    if anchor not in ('center', 'top-left'):
        raise ValueError('anchor must be center or top-left')

    sw, sh = source.width, source.height
    tw, th = target.width, target.height
    source_ar = sw / sh
    target_ar = tw / th

    if mode == 'crop':
        scale = max(tw / sw, th / sh)
        scaled_w = int(round(sw * scale))
        scaled_h = int(round(sh * scale))
        overflow_x = scaled_w - tw
        overflow_y = scaled_h - th
        x = overflow_x // 2 if anchor == 'center' else 0
        y = overflow_y // 2 if anchor == 'center' else 0
        crop = {'x': x, 'y': y, 'width': tw, 'height': th}
        padding = {'left': 0, 'top': 0, 'right': 0, 'bottom': 0}
    else:
        scale = min(tw / sw, th / sh)
        scaled_w = int(round(sw * scale))
        scaled_h = int(round(sh * scale))
        pad_x = tw - scaled_w
        pad_y = th - scaled_h
        left = pad_x // 2 if anchor == 'center' else 0
        top = pad_y // 2 if anchor == 'center' else 0
        crop = {'x': 0, 'y': 0, 'width': sw, 'height': sh}
        padding = {'left': left, 'top': top, 'right': pad_x - left, 'bottom': pad_y - top}

    rw, rh = reduce_ratio(tw, th)
    return {
        'cell': 'media_geometry',
        'version': '1.0.0',
        'operation': mode,
        'source': {'width': sw, 'height': sh},
        'target': {'width': tw, 'height': th},
        'source_aspect_ratio': f'{reduce_ratio(sw, sh)[0]}:{reduce_ratio(sw, sh)[1]}',
        'target_aspect_ratio': f'{rw}:{rh}',
        'source_aspect_decimal': round(source_ar, 10),
        'target_aspect_decimal': round(target_ar, 10),
        'scale': round(scale, 10),
        'scaled_dimensions': {'width': scaled_w, 'height': scaled_h},
        'crop': crop,
        'padding': padding,
        'anchor': anchor,
        'deterministic': True,
    }
