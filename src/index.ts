import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

type Bindings = {
  PAY_TO?: string;
  NETWORK?: string;
  CHAIN_ID?: string;
  USDC?: string;
  BASE_RPC_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Default Base Mainnet Receiving Address
const DEFAULT_PAY_TO = "0xd38fe438F96C9E21AcdA8d3E9ecE8C4156157dc0";

const getPayTo = (envPayTo?: string): `0x${string}` => {
  if (envPayTo && envPayTo.startsWith("0x") && envPayTo.length === 42) {
    return envPayTo as `0x${string}`;
  }
  return DEFAULT_PAY_TO as `0x${string}`;
};

const getNetwork = (envNetwork?: string): "base" | "base-sepolia" => {
  if (envNetwork === "base-sepolia") return "base-sepolia";
  return "base";
};

const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

function createCdpFacilitator(apiKeyId: string, apiKeySecret: string) {
  const host = "api.cdp.coinbase.com";
  return {
    url: CDP_FACILITATOR_URL,
    async createAuthHeaders() {
      const [verifyJwt, settleJwt, supportedJwt] = await Promise.all([
        generateJwt({ apiKeyId, apiKeySecret, requestMethod: "POST", requestHost: host, requestPath: "/platform/v2/x402/verify" }),
        generateJwt({ apiKeyId, apiKeySecret, requestMethod: "POST", requestHost: host, requestPath: "/platform/v2/x402/settle" }),
        generateJwt({ apiKeyId, apiKeySecret, requestMethod: "GET", requestHost: host, requestPath: "/platform/v2/x402/supported" }),
      ]);
      const correlation = "sdkLanguage=typescript,source=cdp-sdk,sourceVersion=1.0.0";
      return {
        verify: { Authorization: `Bearer ${verifyJwt}`, "Correlation-Context": correlation },
        settle: { Authorization: `Bearer ${settleJwt}`, "Correlation-Context": correlation },
        supported: { Authorization: `Bearer ${supportedJwt}`, "Correlation-Context": correlation },
      };
    },
  };
}

// --- Cell 002 Helper: Fractional inches ---
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

// --- Cell 003 Helpers: JSON Hygiene ---
function stripNulls(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.filter((v) => v !== null).map(stripNulls);
  }
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

// --- Cell 004: ComfyUI Static Graph Audit Logic ---
const STANDARD_COMFY_NODES = new Set([
  "KSampler",
  "KSamplerAdvanced",
  "SamplerCustom",
  "BasicScheduler",
  "SDTurboScheduler",
  "DPMSolverMultistepScheduler",
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "unCLIPCheckpointLoader",
  "DiffusersLoader",
  "UNETLoader",
  "CLIPLoader",
  "DualCLIPLoader",
  "CLIPVisionLoader",
  "VAELoader",
  "ControlNetLoader",
  "LoraLoader",
  "LoraLoaderModelOnly",
  "CLIPTextEncode",
  "CLIPSetLastLayer",
  "CLIPVisionEncode",
  "ConditioningCombine",
  "ConditioningAverage",
  "ConditioningConcat",
  "ConditioningSetArea",
  "ConditioningSetAreaPercentage",
  "ConditioningSetMask",
  "ConditioningZeroOut",
  "ControlNetApply",
  "ControlNetApplyAdvanced",
  "EmptyLatentImage",
  "LatentFromBatch",
  "RepeatLatentBatch",
  "LatentUpscale",
  "LatentUpscaleBy",
  "LatentBlend",
  "LatentCrop",
  "LatentFlip",
  "LatentRotate",
  "SetLatentNoiseMask",
  "VAEDecode",
  "VAEEncode",
  "VAEDecodeTiled",
  "VAEEncodeTiled",
  "SaveImage",
  "PreviewImage",
  "LoadImage",
  "LoadImageMask",
  "ImageScale",
  "ImageScaleBy",
  "ImageInvert",
  "ImagePadForOutpaint",
  "ImageBatch",
  "ImageCrop",
  "ImageBlend",
  "ImageBlur",
  "ImageQuantize",
  "ModelMergeSimple",
  "ModelMergeBlocks",
  "ModelMergeSubtract",
  "ModelMergeAdd",
  "RescaleCFG",
]);

const STANDARD_SAMPLERS = new Set([
  "euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral",
  "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde",
  "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
  "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddim", "uni_pc", "uni_pc_bh2", "lcm"
]);

const STANDARD_SCHEDULERS = new Set([
  "normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"
]);

const REQUIRED_NODE_SLOTS: Record<string, string[]> = {
  KSampler: ["model", "positive", "negative", "latent_image"],
  KSamplerAdvanced: ["model", "positive", "negative", "latent_image"],
  CLIPTextEncode: ["clip"],
  VAEDecode: ["samples", "vae"],
  VAEEncode: ["pixels", "vae"],
};

interface ComfyIssue {
  code: string;
  message: string;
  node_id: string;
  severity: "high" | "medium" | "low";
}

function auditComfyGraph(
  graph: Record<string, any>,
  installedNodes?: string[]
): {
  valid: boolean;
  risk_score: number;
  unresolved_links: string[];
  missing_nodes: string[];
  issues: ComfyIssue[];
} {
  const knownNodes = new Set([...STANDARD_COMFY_NODES, ...(installedNodes || [])]);
  const nodeIds = new Set(Object.keys(graph).filter((k) => typeof graph[k] === "object" && graph[k] !== null));
  const issues: ComfyIssue[] = [];
  const missingNodes: string[] = [];
  const unresolvedLinks: string[] = [];
  let totalRisk = 0;

  for (const [nodeIdRaw, nodeData] of Object.entries(graph)) {
    const nodeId = String(nodeIdRaw);
    if (!nodeData || typeof nodeData !== "object") continue;

    const classType = nodeData.class_type || nodeData.type || "Unknown";
    const inputs = nodeData.inputs || {};

    // Rule 1: Missing custom node detection
    if (!knownNodes.has(classType)) {
      if (!missingNodes.includes(classType)) {
        missingNodes.push(classType);
      }
      issues.push({
        code: "MISSING_NODE",
        message: `Custom node class '${classType}' is not recognized or installed`,
        node_id: nodeId,
        severity: "high",
      });
      totalRisk += 30;
    }

    // Rule 2: Broken / dangling link references
    if (inputs && typeof inputs === "object") {
      for (const [inputKey, val] of Object.entries(inputs)) {
        if (Array.isArray(val) && val.length === 2 && typeof val[1] === "number") {
          const targetId = String(val[0]);
          if (!nodeIds.has(targetId)) {
            const linkRef = `${nodeId}.${inputKey} -> ${targetId}.${val[1]}`;
            if (!unresolvedLinks.includes(linkRef)) {
              unresolvedLinks.push(linkRef);
            }
            issues.push({
              code: "DANGLING_LINK",
              message: `Input '${inputKey}' references non-existent node '${targetId}'`,
              node_id: nodeId,
              severity: "high",
            });
            totalRisk += 40;
          }
        }
      }
    }

    // Rule 3: Missing required slot / connection validation
    if (inputs && typeof inputs === "object") {
      for (const [inputKey, val] of Object.entries(inputs)) {
        if (val === null || (Array.isArray(val) && val.length === 0)) {
          issues.push({
            code: "UNLINKED_INPUT",
            message: `Required input '${inputKey}' is unlinked or null`,
            node_id: nodeId,
            severity: "high",
          });
          totalRisk += 20;
        }
      }

      if (classType === "CheckpointLoaderSimple") {
        const ckpt = inputs.ckpt_name;
        if (!ckpt || typeof ckpt !== "string" || ckpt.trim() === "") {
          issues.push({
            code: "INVALID_CHECKPOINT",
            message: "CheckpointLoaderSimple missing required ckpt_name",
            node_id: nodeId,
            severity: "high",
          });
          totalRisk += 25;
        }
      }

      if (REQUIRED_NODE_SLOTS[classType]) {
        for (const reqSlot of REQUIRED_NODE_SLOTS[classType]) {
          if (inputs[reqSlot] === undefined || inputs[reqSlot] === null) {
            const alreadyFlagged = issues.some((i) => i.node_id === nodeId && i.message.includes(`'${reqSlot}'`));
            if (!alreadyFlagged) {
              issues.push({
                code: "UNLINKED_INPUT",
                message: `${classType} missing required '${reqSlot}' slot input`,
                node_id: nodeId,
                severity: "high",
              });
              totalRisk += 20;
            }
          }
        }
      }
    }

    // Rule 4: Parameter boundary risk scoring
    if (inputs && typeof inputs === "object") {
      if (classType === "KSampler" || classType === "KSamplerAdvanced") {
        if (inputs.steps !== undefined) {
          const steps = inputs.steps;
          if (typeof steps !== "number" || steps < 1 || !Number.isInteger(steps) || steps > 1000) {
            issues.push({
              code: "INVALID_MODEL_PARAMETER",
              message: "KSampler steps must be an integer >= 1 (1-1000)",
              node_id: nodeId,
              severity: "high",
            });
            totalRisk += 20;
          }
        }

        if (inputs.cfg !== undefined) {
          const cfg = inputs.cfg;
          if (typeof cfg !== "number" || cfg < 0 || cfg > 100) {
            issues.push({
              code: "INVALID_MODEL_PARAMETER",
              message: "KSampler cfg must be a number >= 0 (0-100)",
              node_id: nodeId,
              severity: "high",
            });
            totalRisk += 20;
          }
        }

        if (inputs.sampler_name && typeof inputs.sampler_name === "string") {
          if (!STANDARD_SAMPLERS.has(inputs.sampler_name.toLowerCase())) {
            issues.push({
              code: "INVALID_SAMPLER",
              message: `Non-standard sampler '${inputs.sampler_name}'`,
              node_id: nodeId,
              severity: "medium",
            });
            totalRisk += 10;
          }
        }

        if (inputs.scheduler && typeof inputs.scheduler === "string") {
          if (!STANDARD_SCHEDULERS.has(inputs.scheduler.toLowerCase())) {
            issues.push({
              code: "INVALID_SCHEDULER",
              message: `Non-standard scheduler '${inputs.scheduler}'`,
              node_id: nodeId,
              severity: "medium",
            });
            totalRisk += 10;
          }
        }
      } else if (classType === "EmptyLatentImage") {
        const width = inputs.width;
        const height = inputs.height;
        if (width !== undefined && (typeof width !== "number" || width < 64 || width > 8192 || width % 8 !== 0)) {
          issues.push({
            code: "INVALID_LATENT_DIMENSION",
            message: `EmptyLatentImage width (${width}) must be a multiple of 8 within [64, 8192]`,
            node_id: nodeId,
            severity: "medium",
          });
          totalRisk += 15;
        }
        if (height !== undefined && (typeof height !== "number" || height < 64 || height > 8192 || height % 8 !== 0)) {
          issues.push({
            code: "INVALID_LATENT_DIMENSION",
            message: `EmptyLatentImage height (${height}) must be a multiple of 8 within [64, 8192]`,
            node_id: nodeId,
            severity: "medium",
          });
          totalRisk += 15;
        }
        if (inputs.batch_size !== undefined) {
          const bSize = inputs.batch_size;
          if (typeof bSize !== "number" || bSize < 1 || !Number.isInteger(bSize)) {
            issues.push({
              code: "INVALID_BATCH_SIZE",
              message: "EmptyLatentImage batch_size must be >= 1",
              node_id: nodeId,
              severity: "high",
            });
            totalRisk += 15;
          }
        }
      }
    }
  }

  const isValid = issues.length === 0;
  const finalRisk = isValid ? 0 : Math.min(100, Math.max(10, totalRisk));

  return {
    valid: isValid,
    risk_score: finalRisk,
    unresolved_links: unresolvedLinks,
    missing_nodes: missingNodes,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Global Middleware: 512KB Limit Guardrail
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength, 10) > 524288) {
    return c.json(
      {
        ok: false,
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Payload exceeds 512KB limit",
          expected_schema: {},
        },
      },
      413
    );
  }
  await next();
});

