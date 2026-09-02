import json
from data_clean import sanitize_and_parse_json, flatten_dictionary, strip_nulls

print("=" * 60)
print("  CELL 003: DATA HYGIENE ENGINE — LOCAL PROOF")
print("=" * 60)

# Test 1: Markdown fence & trailing comma repair
dirty_json = """```json
{
  "project": "Ligeia Studio",
  "cell_id": 3,
  "tags": ["deterministic", "m2m",],
}
```"""
res1 = sanitize_and_parse_json(dirty_json)
print(f"[+] Stripped Markdown & Trailing Commas: {res1['parsed']['project']} (Cell {res1['parsed']['cell_id']})")
assert res1["parsed"]["cell_id"] == 3
assert len(res1["parsed"]["tags"]) == 2

# Test 2: Nested key flattening
nested = {"specs": {"geometry": {"ratio": "16:9", "width": 1920}}}
flat = flatten_dictionary(nested)
print(f"[+] Flattened Keys: {flat}")
assert flat["specs.geometry.ratio"] == "16:9"
assert flat["specs.geometry.width"] == 1920

# Test 3: Null stripping
null_payload = {"title": "Vault", "empty_val": None, "sub": {"valid": 1, "bad": None}}
cleaned_nulls = strip_nulls(null_payload)
print(f"[+] Stripped Nulls: {cleaned_nulls}")
assert "empty_val" not in cleaned_nulls
assert "bad" not in cleaned_nulls["sub"]

print("\n[PASS] All Cell 003 Local Unit Tests Passed 100%!")
