import asyncio
import json
from typing import Any, Dict, List
import httpx
from mcp.server import NotificationOptions, Server
from mcp.server.models import InitializationOptions
import mcp.server.stdio
import mcp.types as types

EDGE_HOST = "https://cell001-media-geometry.ligeiastudio-aitools.workers.dev"

server = Server("ligeia-studio-cells")


async def handle_list_tools() -> List[types.Tool]:
  return [
      types.Tool(
          name="cell_001_media_geometry",
          description=(
              "Cell 001: Computes aspect ratios, scaling factors, and pixel"
              " crop offsets. Cost: 3000 atomic USDC units on Base Sepolia."
          ),
          inputSchema={
              "type": "object",
              "properties": {
                  "source": {"type": "object"}, "target": {"type": "object"},
                  "mode": {"type": "string", "enum": ["crop", "contain"]},
              },
              "required": ["source", "target"],
          },
      ),
      types.Tool(
          name="cell_002_geometric_measurement",
          description=(
              "Cell 002: Calculates precise Pythagorean squaring, diagonal"
              " offsets, and 1/16-inch fractional normalization. Cost: 3000 atomic USDC units on Base Sepolia."
          ),
          inputSchema={
              "type": "object",
              "properties": {
                  "operation": {"type": "string", "const": "diagonal"},
                  "dimensions": {"type": "object"},
              },
              "required": ["operation", "dimensions"],
          },
      ),
      types.Tool(
          name="cell_003_json_hygiene",
          description=(
              "Cell 003: Sanitizes raw JSON strings, enforces deterministic key"
              " sorting, depth validation, and returns SHA-256 validation hash. Cost: 3000 atomic USDC units on Base Sepolia."
          ),
          inputSchema={
              "type": "object",
              "properties": {
                  "raw_payload": {"type": "string"}, "json_object": {"type": "object"},
                  "strip_null_values": {"type": "boolean"}, "flatten_keys": {"type": "boolean"},
              },
              "oneOf": [{"required": ["raw_payload"]}, {"required": ["json_object"]}],
          },
      ),
      types.Tool(
          name="cell_004_comfyui_preflight",
          description=(
              "Cell 004: Performs static link integrity audits on ComfyUI node"
              " graphs to identify broken connections or orphaned nodes. Cost: 20000 atomic USDC units on Base Sepolia."
          ),
          inputSchema={
              "type": "object",
              "properties": {
                  "prompt": {
                      "type": "object",
                      "description": "Serialized ComfyUI workflow JSON object",
                  },
                  "installed_nodes": {"type": "array", "items": {"type": "string"}},
              },
              "required": ["prompt"],
          },
      ),
  ]


async def handle_call_tool(
    name: str, arguments: Dict[str, Any]
) -> List[types.TextContent]:
  endpoint_map = {
      "cell_001_media_geometry": "/v1/media-geometry",
      "cell_002_geometric_measurement": "/v1/geometry/measurement",
      "cell_003_json_hygiene": "/v1/data/json-clean",
      "cell_004_comfyui_preflight": "/v1/workflow/comfy-preflight",
  }
  if name not in endpoint_map:
    return [
        types.TextContent(
            type="text", text=json.dumps({"error": f"Unknown tool: {name}"})
        )
    ]

  route = endpoint_map[name]
  target_url = f"{EDGE_HOST}{route}"

  async with httpx.AsyncClient(timeout=10.0) as client:
    try:
      resp = await client.post(target_url, json=arguments)
      return [types.TextContent(type="text", text=resp.text)]
    except Exception as e:
      return [types.TextContent(type="text", text=json.dumps({"error": str(e)}))]


async def main():
  async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
    await server.run(
        read_stream,
        write_stream,
        InitializationOptions(
            server_name="ligeia-studio-cells",
            server_version="1.0.0",
            capabilities=server.get_capabilities(
                notification_options=NotificationOptions(), experimental_capabilities={}
            ),
        ),
    )


if __name__ == "__main__":
  asyncio.run(main())