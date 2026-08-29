import asyncio
import json
import sys

import requests

from ligeia_mcp_server import EDGE_HOST, handle_list_tools


EXPECTED_SERVICES = [
    {"cell": "001", "name": "Media Geometry", "route": "/v1/media-geometry", "price_atomic": 3000, "price_usdc": 0.003},
    {"cell": "002", "name": "Geometric Measurement", "route": "/v1/geometry/measurement", "price_atomic": 3000, "price_usdc": 0.003},
    {"cell": "003", "name": "JSON Hygiene", "route": "/v1/data/json-clean", "price_atomic": 3000, "price_usdc": 0.003},
    {"cell": "004", "name": "ComfyUI Preflight Risk", "route": "/v1/workflow/comfy-preflight", "price_atomic": 20000, "price_usdc": 0.020},
]


def verify_discovery() -> None:
    response = requests.get(f"{EDGE_HOST}/.well-known/x402.json", timeout=30)
    assert response.status_code == 200, response.text
    manifest = response.json()
    assert set(manifest) == {"version", "network", "pay_to", "services"}
    assert manifest["version"] == "1.0.0"
    assert manifest["network"] == "base-sepolia"
    assert manifest["pay_to"] == "0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc"
    assert manifest["services"] == EXPECTED_SERVICES
    print("[PASS] Discovery GET HTTP 200; exact manifest and all 4 services verified")
    print(json.dumps(manifest, indent=2))


def verify_mcp() -> None:
    tools = asyncio.run(handle_list_tools())
    expected = {
        "cell_001_media_geometry": ("/v1/media-geometry", {"source", "target"}),
        "cell_002_geometric_measurement": ("/v1/geometry/measurement", {"operation", "dimensions"}),
        "cell_003_json_hygiene": ("/v1/data/json-clean", set()),
        "cell_004_comfyui_preflight": ("/v1/workflow/comfy-preflight", {"prompt"}),
    }
    assert len(tools) == 4
    for tool in tools:
        assert tool.name in expected
        schema = tool.input_schema
        required = set(schema.get("required", []))
        if tool.name == "cell_003_json_hygiene":
            assert "oneOf" in schema
        else:
            assert expected[tool.name][1].issubset(required)
    assert {tool.name for tool in tools} == set(expected)
    print("[PASS] MCP list_tools query returned 4 declarations with matching route schemas")
    for tool in tools:
        print(f"  {tool.name}: required={tool.input_schema.get('required', [])}")


if __name__ == "__main__":
    print("=" * 78)
    print("GATE #4: MACHINE DISCOVERY INTEGRATION | BASE SEPOLIA")
    print("=" * 78)
    try:
        verify_discovery()
        verify_mcp()
        print("RESULT: PASS | discovery manifest and MCP integration verified")
    except Exception as exc:
        print(f"RESULT: FAIL | {exc}")
        sys.exit(1)