// ---------------------------------------------------------------------------
// Discovery: GET /.well-known/x402.json
// ---------------------------------------------------------------------------
app.get("/.well-known/x402.json", (c) => {
  const net = getNetwork(c.env?.NETWORK);
  const chainId = net === "base" ? 8453 : 84532;
  const asset = net === "base" ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  return c.json({
    version: "1.0.0",
    network: net,
    chain_id: chainId,
    asset: asset,
    pay_to: getPayTo(c.env?.PAY_TO),
    services: [
      { cell: "001", name: "Media Geometry", route: "/v1/media-geometry", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "002", name: "Geometric Measurement", route: "/v1/geometry/measurement", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "003", name: "JSON Hygiene", route: "/v1/data/json-clean", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "004", name: "ComfyUI Preflight Risk", route: "/v1/workflow/comfy-preflight", price_atomic: 20000, price_usdc: 0.020 },
    ],
  });
});

// ---------------------------------------------------------------------------
// Payment Middleware (CDP Facilitator for Base Mainnet & Testnet)
// ---------------------------------------------------------------------------
app.use(
  "/v1/*",
  async (c, next) => {
    const payTo = getPayTo(c.env?.PAY_TO);
    const network = getNetwork(c.env?.NETWORK);

    let facilitator: any;
    if (c.env?.CDP_API_KEY_ID && c.env?.CDP_API_KEY_SECRET) {
      facilitator = createCdpFacilitator(c.env.CDP_API_KEY_ID, c.env.CDP_API_KEY_SECRET);
    } else {
      facilitator = { url: "https://x402.org/facilitator" };
    }

    return paymentMiddleware(
      payTo,
      {
        "/v1/media-geometry": {
          price: "$0.003",
          network: network,
          config: {
            description: "Cell 001 deterministic media geometry engine",
            mimeType: "application/json",
          },
        },
        "/v1/geometry/measurement": {
          price: "$0.003",
          network: network,
          config: {
            description: "Cell 002 deterministic geometric measurement engine",
            mimeType: "application/json",
          },
        },
        "/v1/data/json-clean": {
          price: "$0.003",
          network: network,
          config: {
            description: "Cell 003 deterministic data hygiene engine",
            mimeType: "application/json",
          },
        },
        "/v1/workflow/comfy-preflight": {
          price: "$0.02",
          network: network,
          config: {
            description: "Cell 004 ComfyUI workflow preflight static risk engine",
            mimeType: "application/json",
          },
        },
      },
      facilitator
    )(c, next);
  }
);

