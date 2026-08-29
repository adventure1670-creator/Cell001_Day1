"""
Ligeia Studio — Cell 003: Deterministic Data Hygiene Engine
Strips Markdown code fences, fixes trailing commas, flattens nested keys, and normalizes schema.
"""

import json
import re
from typing import Dict, Any, Union

def sanitize_and_parse_json(raw_text: str) -> Dict[str, Any]:
    """Strips Markdown fences, fixes common trailing commas, and returns parsed JSON object."""
    cleaned = raw_text.strip()
    
    # Strip markdown code blocks if present
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if match:
        cleaned = match.group(1).strip()
        
    # Remove trailing commas before closing braces or brackets
    cleaned = re.sub(r",\s*([\]}])", r"\1", cleaned)
    
    parsed = json.loads(cleaned)
    return {
        "parsed": parsed,
        "raw_byte_length": len(raw_text.encode("utf-8")),
        "cleaned_byte_length": len(cleaned.encode("utf-8")),
        "normalized_json": json.dumps(parsed, separators=(",", ":"), sort_keys=True)
    }

def flatten_dictionary(d: Dict[str, Any], parent_key: str = "", sep: str = ".") -> Dict[str, Any]:
    """Recursively flattens nested dictionaries into dot-separated keys."""
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dictionary(v, new_key, sep=sep).items())
        else:
            items.append((new_key, v))
    return dict(items)

def strip_nulls(data: Union[Dict, list]) -> Union[Dict, list]:
    """Recursively strips null/None fields from objects."""
    if isinstance(data, dict):
        return {k: strip_nulls(v) for k, v in data.items() if v is not None}
    elif isinstance(data, list):
        return [strip_nulls(item) for item in data if item is not None]
    return data
