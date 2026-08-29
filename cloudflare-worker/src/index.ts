import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";

interface Env {
  NETWORK?: string;
  CHAIN_ID?: string;
  PAY_TO?: string;
  USDC?: string;
}

const app = new Hono<{ Bindings: Env }>();

const NETWORK_CONFIG = {
  base: {
    network: "base",
    chain_id: 8453,
    pay_to: "0xd38fe438F96C9E21AcdA8d3E9ecE8C4156157dc0",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "base-sepolia": {
    network: "base-sepolia",
    chain_id: 84532,
    pay_to: "0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
} as const;

type NetworkName = keyof typeof NETWORK_CONFIG;
type NetworkConfig = (typeof NETWORK_CONFIG)[NetworkName];

function resolveNetworkConfig(env: Env): NetworkConfig {
  const network = env.NETWORK as NetworkName;
  const config = NETWORK_CONFIG[network];
  if (!config || Number(env.CHAIN_ID) !== config.chain_id || env.PAY_TO !== config.pay_to || env.USDC !== config.usdc) {
    throw new Error("Invalid network configuration: NETWORK, PAY_TO, and USDC must be one supported tuple");
  }
  return config;
}
const VERSION = "1.0.0";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_JSON_DEPTH = 32;

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

interface Dimensions {
  width: number;
  height?: number;
  length?: number;
  unit?: string;
}

interface Cell001Request {
  source: { width: number; height: number };
  target: { width: number; height: number };
  mode?: "crop" | "contain";
  anchor?: string;
}

interface Cell001Answer {
  scale: number;
  scaled_dimensions: { width: number; height: number };
  crop: { x: number; y: number; width: number; height: number };
}

interface Cell002Request {
  operation: "diagonal";
  dimensions: { width: number; length: number; unit?: string };
}

interface Cell002Answer {
  diagonal: number;
}

interface Cell003Request {
  raw_payload?: string;
  json_object?: JsonValue;
  strip_null_values?: boolean;
  flatten_keys?: boolean;
}

interface Cell003Answer {
  clean_json: JsonValue;
  byte_size: number;
}

interface WorkflowNode {
  class_type?: string;
  inputs?: JsonObject;
  outputs?: Array<{ links?: Array<number | string> }>;
}

interface Cell004Request {
  prompt: Record<string, WorkflowNode>;
  installed_nodes?: string[];
}

interface Cell004Answer {
  valid: boolean;
  risk_score: number;
  unresolved_links: Array<{ node_id: string; field: string; target_id?: string; issue: string }>;
  missing_nodes: string[];
  issues: Array<{ code: string; node_id?: string; field?: string; message: string; severity: "error" | "warning" }>;
}

interface SuccessEnvelope<T extends object> {
  ok: true;
  cell: string;
  answer: T;
  meta: { deterministic: true; version: typeof VERSION };
}

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; expected_schema: string };
}

function success<T extends object>(cell: string, answer: T): SuccessEnvelope<T> {
  return { ok: true, cell, answer, meta: { deterministic: true, version: VERSION } };
}