// ---------------------------------------------------------------------------
// Cell 001: Media Geometry Route
// ---------------------------------------------------------------------------
app.post("/v1/media-geometry", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "MALFORMED_JSON",
          message: `Invalid JSON payload: ${e.message}`,
          expected_schema: { source: { width: 1920, height: 1080 }, target: { width: 1080, height: 1080 } },
        },
      },
      400
    );
  }

  const sw = body?.source?.width;
  const sh = body?.source?.height;
  const tw = body?.target?.width;
  const th = body?.target?.height;

  if (![sw, sh, tw, th].every(Number.isInteger) || [sw, sh, tw, th].some((n) => n <= 0)) {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_DIMENSIONS",
          message: "dimensions must be positive integers",
          expected_schema: { source: { width: 1920, height: 1080 }, target: { width: 1080, height: 1080 } },
        },
      },
      400
    );
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
    cell: "media_geometry",
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
      padding:
        mode === "contain"
          ? { left, top, right: Math.max(0, padX - left), bottom: Math.max(0, padY - top) }
          : { left: 0, top: 0, right: 0, bottom: 0 },
      anchor,
      deterministic: true,
    },
    meta: {
      deterministic: true,
      version: "1.0.0",
    },
  });
});

// ---------------------------------------------------------------------------
// Cell 002: Geometric Measurement Route
// ---------------------------------------------------------------------------
app.post("/v1/geometry/measurement", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "MALFORMED_JSON",
          message: `Invalid JSON payload: ${e.message}`,
          expected_schema: { operation: "diagonal | pitch_angle | area" },
        },
      },
      400
    );
  }

  const op = body?.operation;
  if (op === "diagonal") {
    if (
      !body.dimensions ||
      typeof body.dimensions.width !== "number" ||
      typeof body.dimensions.length !== "number" ||
      body.dimensions.width <= 0 ||
      body.dimensions.length <= 0
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: "INVALID_DIMENSIONS",
            message: "dimensions.width and dimensions.length must be positive numbers",
            expected_schema: { operation: "diagonal", dimensions: { width: 20, length: 22, unit: "feet" } },
          },
        },
        400
      );
    }
    const unit = body.dimensions.unit ?? "feet";
    const scaleToInches: Record<string, number> = { feet: 12.0, inches: 1.0, mm: 1.0 / 25.4, cm: 1.0 / 2.54 };
    const scale = scaleToInches[unit] ?? 12.0;
    const wIn = body.dimensions.width * scale;
    const lIn = body.dimensions.length * scale;
    const diagIn = Math.sqrt(wIn * wIn + lIn * lIn);
    const diagNative = Math.sqrt(body.dimensions.width ** 2 + body.dimensions.length ** 2);
    return c.json({
      ok: true,
      cell: "geometric_measurement",
      answer: {
        cell: "geometric_measurement",
        version: "1.0.0",
        operation: "diagonal",
        input: body.dimensions,
        diagonal_exact: Number(diagNative.toFixed(10)),
        diagonal_inches: Number(diagIn.toFixed(6)),
        fractional_formatted: formatFractionalInches(diagIn),
        deterministic: true,
      },
      meta: {
        deterministic: true,
        version: "1.0.0",
      },
    });
  }

  if (op === "pitch_angle") {
    if (
      !body.pitch ||
      typeof body.pitch.rise !== "number" ||
      body.pitch.rise < 0 ||
      (body.pitch.run !== undefined && (typeof body.pitch.run !== "number" || body.pitch.run <= 0))
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: "INVALID_PITCH",
            message: "pitch.rise must be >= 0 and pitch.run must be > 0",
            expected_schema: { operation: "pitch_angle", pitch: { rise: 3, run: 12 } },
          },
        },
        400
      );
    }
    const rise = body.pitch.rise;
    const run = body.pitch.run ?? 12.0;
    const rad = Math.atan(rise / run);
    const deg = (rad * 180) / Math.PI;
    const hyp = Math.sqrt(rise * rise + run * run);
    const slopeMultiplier = hyp / run;
    return c.json({
      ok: true,
      cell: "geometric_measurement",
      answer: {
        cell: "geometric_measurement",
        version: "1.0.0",
        operation: "pitch_angle",
        input: { rise, run },
        angle_degrees: Number(deg.toFixed(6)),
        angle_radians: Number(rad.toFixed(8)),
        pitch_ratio: `${rise.toFixed(2)}:${run.toFixed(2)}`,
        slope_multiplier: Number(slopeMultiplier.toFixed(6)),
        deterministic: true,
      },
      meta: {
        deterministic: true,
        version: "1.0.0",
      },
    });
  }

  if (op === "area") {
    if (
      !body.dimensions ||
      typeof body.dimensions.width !== "number" ||
      typeof body.dimensions.length !== "number" ||
      body.dimensions.width <= 0 ||
      body.dimensions.length <= 0
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: "INVALID_DIMENSIONS",
            message: "dimensions.width and dimensions.length must be positive numbers",
            expected_schema: { operation: "area", dimensions: { width: 20, length: 22, unit: "feet" } },
          },
        },
        400
      );
    }
    const unit = body.dimensions.unit ?? "feet";
    const scaleToFeet: Record<string, number> = { feet: 1.0, inches: 1.0 / 12.0, mm: 1.0 / 304.8, cm: 1.0 / 30.48 };
    const scale = scaleToFeet[unit] ?? 1.0;
    const wFt = body.dimensions.width * scale;
    const lFt = body.dimensions.length * scale;
    const sqFt = wFt * lFt;
    const sqM = sqFt * 0.09290304;
    const sqIn = sqFt * 144.0;
    return c.json({
      ok: true,
      cell: "geometric_measurement",
      answer: {
        cell: "geometric_measurement",
        version: "1.0.0",
        operation: "area",
        input: body.dimensions,
        area_native: Number((body.dimensions.width * body.dimensions.length).toFixed(6)),
        area_sq_ft: Number(sqFt.toFixed(6)),
        area_sq_meters: Number(sqM.toFixed(6)),
        area_sq_inches: Number(sqIn.toFixed(2)),
        deterministic: true,
      },
      meta: {
        deterministic: true,
        version: "1.0.0",
      },
    });
  }

  return c.json(
    {
      ok: false,
      error: {
        code: "INVALID_OPERATION",
        message: "operation must be one of: 'diagonal', 'pitch_angle', 'area'",
        expected_schema: { operation: "diagonal | pitch_angle | area" },
      },
    },
    400
  );
});

