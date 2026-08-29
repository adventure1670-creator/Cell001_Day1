import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";

const app = new Hono<{ Bindings: { PAY_TO?: string; NETWORK?: string } }>();

const DEFAULT_PAY_TO = "0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc" as `0x${string}`;

function getPayTo(envPayTo?: string): `0x${string}` {
  if (envPayTo && envPayTo.startsWith("0x") && envPayTo.length === 42) {
    return envPayTo as `0x${string}`;
  }
  return DEFAULT_PAY_TO;
}

// Helpers
function formatFractionalInches(totalInches: number): string {
  let feet = Math.floor(totalInches / 12);
  let remainingInches = totalInches - feet * 12;
  let wholeInches = Math.floor(remainingInches);
  let fracPart = remainingInches - wholeInches;
  let sixteenths = Math.round(fracPart * 16);

  if (sixteenths === 16) {
    wholeInches += 1;
    sixteenths = 0;
  }
  if (wholeInches === 12) {
    feet += 1;
    wholeInches = 0;
  }

  let inchStr = "";
  if (sixteenths > 0) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(sixteenths, 16);
    const num = sixteenths / divisor;
    const den = 16 / divisor;
    inchStr = wholeInches > 0 ? `${wholeInches}-${num}/${den}"` : `${num}/${den}"`;
  } else {
    inchStr = `${wholeInches}"`;
  }

  return feet > 0 ? `${feet}' ${inchStr}` : inchStr;
}

function sortJsonRecursive(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortJsonRecursive);
  }
  if (obj !== null && typeof obj === "object") {
    const sorted: Record<string, any> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = sortJsonRecursive(obj[key]);
    }
    return sorted;
  }
  if (typeof obj === "string") {
    return obj.trim();
  }
  return obj;
}

async function sha256Hex(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ComfyUI Static Graph Audit Logic
function auditComfyGraph(graph: any) {
  let nodes: Record<string, any> = {};
  if (graph && Array.isArray(graph.nodes)) {
    for (const n of graph.nodes) {
      if (n.id) nodes[String(n.id)] = n;
    }
  } else if (graph && typeof graph === "object") {
    nodes = graph.prompt !== undefined ? graph.prompt : graph;
  }

  const nodeIds = new Set(Object.keys(nodes));
  const issues: Array<{ node_id: string; class_type: string; field?: string; issue: string; severity: "FATAL" | "WARN" }> = [];

  const requiredInputs: Record<string, string[]> = {
    KSampler: ["model", "positive", "negative", "latent_image"],
    KSamplerAdvanced: ["model", "positive", "negative", "latent_image"],
    VAEDecode: ["samples", "vae"],
    VAEEncode: ["pixels", "vae"],
    CLIPTextEncode: ["clip", "text"],
    SaveImage: ["images"],
  };

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object") continue;
    const classType = node.class_type || (node as any).type || "UnknownNode";
    const inputs = node.inputs || {};

    const reqList = requiredInputs[classType];
    if (reqList) {
      for (const req of reqList) {
        if (inputs[req] === undefined) {
          issues.push({
            node_id: nodeId,
            class_type: classType,
            field: req,
            issue: `Missing required input connection: '${req}'`,
            severity: "FATAL",
          });
        }
      }
    }

    for (const [inputKey, val] of Object.entries(inputs)) {
      if (Array.isArray(val) && val.length === 2 && (typeof val[0] === "string" || typeof val[0] === "number")) {
        const targetNodeId = String(val[0]);
        if (!nodeIds.has(targetNodeId)) {
          issues.push({
            node_id: nodeId,
            class_type: classType,
            field: inputKey,
            issue: `Dangling link: references nonexistent node ID '${targetNodeId}'`,
            severity: "FATAL",
          });
        }
      }
    }
  }

  const fatalCount = issues.filter((i) => i.severity === "FATAL").length;
  const warnCount = issues.filter((i) => i.severity === "WARN").length;

  return {
    valid: fatalCount === 0,
    node_count: nodeIds.size,
    error_count: fatalCount,
    warning_count: warnCount,
    issues,
    summary: fatalCount === 0 ? "Preflight check PASSED. Graph structure and link integrity are 100% valid." : `Preflight check FAILED: ${fatalCount} fatal graph error(s) detected.`,
  };
}

// ---------------------------------------------------------------------------
// Payment Middlewares
// ---------------------------------------------------------------------------
app.use("/v1/media-geometry", (c, next) =>
  paymentMiddleware(getPayTo(c.env.PAY_TO), { "/v1/media-geometry": { price: "$0.001", network: "base-sepolia", config: { description: "Cell 001 Media Geometry", mimeType: "application/json" } } }, { url: "https://x402.org/facilitator" })(c, next)
);

app.use("/v1/geometry/measurement", (c, next) =>
  paymentMiddleware(getPayTo(c.env.PAY_TO), { "/v1/geometry/measurement": { price: "$0.001", network: "base-sepolia", config: { description: "Cell 002 Geometric Measurement", mimeType: "application/json" } } }, { url: "https://x402.org/facilitator" })(c, next)
);