function failure(c: any, status: 400 | 413 | 422, code: string, message: string, expected_schema: string) {
  return c.json<ErrorEnvelope>({ ok: false, error: { code, message, expected_schema } }, status);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isCell001Request(value: unknown): value is Cell001Request {
  const body = value as any;
  return isRecord(body) && isRecord(body.source) && isRecord(body.target)
    && [body.source.width, body.source.height, body.target.width, body.target.height].every((n) => Number.isInteger(n) && n > 0)
    && (body.mode === undefined || body.mode === "crop" || body.mode === "contain");
}

function isCell002Request(value: unknown): value is Cell002Request {
  const body = value as any;
  return isRecord(body) && body.operation === "diagonal" && isRecord(body.dimensions)
    && isPositiveNumber(body.dimensions.width) && isPositiveNumber(body.dimensions.length);
}

function isCell003Request(value: unknown): value is Cell003Request {
  const body = value as any;
  return isRecord(body) && ((typeof body.raw_payload === "string") || Object.prototype.hasOwnProperty.call(body, "json_object"))
    && (body.strip_null_values === undefined || typeof body.strip_null_values === "boolean")
    && (body.flatten_keys === undefined || typeof body.flatten_keys === "boolean");
}

function isCell004Request(value: unknown): value is Cell004Request {
  const body = value as any;
  return isRecord(body) && isRecord(body.prompt)
    && (body.installed_nodes === undefined || (Array.isArray(body.installed_nodes) && body.installed_nodes.every((node: unknown) => typeof node === "string")));
}

const BUILT_IN_COMFY_NODES = new Set([
  "CheckpointLoaderSimple", "CheckpointLoader", "UNETLoader", "VAELoader", "CLIPLoader",
  "KSampler", "KSamplerAdvanced", "EmptyLatentImage", "EmptyLatentImage", "CLIPTextEncode",
  "VAEDecode", "VAEEncode", "SaveImage", "PreviewImage", "LoadImage", "LatentUpscale",
  "EmptyLatentAudio", "PrimitiveNode", "Reroute", "Note", "MarkdownNote",
]);

function isEmptyLink(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

function hasValue(inputs: JsonObject | undefined, field: string): boolean {
  return inputs !== undefined && !isEmptyLink(inputs[field]);
}

function validatePositiveParameter(inputs: JsonObject | undefined, field: string, nodeId: string, issues: Cell004Answer["issues"]): void {
  const value = inputs?.[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    issues.push({ code: "INVALID_MODEL_PARAMETER", node_id: nodeId, field, message: `${field} must be a positive number`, severity: "error" });
  }
}

function auditComfyWorkflow(body: Cell004Request): Cell004Answer {
  const nodes = Object.keys(body.prompt);
  const nodeSet = new Set(nodes);
  const installed = new Set(body.installed_nodes ?? []);
  const unresolved_links: Cell004Answer["unresolved_links"] = [];
  const missing_nodes = new Set<string>();
  const issues: Cell004Answer["issues"] = [];
  let risk = 0;

  for (const [nodeId, node] of Object.entries(body.prompt)) {
    const classType = node.class_type ?? "";
    if (!classType || (!BUILT_IN_COMFY_NODES.has(classType) && !installed.has(classType))) {
      missing_nodes.add(classType || nodeId);
      issues.push({ code: "MISSING_NODE", node_id: nodeId, message: `Node class '${classType || "unknown"}' is not installed`, severity: "error" });
      risk += 30;
    }

    for (const [field, value] of Object.entries(node.inputs ?? {})) {
      if (isEmptyLink(value)) {
        unresolved_links.push({ node_id: nodeId, field, issue: "Input is unlinked" });
        issues.push({ code: "UNLINKED_INPUT", node_id: nodeId, field, message: `Input '${field}' is unlinked`, severity: "error" });
        risk += 10;
      } else if (Array.isArray(value) && value.length === 2) {
        const targetId = String(value[0]);
        if (!nodeSet.has(targetId)) {
          unresolved_links.push({ node_id: nodeId, field, target_id: targetId, issue: "Dangling link to nonexistent node" });
          issues.push({ code: "DANGLING_LINK", node_id: nodeId, field, message: `Input '${field}' targets nonexistent node '${targetId}'`, severity: "error" });
          risk += 20;
        }
      }
    }

    if (["CheckpointLoaderSimple", "CheckpointLoader"].includes(classType)) {
      if (!hasValue(node.inputs, "ckpt_name")) {
        issues.push({ code: "INVALID_CHECKPOINT", node_id: nodeId, field: "ckpt_name", message: "Checkpoint loader requires a checkpoint name", severity: "error" });
        risk += 25;
      }
    }
    if (["UNETLoader", "CLIPLoader", "VAELoader"].includes(classType)) {
      const parameter = classType === "UNETLoader" ? "unet_name" : classType === "CLIPLoader" ? "clip_name" : "vae_name";
      if (!hasValue(node.inputs, parameter)) {
        issues.push({ code: "INVALID_MODEL_PARAMETER", node_id: nodeId, field: parameter, message: `${classType} requires ${parameter}`, severity: "error" });
        risk += 20;
      }
    }
    if (["KSampler", "KSamplerAdvanced"].includes(classType)) {
      for (const field of ["model", "positive", "negative", "latent_image"]) {
        if (!hasValue(node.inputs, field)) {
          issues.push({ code: "UNLINKED_INPUT", node_id: nodeId, field, message: `Sampler input '${field}' is unlinked`, severity: "error" });
          unresolved_links.push({ node_id: nodeId, field, issue: "Required sampler input is unlinked" });
          risk += 10;
        }
      }
      validatePositiveParameter(node.inputs, "steps", nodeId, issues);
      validatePositiveParameter(node.inputs, "cfg", nodeId, issues);
      if (issues.some((issue) => issue.node_id === nodeId && issue.code === "INVALID_MODEL_PARAMETER")) risk += 10;
    }
    if (classType === "EmptyLatentImage") {
      for (const field of ["width", "height", "batch_size"]) validatePositiveParameter(node.inputs, field, nodeId, issues);
      if (issues.some((issue) => issue.node_id === nodeId && issue.code === "INVALID_MODEL_PARAMETER")) risk += 10;
    }
  }

  const uniqueIssues = issues.filter((issue, index, all) => index === all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(issue)));
  return {
    valid: uniqueIssues.length === 0,
    risk_score: Math.min(100, risk),
    unresolved_links,
    missing_nodes: [...missing_nodes].sort(),
    issues: uniqueIssues,
  };
}

async function readJson(c: any): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function exceedsJsonDepth(rawText: string, maxDepth = MAX_JSON_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of rawText) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > maxDepth) return true;
    } else if (character === "}" || character === "]") depth = Math.max(0, depth - 1);
  }
  return false;
}