// ---------------------------------------------------------------------------
// Cell 003: Data Hygiene Route
// ---------------------------------------------------------------------------
app.post("/v1/data/json-clean", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "MALFORMED_JSON",
          message: `Invalid JSON payload: ${e.message}`,
          expected_schema: { raw_payload: "string", strip_null_values: true },
        },
      },
      400
    );
  }

  let targetObj: any;
  if (body?.raw_payload !== undefined) {
    if (typeof body.raw_payload === "string" && body.raw_payload.length > 524288) {
      return c.json(
        {
          ok: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "raw_payload exceeds 512KB limit",
            expected_schema: {},
          },
        },
        413
      );
    }
    let rawText = String(body.raw_payload).trim();
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      rawText = fenceMatch[1].trim();
    }
    rawText = rawText.replace(/,\s*([\]}])/g, "$1");
    try {
      targetObj = JSON.parse(rawText);
    } catch (e: any) {
      return c.json(
        {
          ok: false,
          error: {
            code: "MALFORMED_JSON",
            message: `JSON parse error: ${e.message}`,
            expected_schema: { raw_payload: "string" },
          },
        },
        400
      );
    }
  } else if (body?.json_object !== undefined) {
    targetObj = body.json_object;
  } else if (body?.data !== undefined) {
    targetObj = body.data;
  } else if (typeof body === "object" && body !== null && Object.keys(body).length > 0) {
    targetObj = body;
  } else {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_PARAMETERS",
          message: "Must provide either raw_payload (string) or json_object",
          expected_schema: { raw_payload: "string", json_object: "object" },
        },
      },
      400
    );
  }

  if (body?.strip_null_values) {
    targetObj = stripNulls(targetObj);
  }
  if (body?.flatten_keys && typeof targetObj === "object" && targetObj !== null && !Array.isArray(targetObj)) {
    targetObj = flattenObject(targetObj);
  }

  return c.json({
    ok: true,
    cell: "data_hygiene",
    answer: {
      cell: "data_hygiene",
      version: "1.0.0",
      operation: "json_clean",
      cleaned_data: targetObj,
      canonical_json_string: JSON.stringify(targetObj),
      deterministic: true,
    },
    meta: {
      deterministic: true,
      version: "1.0.0",
    },
  });
});