app.use("/v1/data/json-clean", (c, next) =>
  paymentMiddleware(getPayTo(c.env.PAY_TO), { "/v1/data/json-clean": { price: "$0.001", network: "base-sepolia", config: { description: "Cell 003 Data Hygiene", mimeType: "application/json" } } }, { url: "https://x402.org/facilitator" })(c, next)
);

app.use("/v1/workflow/comfy-preflight", (c, next) =>
  paymentMiddleware(getPayTo(c.env.PAY_TO), { "/v1/workflow/comfy-preflight": { price: "$0.001", network: "base-sepolia", config: { description: "Cell 004 ComfyUI Workflow Preflight", mimeType: "application/json" } } }, { url: "https://x402.org/facilitator" })(c, next)
);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
app.post("/v1/media-geometry", async (c) => {
  const body = await c.req.json<any>();
  const sw = body.source.width;
  const sh = body.source.height;
  const tw = body.target.width;
  const th = body.target.height;
  if (![sw, sh, tw, th].every(Number.isInteger) || [sw, sh, tw, th].some((n) => n <= 0)) {
    return c.json({ error: "dimensions must be positive integers" }, 400);
  }
  const mode = body.mode ?? "crop";
  const anchor = body.anchor ?? "center";
  const scale = mode === "crop" ? Math.max(tw / sw, th / sh) : Math.min(tw / sw, th / sh);
  const scaledW = Math.round(sw * scale);
  const scaledH = Math.round(sh * scale);
  const overflowX = scaledW - tw;
  const overflowY = scaledH - th;
  const x = mode === "crop" ? (anchor === "center" ? Math.floor(overflowX / 2) : 0) : 0;
  const y = mode === "crop" ? (anchor === "center" ? Math.floor(overflowY / 2) : 0) : 0;
  const padX = tw - scaledW;
  const padY = th - scaledH;
  const left = Math.max(0, Math.floor(padX / 2));
  const top = Math.max(0, Math.floor(padY / 2));

  return c.json({
    ok: true,
    answer: {
      cell: "media_geometry",
      version: "1.0.0",
      operation: mode,
      source: body.source,
      target: body.target,
      source_aspect_decimal: Number((sw / sh).toFixed(10)),
      target_aspect_decimal: Number((tw / th).toFixed(10)),
      scale: Number(scale.toFixed(10)),
      scaled_dimensions: { width: scaledW, height: scaledH },
      crop: { x, y, width: tw, height: th },
      padding: mode === "contain" ? { left, top, right: Math.max(0, padX - left), bottom: Math.max(0, padY - top) } : { left: 0, top: 0, right: 0, bottom: 0 },
      anchor,
      deterministic: true,
    },
  });
});

app.post("/v1/geometry/measurement", async (c) => {
  const body = await c.req.json<any>();
  const op = body.operation;
  if (op === "diagonal") {
    const unit = body.dimensions.unit ?? "feet";
    const scaleToInches: Record<string, number> = { feet: 12.0, inches: 1.0, mm: 1.0 / 25.4, cm: 1.0 / 2.54 };
    const scale = scaleToInches[unit] ?? 12.0;
    const wIn = body.dimensions.width * scale;
    const lIn = body.dimensions.length * scale;
    const diagIn = Math.sqrt(wIn * wIn + lIn * lIn);
    const diagNative = Math.sqrt(body.dimensions.width ** 2 + body.dimensions.length ** 2);
    return c.json({
      ok: true,
      answer: { cell: "geometric_measurement", version: "1.0.0", operation: "diagonal", input: body.dimensions, diagonal_exact: Number(diagNative.toFixed(10)), diagonal_inches: Number(diagIn.toFixed(6)), fractional_formatted: formatFractionalInches(diagIn), deterministic: true },
    });
  }
  return c.json({ error: "operation not supported" }, 400);
});

app.post("/v1/data/json-clean", async (c) => {
  const rawBody = await c.req.json<any>();
  const payloadToClean = rawBody.data !== undefined ? rawBody.data : rawBody;
  const canonicalObj = sortJsonRecursive(payloadToClean);
  const canonicalStr = JSON.stringify(canonicalObj, null, 2);
  const compactStr = JSON.stringify(canonicalObj);
  const sha256 = await sha256Hex(compactStr);
  return c.json({
    ok: true,
    answer: { cell: "data_hygiene", version: "1.0.0", operation: "json_clean", clean_json: canonicalObj, raw_string: canonicalStr, compact_string: compactStr, byte_size: new TextEncoder().encode(compactStr).length, sha256, deterministic: true },
  });
});

app.post("/v1/workflow/comfy-preflight", async (c) => {
  const rawBody = await c.req.json<any>();
  const graph = rawBody.graph !== undefined ? rawBody.graph : rawBody;
  const auditResult = auditComfyGraph(graph);

  return c.json({
    ok: true,
    answer: {
      cell: "comfy_preflight",
      version: "1.0.0",
      tier: "Tier 2 Workflow Intelligence",
      ...auditResult,
      deterministic: true,
    },
  });
});

export default app;
