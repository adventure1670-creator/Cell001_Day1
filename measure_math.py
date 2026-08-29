"""
Ligeia Studio — Cell 002: Geometric Measurement Engine
Pure deterministic math: diagonals, pitch angles, areas, fractional-inch formatting.
Strictly non-structural (Green Zone).
"""

import math
from fractions import Fraction
from typing import Dict, Any, Tuple

def format_fractional_inches(total_inches: float) -> str:
    """Formats decimal inches into exact feet and 1/16th-inch fractional representation."""
    feet = int(total_inches // 12)
    remaining_inches = total_inches - (feet * 12)
    whole_inches = int(remaining_inches)
    fractional_part = remaining_inches - whole_inches
    
    # Round to nearest 1/16th
    sixteenths = round(fractional_part * 16)
    if sixteenths == 16:
        whole_inches += 1
        sixteenths = 0
    if whole_inches == 12:
        feet += 1
        whole_inches = 0
        
    if sixteenths > 0:
        frac = Fraction(sixteenths, 16)
        frac_str = f"{frac.numerator}/{frac.denominator}"
        if whole_inches > 0:
            inch_str = f"{whole_inches}-{frac_str}\""
        else:
            inch_str = f"{frac_str}\""
    else:
        inch_str = f"{whole_inches}\""
        
    if feet > 0:
        return f"{feet}' {inch_str}"
    return inch_str

def calculate_diagonal(width: float, length: float, unit: str = "feet") -> Dict[str, Any]:
    """Computes exact Pythagorean diagonal: D = sqrt(W^2 + L^2)."""
    if width <= 0 or length <= 0:
        raise ValueError("Dimensions must be positive numbers.")
        
    # Standardize to inches for formatting
    scale_to_inches = {"feet": 12.0, "inches": 1.0, "mm": 1.0 / 25.4, "cm": 1.0 / 2.54}.get(unit.lower(), 12.0)
    w_in = width * scale_to_inches
    l_in = length * scale_to_inches
    
    diag_in = math.sqrt(w_in**2 + l_in**2)
    diag_native = math.sqrt(width**2 + length**2)
    
    return {
        "operation": "diagonal",
        "input": {"width": width, "length": length, "unit": unit},
        "diagonal_exact": round(diag_native, 10),
        "diagonal_inches": round(diag_in, 6),
        "fractional_formatted": format_fractional_inches(diag_in),
        "deterministic": True
    }

def calculate_pitch_angle(rise: float, run: float = 12.0) -> Dict[str, Any]:
    """Computes roof/slope pitch angle, radians, and slope multiplier."""
    if rise < 0 or run <= 0:
        raise ValueError("Rise must be non-negative and run must be positive.")
        
    rad = math.atan(rise / run)
    deg = math.degrees(rad)
    hypotenuse = math.sqrt(rise**2 + run**2)
    slope_multiplier = hypotenuse / run
    
    return {
        "operation": "pitch_angle",
        "input": {"rise": rise, "run": run},
        "angle_degrees": round(deg, 6),
        "angle_radians": round(rad, 8),
        "pitch_ratio": f"{rise:.2f}:{run:.2f}",
        "slope_multiplier": round(slope_multiplier, 6),
        "deterministic": True
    }

def calculate_area(width: float, length: float, unit: str = "feet") -> Dict[str, Any]:
    """Computes exact rectangular area with dual unit outputs."""
    if width <= 0 or length <= 0:
        raise ValueError("Dimensions must be positive numbers.")
        
    area_native = width * length
    scale_to_feet = {"feet": 1.0, "inches": 1.0 / 12.0, "mm": 1.0 / 304.8, "cm": 1.0 / 30.48}.get(unit.lower(), 1.0)
    
    area_sq_ft = (width * scale_to_feet) * (length * scale_to_feet)
    area_sq_meters = area_sq_ft * 0.09290304
    area_sq_inches = area_sq_ft * 144.0
    
    return {
        "operation": "area",
        "input": {"width": width, "length": length, "unit": unit},
        "area_native": round(area_native, 6),
        "area_sq_ft": round(area_sq_ft, 6),
        "area_sq_meters": round(area_sq_meters, 6),
        "area_sq_inches": round(area_sq_inches, 2),
        "deterministic": True
    }
