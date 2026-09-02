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
    {"cell": "005", "name": "Latent Grid Snap", "route": "/v1/media/latent-snap", "price_atomic": 5000, "price_usdc": 0.005},
    {"cell": "006", "name": "JSON Auto-Repair", "route": "/v1/data/json-repair", "price_atomic": 10000, "price_usdc": 0.010},
    {"cell": "007", "name": "Color Math & Luminance", "route": "/v1/media/color-math", "price_atomic": 5000, "price_usdc": 0.005},
    {"cell": "008", "name": "Prompt Token & Weight Normalizer", "route": "/v1/ai/prompt-weight", "price_atomic": 5000, "price_usdc": 0.005},
]


def verify_discovery() -> None:
    response = requests.get(f"{EDGE_HOST}/.well-known/x402.json", timeout=30)
    assert response.status_code == 200, response.text
    manifest = response.json()
    assert set(manifest) == {"version", "network", "chain_id", "asset", "pay_to", "services"}
    assert manifest["version"] == "1.0.0"
    assert manifest["network"] == "base"
    assert manifest["chain_id"] == 8453
    assert manifest["asset"] == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    assert manifest["pay_to"] == "0xd38fe438F96C9E21AcdA8d3E9ecE8C4156157dc0"
    assert manifest["services"] == EXPECTED_SERVICES
    print("[PASS] Discovery GET HTTP 200; exact manifest and all 8 services verified")
    print(json.dumps(manifest, indent=2))


def verify_mcp() -> None:
    tools = asyncio.run(handle_list_tools())
    expected = {
        "cell_001_media_geometry": ("/v1/media-geometry", {"source", "target"}),
        "cell_002_geometric_measurement": ("/v1/geometry/measurement", {"operation", "dimensions"}),
        "cell_003_json_hygiene": ("/v1/data/json-clean", set()),
        "cell_004_comfyui_preflight": ("/v1/workflow/comfy-preflight", {"prompt"}),
        "cell_005_latent_grid_snap": ("/v1/media/latent-snap", {"width", "height"}),
        "cell_006_json_auto_repair": ("/v1/data/json-repair", {"raw_payload"}),
        "cell_007_color_math": ("/v1/media/color-math", {"color"}),
        "cell_008_prompt_weight": ("/v1/ai/prompt-weight", {"prompt"}),
    }
    assert len(tools) == 8
    for tool in tools:
        assert tool.name in expected
        schema = tool.input_schema
        required = set(schema.get("required", []))
        if tool.name == "cell_003_json_hygiene":
            assert "oneOf" in schema
        else:
            assert expected[tool.name][1].issubset(required)
    assert {tool.name for tool in tools} == set(expected)
    print("[PASS] MCP list_tools query returned 8 declarations with matching route schemas")
    for tool in tools:
        print(f"  {tool.name}: required={tool.input_schema.get('required', [])}")


if __name__ == "__main__":
    print("=" * 78)
    print("GATE #4: MACHINE DISCOVERY INTEGRATION | BASE MAINNET (8 CELLS)")
    print("=" * 78)
    try:
        verify_discovery()
        verify_mcp()
        print("RESULT: PASS | discovery manifest and MCP integration verified")
    except Exception as exc:
        print(f"RESULT: FAIL | {exc}")
        sys.exit(1)