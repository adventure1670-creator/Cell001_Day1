import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from measure_math import calculate_diagonal, calculate_pitch_angle, calculate_area, format_fractional_inches

def test_fractional_formatting():
    assert format_fractional_inches(356.8125) == "29' 8-13/16\""
    assert format_fractional_inches(12.5) == "1' 0-1/2\""
    assert format_fractional_inches(6.25) == "6-1/4\""
    assert format_fractional_inches(0.5) == "1/2\""
    assert format_fractional_inches(0) == "0\""

def test_pythagorean_diagonal_22x20():
    res = calculate_diagonal(20, 22, unit="feet")
    assert round(res["diagonal_exact"], 4) == 29.7321
    assert res["fractional_formatted"] == "29' 8-13/16\""
    assert res["deterministic"] is True

def test_pitch_angle_3_in_12():
    res = calculate_pitch_angle(3, 12)
    assert round(res["angle_degrees"], 2) == 14.04
    assert res["pitch_ratio"] == "3.00:12.00"
    assert round(res["slope_multiplier"], 4) == 1.0308

def test_area_calculation():
    res = calculate_area(20, 22, unit="feet")
    assert res["area_sq_ft"] == 440.0
    assert round(res["area_sq_meters"], 2) == 40.88
    assert res["area_sq_inches"] == 63360.0