// ---------------------------------------------------------------------------
// Cell 004: ComfyUI Workflow Preflight Route
// ---------------------------------------------------------------------------
app.post("/v1/workflow/comfy-preflight", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "MALFORMED_JSON",
          message: `Invalid JSON payload: ${e.message}`,
          expected_schema: { prompt: { "<node_id>": { class_type: "string", inputs: {} } } },
        },
      },
      400
    );
  }

  let graph: Record<string, any> = {};
  if (body && typeof body === "object") {
    if (body.prompt && typeof body.prompt === "object") {
      graph = body.prompt;
    } else if (body.graph && typeof body.graph === "object") {
      graph = body.graph;
    } else if (body.workflow && typeof body.workflow === "object") {
      graph = body.workflow;
    } else if (Array.isArray(body.nodes)) {
      for (const n of body.nodes) {
        if (n && n.id !== undefined) {
          graph[String(n.id)] = n;
        }
      }
    } else {
      graph = body;
    }
  }

  if (!graph || typeof graph !== "object" || Object.keys(graph).length === 0) {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_WORKFLOW",
          message: "Workflow must contain a non-empty node graph dictionary",
          expected_schema: { prompt: { "<node_id>": { class_type: "string", inputs: {} } } },
        },
      },
      400
    );
  }

  const audit = auditComfyGraph(graph, body?.installed_nodes);

  return c.json({
    ok: true,
    cell: "comfy_preflight",
    answer: {
      valid: audit.valid,
      risk_score: audit.risk_score,
      unresolved_links: audit.unresolved_links,
      missing_nodes: audit.missing_nodes,
      issues: audit.issues,
    },
    meta: {
      deterministic: true,
      version: "1.0.0",
    },
  });
});

export default app;
