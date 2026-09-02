import os
import sys
sys.path.insert(0, ".")
from measure_math import calculate_diagonal, calculate_pitch_angle, calculate_area, format_fractional_inches

print("=" * 60)
print("  CELL 002: GEOMETRIC MEASUREMENT ENGINE — LOCAL PROOF")
print("=" * 60)

# 1. Test 22x20 Pythagorean Diagonal
diag = calculate_diagonal(20, 22, unit="feet")
print(f"[+] 22x20 Diag Decimal : {diag['diagonal_exact']} ft")
print(f"[+] 22x20 Diag Fraction: {diag['fractional_formatted']}")
assert diag["fractional_formatted"] == "29' 8-13/16\""

# 2. Test 3:12 Roof Slope Pitch
pitch = calculate_pitch_angle(3, 12)
print(f"[+] 3:12 Pitch Angle   : {pitch['angle_degrees']} deg")
assert round(pitch["angle_degrees"], 2) == 14.04

# 3. Test 22x20 Area
area = calculate_area(20, 22, unit="feet")
print(f"[+] Area (sq ft)       : {area['area_sq_ft']} sq ft")
print(f"[+] Area (sq meters)   : {area['area_sq_meters']} sq m")
assert area["area_sq_ft"] == 440.0

print("\n[PASS] All 3 Deterministic Math Tests Passed 100%!")