function getObjectDepth(obj: any): number {
  if (obj === null || typeof obj !== "object") return 0;
  let depth = 0;
  for (const key of Object.keys(obj)) {
    depth = Math.max(depth, getObjectDepth(obj[key]));
  }
  return 1 + depth;
}

function stripNulls(obj: any): any {
  if (Array.isArray(obj)) return obj.filter((v) => v !== null).map(stripNulls);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== null)
        .map(([k, v]) => [k, stripNulls(v)])
    );
  }
  return obj;
}

function flattenObject(obj: Record<string, any>, prefix = "", sep = "."): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}${sep}${key}` : key;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(result, flattenObject(val, newKey, sep));
    } else {
      result[newKey] = val;
    }
  }
  return result;
}

// 1. Dynamic Discovery Manifests
app.get("/", (c) => {
  const config = resolveNetworkConfig(c.env);
  return c.json({
    name: "Ligeia Studio M2M Micro-Commerce Hub",
    network: config.network,
    chain_id: config.chain_id,
    settlement_token: `USDC (${config.usdc})`,
    pay_to: config.pay_to,
    version: VERSION,
    cells: {
    "Cell 001": { route: "/v1/media-geometry", price: "$0.003", description: "2D Aspect Ratio & Exact Crop Offsets" },
    "Cell 002": { route: "/v1/geometry/measurement", price: "$0.003", description: "Pythagorean Squaring & 1/16\" Fractions" },
    "Cell 003": { route: "/v1/data/json-clean", price: "$0.003", description: "Data Hygiene & Canonical SHA-256 Hashes" },
    "Cell 004": { route: "/v1/workflow/comfy-preflight", price: "$0.020", description: "ComfyUI Static Graph Link Audit" },
    },
  });
});

app.get("/.well-known/x402.json", (c) => {
  const config = resolveNetworkConfig(c.env);
  return c.json({
    version: VERSION,
    network: config.network,
    chain_id: config.chain_id,
    pay_to: config.pay_to,
    asset: config.usdc,
    services: [
      { cell: "001", name: "Media Geometry", route: "/v1/media-geometry", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "002", name: "Geometric Measurement", route: "/v1/geometry/measurement", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "003", name: "JSON Hygiene", route: "/v1/data/json-clean", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "004", name: "ComfyUI Preflight Risk", route: "/v1/workflow/comfy-preflight", price_atomic: 20000, price_usdc: 0.020 },
    ],
  });
});

app.use("*", async (c, next) => {
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return failure(c, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 512 KB maximum", "Request body <= 524288 bytes");
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const bodyBytes = await c.req.raw.clone().arrayBuffer();
    if (bodyBytes.byteLength > MAX_BODY_BYTES) {
      return failure(c, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 512 KB maximum", "Request body <= 524288 bytes");
    }
  }
  return next();
});

// 2. x402 Base Mainnet Payment Middleware
app.use(
  "*",
  (c, next) => {
    const config = resolveNetworkConfig(c.env);
    return paymentMiddleware(
      config.pay_to,
      {
        "/v1/media-geometry": {
          price: "$0.003",
          network: config.network,
          config: { description: "Cell 001 Media Geometry", mimeType: "application/json" },
        },
        "/v1/geometry/measurement": {
          price: "$0.003",
          network: config.network,
          config: { description: "Cell 002 Geometric Measurement", mimeType: "application/json" },
        },
        "/v1/data/json-clean": {
          price: "$0.003",
          network: config.network,
          config: { description: "Cell 003 Data Hygiene", mimeType: "application/json" },
        },
        "/v1/workflow/comfy-preflight": {
          price: "$0.020",
          network: config.network,
          config: { description: "Cell 004 ComfyUI Preflight", mimeType: "application/json" },
        },
      },
      { url: "https://x402.org/facilitator" },
    )(c, next);
  },
);

// Cell 001: Media Geometry
app.post("/v1/media-geometry", async (c) => {
  const body = await readJson(c);
  if (!isCell001Request(body)) return failure(c, 422, "INVALID_SCHEMA", "Dimensions must be positive integers and mode must be crop or contain", "{ source: { width: integer, height: integer }, target: { width: integer, height: integer }, mode?: crop|contain }");
  const sw = body?.source?.width;
  const sh = body?.source?.height;
  const tw = body?.target?.width;
  const th = body?.target?.height;

  if (![sw, sh, tw, th].every(Number.isInteger) || [sw, sh, tw, th].some((n) => n <= 0)) {
    return failure(c, 422, "INVALID_DIMENSIONS", "Dimensions must be positive integers > 0", "Cell001Request");
  }

  const mode = body.mode ?? "crop";
  const scale = mode === "crop" ? Math.max(tw / sw, th / sh) : Math.min(tw / sw, th / sh);
  const scaledW = Math.round(sw * scale);
  const scaledH = Math.round(sh * scale);

  return c.json(success("media_geometry", {
      scale: Number(scale.toFixed(6)),
      scaled_dimensions: { width: scaledW, height: scaledH },
      crop: { x: Math.max(0, Math.floor((scaledW - tw) / 2)), y: Math.max(0, Math.floor((scaledH - th) / 2)), width: tw, height: th },
  }));
});

// Cell 002: Geometric Measurement
app.post("/v1/geometry/measurement", async (c) => {
  const body = await readJson(c);
  if (isCell002Request(body)) {
    const diag = Math.hypot(body.dimensions.width, body.dimensions.length);
    return c.json(success("geometric_measurement", { diagonal: Number(diag.toFixed(6)) }));
  }
  return failure(c, 422, "INVALID_SCHEMA", "Operation must be diagonal with positive width and length", "{ operation: diagonal, dimensions: { width: number, length: number, unit?: string } }");
});

// Cell 003: Data Hygiene
app.post("/v1/data/json-clean", async (c) => {
  const rawText = await c.req.text();
  if (rawText.length > 256 * 1024) {
    return failure(c, 422, "PAYLOAD_TOO_LARGE", "Payload exceeds maximum allowed limit of 256 KB", "Cell003Request");
  }

  let body: any;
  try {
    if (exceedsJsonDepth(rawText)) return failure(c, 422, "MAX_DEPTH_EXCEEDED", "JSON nesting depth exceeds the maximum allowed limit", "JSON nesting depth <= 32");
    body = JSON.parse(rawText);
  } catch (e: any) {
    return failure(c, 400, "INVALID_JSON", `JSON parse error: ${e.message}`, "Valid JSON object containing raw_payload or json_object");
  }

  if (!isCell003Request(body)) return failure(c, 422, "INVALID_SCHEMA", "Must provide raw_payload or json_object", "{ raw_payload?: string, json_object?: JSON, strip_null_values?: boolean, flatten_keys?: boolean }");

  let targetObj: any;
  if (body.raw_payload) {
    let cleanStr = body.raw_payload.trim();
    const fenceMatch = cleanStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) cleanStr = fenceMatch[1].trim();
    try {
      targetObj = JSON.parse(cleanStr);
    } catch (e: any) {
      return failure(c, 422, "INVALID_EMBEDDED_JSON", `Embedded JSON syntax error: ${e.message}`, "raw_payload must contain valid JSON");
    }
  } else if (body.json_object) {
    targetObj = body.json_object;
  } else {
    return failure(c, 422, "INVALID_SCHEMA", "Must provide either raw_payload or json_object", "Cell003Request");
  }

  if (getObjectDepth(targetObj) > 10) {
    return failure(c, 422, "MAX_DEPTH_EXCEEDED", "JSON nesting depth exceeds maximum allowed limit of 10 levels", "JSON nesting depth <= 10");
  }

  if (body.strip_null_values) targetObj = stripNulls(targetObj);
  if (body.flatten_keys && typeof targetObj === "object" && !Array.isArray(targetObj)) {
    targetObj = flattenObject(targetObj);
  }

  return c.json(success("data_hygiene", { clean_json: targetObj, byte_size: JSON.stringify(targetObj).length }));
});

// Cell 004: ComfyUI Preflight
app.post("/v1/workflow/comfy-preflight", async (c) => {
  const rawBody = await c.req.raw.clone().text();
  if (exceedsJsonDepth(rawBody)) return failure(c, 422, "MAX_DEPTH_EXCEEDED", "Workflow JSON nesting depth exceeds the maximum allowed limit", "JSON nesting depth <= 32");
  const body = await readJson(c);
  if (!isCell004Request(body)) return failure(c, 422, "INVALID_SCHEMA", "Missing or invalid prompt graph object", "{ prompt: { [node_id: string]: { class_type?: string, inputs?: object } } }");

  const nodes = Object.keys(body.prompt);
  if (nodes.length > 500) {
    return failure(c, 422, "MAX_NODES_EXCEEDED", "Workflow graph exceeds maximum allowed limit of 500 nodes", "prompt node count <= 500");
  }
  return c.json(success("comfy_preflight", auditComfyWorkflow(body)));
});

export default app;
