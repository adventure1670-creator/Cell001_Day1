# Ligeia Studio: Autonomous Computational Engines (Cell 001–004)

[![x402 Protocol](https://img.shields.io/badge/payment-x402-blue.svg)](https://x402.org)
[![Base Mainnet](https://img.shields.io/badge/network-Base%20Mainnet%20(8453)-0052FF.svg)](https://basescan.org)
[![Settlement Asset](https://img.shields.io/badge/settlement-Native%20USDC-2775CA.svg)](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
[![MCP Compliant](https://img.shields.io/badge/protocol-Model%20Context%20Protocol-green.svg)](https://modelcontextprotocol.io)
[![Cloudflare Edge](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020.svg)](https://workers.cloudflare.com)

Autonomous, edge-native micro-commerce engines providing deterministic media geometry, structural calculations, and node-graph preflight audits. Every engine is monetized natively via the **x402 payment protocol** on **Base Mainnet**, allowing autonomous AI agents to discover, call, and settle computations in native USDC without human intermediation.

---

## Computational Engine Suite

| Cell ID | Engine Name | Route | Cost (USDC) | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Cell 001** | Media Geometry API | `POST /v1/media-geometry` | **$0.0030** | Deterministic aspect ratio, dimensional scaling, and optical bounding boxes. |
| **Cell 002** | Geometric Measurement API | `POST /v1/geometry/measurement` | **$0.0030** | Structural clearance, diagonal spans, and precision angle math. |
| **Cell 003** | JSON Hygiene API | `POST /v1/data/json-clean` | **$0.0030** | Sanitizes and validates malformed LLM outputs into strict schema conformance. |
| **Cell 004** | ComfyUI Preflight Risk Engine | `POST /v1/workflow/comfy-preflight` | **$0.0200** | Audits generative node-graphs for missing classes and cycles before costly GPU runs. |

---

## Model Context Protocol (MCP) Integration

Ligeia Studio engines expose a standardized **Model Context Protocol (MCP)** server (`ligeia_mcp_server.py`) for plug-and-play integration with Claude Desktop, Cursor, Cline, and autonomous agent frameworks.

### Installation via Smithery
```bash
npx -y @smithery/cli install ligeia-mcp-server
```

