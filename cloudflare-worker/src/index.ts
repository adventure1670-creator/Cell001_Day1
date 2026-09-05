import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

import { resolveNetworkConfig, type ValidatedNetworkConfig } from "./networkConfig";

export { resolveNetworkConfig };
export type { ValidatedNetworkConfig };

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

// --- Cell 005 Helpers: Latent Grid Snap ---
const SDXL_BUCKETS: [number, number][] = [
  [1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216],
  [1344, 768], [768, 1344], [1536, 640], [640, 1536]
];

const FLUX_BUCKETS: [number, number][] = [
  [1024, 1024], [1088, 960], [960, 1088], [1152, 896], [896, 1152],
  [1216, 832], [832, 1216], [1280, 768], [768, 1280], [1344, 768],
  [768, 1344], [1408, 704], [704, 1408], [1472, 704], [704, 1472],
  [1536, 640], [640, 1536]
];

function snapToMultiple(val: number, multiple: number, minVal = 64, maxVal = 16384): number {
  const snapped = Math.round(val / multiple) * multiple;
  return Math.max(minVal, Math.min(maxVal, snapped));
}

function findClosestBucket(targetAspect: number, buckets: [number, number][]): [number, number] {
  let best = buckets[0];
  let bestDiff = Math.abs(best[0] / best[1] - targetAspect);
  for (const b of buckets) {
    const diff = Math.abs(b[0] / b[1] - targetAspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = b;
    }
  }
  return best;
}

// --- Cell 006 Helpers: JSON Auto-Repair ---
function repairJsonString(rawInput: string): { repaired: boolean; repairs_applied: string[]; parsed_json: any; canonical_string: string } {
  let text = rawInput.trim();
  const repairs: string[] = [];

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
    repairs.push("STRIP_CODE_FENCES");
  }

  try {
    const parsed = JSON.parse(text);
    return {
      repaired: repairs.length > 0,
      repairs_applied: repairs,
      parsed_json: parsed,
      canonical_string: JSON.stringify(parsed),
    };
  } catch {}

  const litReplaced = text
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  if (litReplaced !== text) {
    text = litReplaced;
    repairs.push("NORMALIZE_PYTHON_LITERALS");
  }

  const strippedComments = text.replace(/\/\/.*?\n|\/\*.*?\*\//g, "").trim();
  if (strippedComments !== text) {
    text = strippedComments;
    repairs.push("REMOVE_COMMENTS");
  }

  if (text.includes("'")) {
    let sq = text
      .replace(/([\{\,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
      .replace(/(:\s*)'([^']*)'/g, '$1"$2"')
      .replace(/([\[\,]\s*)'([^']*)'(\s*[\,\]])/g, '$1"$2"$3')
      .replace(/([\[\,]\s*)'([^']*)'(\s*[\,\]])/g, '$1"$2"$3');
    if (sq !== text) {
      text = sq;
      repairs.push("CONVERT_SINGLE_QUOTES");
    }
  }

  const unquoted = text.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_\-]*)\s*:/g, '$1"$2":');
  if (unquoted !== text) {
    text = unquoted;
    repairs.push("QUOTE_UNQUOTED_KEYS");
  }

  const trailing = text.replace(/,\s*([\]}])/g, "$1");
  if (trailing !== text) {
    text = trailing;
    repairs.push("REMOVE_TRAILING_COMMAS");
  }

  try {
    const parsed = JSON.parse(text);
    return {
      repaired: true,
      repairs_applied: repairs,
      parsed_json: parsed,
      canonical_string: JSON.stringify(parsed),
    };
  } catch {}

  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let reconstructed = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      reconstructed += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      reconstructed += char;
      if (inString) escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      reconstructed += char;
      continue;
    }
    if (inString) {
      reconstructed += char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      reconstructed += char;
    } else if (char === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === "{") stack.pop();
      reconstructed += char;
    } else if (char === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === "[") stack.pop();
      reconstructed += char;
    } else {
      reconstructed += char;
    }
  }

  let fixedTail = reconstructed;
  if (inString) {
    fixedTail += '"';
    repairs.push("CLOSE_UNTERMINATED_STRING");
  }

  fixedTail = fixedTail.trim().replace(/,\s*$/, "");
  if (stack.length > 0) {
    repairs.push("CLOSE_UNCLOSED_STRUCTURES");
    while (stack.length > 0) {
      const opener = stack.pop();
      if (opener === "{") fixedTail += "}";
      else if (opener === "[") fixedTail += "]";
    }
  }

  fixedTail = fixedTail.replace(/,\s*([\]}])/g, "$1");
  const finalParsed = JSON.parse(fixedTail);
  return {
    repaired: true,
    repairs_applied: repairs,
    parsed_json: finalParsed,
    canonical_string: JSON.stringify(finalParsed),
  };
}

// --- Cell 007 Helpers: Color Math ---
function parseColorToRgb(colorInput: any): [number, number, number] {
  if (typeof colorInput === "object" && colorInput !== null) {
    if (Array.isArray(colorInput) && colorInput.length >= 3) {
      return [
        Math.max(0, Math.min(255, Number(colorInput[0]))),
        Math.max(0, Math.min(255, Number(colorInput[1]))),
        Math.max(0, Math.min(255, Number(colorInput[2])))
      ];
    }
    const r = Number(colorInput.r ?? colorInput.red ?? 0);
    const g = Number(colorInput.g ?? colorInput.green ?? 0);
    const b = Number(colorInput.b ?? colorInput.blue ?? 0);
    return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
  }

  if (typeof colorInput === "string") {
    const c = colorInput.trim();
    const hexMatch = c.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (hexMatch) {
      const h = hexMatch[1];
      if (h.length === 3) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
      } else {
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
    }

    const rgbMatch = c.match(/^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (rgbMatch) {
      return [
        Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10))),
        Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10))),
        Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)))
      ];
    }

    const hslMatch = c.match(/^hsla?\s*\(\s*([\d\.]+)\s*,\s*([\d\.]+)%?\s*,\s*([\d\.]+)%?/i);
    if (hslMatch) {
      const h = parseFloat(hslMatch[1]) % 360;
      const s = parseFloat(hslMatch[2]) / 100;
      const l = parseFloat(hslMatch[3]) / 100;
      return hslToRgb(h, s, l);
    }
  }
  throw new Error(`Invalid color representation: ${JSON.stringify(colorInput)}`);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= h && h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (60 <= h && h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (120 <= h && h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (180 <= h && h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (240 <= h && h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Number(h.toFixed(2)), s: Number((s * 100).toFixed(2)), l: Number((l * 100).toFixed(2)) };
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / max;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Number(h.toFixed(2)), s: Number((s * 100).toFixed(2)), v: Number((v * 100).toFixed(2)) };
}

function rgbToCmyk(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return {
    c: Number((c * 100).toFixed(2)),
    m: Number((m * 100).toFixed(2)),
    y: Number((y * 100).toFixed(2)),
    k: Number((k * 100).toFixed(2))
  };
}

function calculateRelativeLuminance(r: number, g: number, b: number): number {
  const linear = (c: number) => {
    const norm = c / 255;
    return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// --- Cell 008 Helpers: Prompt Token & Weight Normalizer ---
function parseTagWeight(rawTag: string): { text: string; weight: number; detected_syntax: string } {
  const tag = rawTag.trim();
  if (!tag) return { text: "", weight: 1.0, detected_syntax: "plain" };

  const mjMatch = tag.match(/^(.+?)::([0-9\.\-]+)$/);
  if (mjMatch) {
    const w = parseFloat(mjMatch[2]);
    if (!isNaN(w)) return { text: mjMatch[1].trim(), weight: Number(w.toFixed(4)), detected_syntax: "midjourney" };
  }

  const explicitMatch = tag.match(/^\((.+?):([0-9\.\-]+)\)$/);
  if (explicitMatch) {
    const w = parseFloat(explicitMatch[2]);
    if (!isNaN(w)) return { text: explicitMatch[1].trim(), weight: Number(w.toFixed(4)), detected_syntax: "explicit_weight" };
  }

  if (tag.startsWith("(") && tag.endsWith(")")) {
    let open = 0, close = 0;
    while (open < tag.length && tag[open] === "(") open++;
    while (close < tag.length && tag[tag.length - 1 - close] === ")") close++;
    const depth = Math.min(open, close);
    const inner = tag.slice(depth, tag.length - depth).trim();
    const weight = Number(Math.pow(1.1, depth).toFixed(4));
    return { text: inner, weight, detected_syntax: "nested_parentheses" };
  }

  if (tag.startsWith("[") && tag.endsWith("]")) {
    let open = 0, close = 0;
    while (open < tag.length && tag[open] === "[") open++;
    while (close < tag.length && tag[tag.length - 1 - close] === "]") close++;
    const depth = Math.min(open, close);
    const inner = tag.slice(depth, tag.length - depth).trim();
    const weight = Number(Math.pow(1.0 / 1.1, depth).toFixed(4));
    return { text: inner, weight, detected_syntax: "square_brackets" };
  }

  if (tag.startsWith("{") && tag.endsWith("}")) {
    let open = 0, close = 0;
    while (open < tag.length && tag[open] === "{") open++;
    while (close < tag.length && tag[tag.length - 1 - close] === "}") close++;
    const depth = Math.min(open, close);
    const inner = tag.slice(depth, tag.length - depth).trim();
    const weight = Number(Math.pow(1.05, depth).toFixed(4));
    return { text: inner, weight, detected_syntax: "curly_braces" };
  }

  return { text: tag, weight: 1.0, detected_syntax: "plain" };
}

function estimateClipTokens(text: string): number {
  const matches = text.match(/\w+|[^\w\s]/g) || [];
  let count = 0;
  for (const m of matches) {
    if (m.length > 6 && /^[a-zA-Z]+$/.test(m)) {
      count += Math.ceil(m.length / 4);
    } else {
      count += 1;
    }
  }
  return count + 2;
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
  const cfg = resolveNetworkConfig(c.env);
  return c.json({
    version: "1.0.0",
    network: cfg.network,
    chain_id: Number(cfg.chainId),
    asset: cfg.usdc,
    pay_to: cfg.payTo,
    services: [
      { cell: "001", name: "Media Geometry", route: "/v1/media-geometry", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "002", name: "Geometric Measurement", route: "/v1/geometry/measurement", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "003", name: "JSON Hygiene", route: "/v1/data/json-clean", price_atomic: 3000, price_usdc: 0.003 },
      { cell: "004", name: "ComfyUI Preflight Risk", route: "/v1/workflow/comfy-preflight", price_atomic: 20000, price_usdc: 0.020 },
      { cell: "005", name: "Latent Grid Snap", route: "/v1/media/latent-snap", price_atomic: 5000, price_usdc: 0.005 },
      { cell: "006", name: "JSON Auto-Repair", route: "/v1/data/json-repair", price_atomic: 10000, price_usdc: 0.010 },
      { cell: "007", name: "Color Math & Luminance", route: "/v1/media/color-math", price_atomic: 5000, price_usdc: 0.005 },
      { cell: "008", name: "Prompt Token & Weight Normalizer", route: "/v1/ai/prompt-weight", price_atomic: 5000, price_usdc: 0.005 },
    ],
  });
});

// ---------------------------------------------------------------------------
// Payment Middleware (CDP Facilitator for Base Mainnet & Testnet)
// ---------------------------------------------------------------------------
app.use(
  "/v1/*",
  async (c, next) => {
    const cfg = resolveNetworkConfig(c.env);
    const payTo = cfg.payTo as `0x${string}`;
    const network = cfg.network as "base" | "base-sepolia";
    const usdc = cfg.usdc as `0x${string}`;

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
            asset: usdc,
          },
        },
        "/v1/geometry/measurement": {
          price: "$0.003",
          network: network,
          config: {
            description: "Cell 002 deterministic geometric measurement engine",
            mimeType: "application/json",
            asset: usdc,
          },
        },
        "/v1/data/json-clean": {
          price: "$0.003",
          network: network,
          config: {
            description: "Cell 003 deterministic data hygiene engine",
            mimeType: "application/json",
            asset: usdc,
          },
        },
        "/v1/workflow/comfy-preflight": {
          price: "$0.02",
          network: network,
          config: {
            description: "Cell 004 ComfyUI workflow preflight static risk engine",
            mimeType: "application/json",
            asset: usdc,
          },
        },
        "/v1/media/latent-snap": {
          price: "$0.005",
          network: network,
          config: {
            description: "Cell 005 deterministic latent grid snap engine for FLUX/SDXL/Wan2.1",
            mimeType: "application/json",
            asset: usdc,
          },
        },
        "/v1/data/json-repair": {
          price: "$0.01",
          network: network,
          config: {
            description: "Cell 006 deterministic JSON auto-repair engine",
            mimeType: "application/json",
            asset: usdc,
          },
        },
        "/v1/media/color-math": {
          price: "$0.005",
          network: network,
          config: {
            description: "Cell 007 deterministic color math & WCAG luminance engine",
            mimeType: "application/json",
            asset: usdc,
          },
        },
        "/v1/ai/prompt-weight": {
          price: "$0.005",
          network: network,
          config: {
            description: "Cell 008 deterministic prompt token & weight normalizer",
            mimeType: "application/json",
            asset: usdc,
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

// ---------------------------------------------------------------------------
// Cell 005: Latent Grid Snap Route
// ---------------------------------------------------------------------------
app.post("/v1/media/latent-snap", async (c) => {
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
          expected_schema: { width: 1920, height: 1080, target_model: "flux | sdxl | wan2.1 | generic" },
        },
      },
      400
    );
  }

  const width = Number(body?.width);
  const height = Number(body?.height);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_DIMENSIONS",
          message: "width and height must be positive integers",
          expected_schema: { width: 1920, height: 1080, target_model: "flux | sdxl | wan2.1 | generic" },
        },
      },
      400
    );
  }

  const targetModel = body?.target_model ?? "generic";
  const step = [8, 16, 32, 64, 128].includes(Number(body?.bucket_step)) ? Number(body.bucket_step) : 64;
  const preserveAspect = body?.preserve_aspect ?? true;
  const sourceAspect = width / height;

  const snapW8 = snapToMultiple(width, 8);
  const snapH8 = snapToMultiple(height, 8);
  const snapW64 = snapToMultiple(width, step);
  const snapH64 = snapToMultiple(height, step);

  const sdxlBucket = findClosestBucket(sourceAspect, SDXL_BUCKETS);
  const fluxBucket = findClosestBucket(sourceAspect, FLUX_BUCKETS);
  const wanW = snapToMultiple(width, 16);
  const wanH = snapToMultiple(height, 16);

  const snappedAspect = snapW64 / snapH64;
  const aspectDeltaPercent = (Math.abs(snappedAspect - sourceAspect) / sourceAspect) * 100.0;
  const latentW64 = snapW64 / 8;
  const latentH64 = snapH64 / 8;
  const totalLatentPixels = latentW64 * latentH64;
  const latentPatches2x2 = Math.floor(totalLatentPixels / 4);

  return c.json({
    ok: true,
    cell: "latent_grid_snap",
    answer: {
      cell: "latent_grid_snap",
      version: "1.0.0",
      operation: "latent_grid_snap",
      input: {
        width,
        height,
        target_model: targetModel,
        bucket_step: step,
        preserve_aspect: preserveAspect,
      },
      source_aspect_decimal: Number(sourceAspect.toFixed(6)),
      snapped_8x: {
        width: snapW8,
        height: snapH8,
        latent_width: snapW8 / 8,
        latent_height: snapH8 / 8,
        divisible_by_8: true,
      },
      snapped_64x: {
        width: snapW64,
        height: snapH64,
        latent_width: latentW64,
        latent_height: latentH64,
        divisible_by_64: true,
      },
      optimal_sdxl_bucket: {
        width: sdxlBucket[0],
        height: sdxlBucket[1],
        aspect_ratio: `${sdxlBucket[0]}:${sdxlBucket[1]}`,
        total_pixels: sdxlBucket[0] * sdxlBucket[1],
      },
      optimal_flux_bucket: {
        width: fluxBucket[0],
        height: fluxBucket[1],
        aspect_ratio: `${fluxBucket[0]}:${fluxBucket[1]}`,
        total_pixels: fluxBucket[0] * fluxBucket[1],
      },
      optimal_wan_bucket: {
        width: wanW,
        height: wanH,
        divisible_by_16: true,
        total_pixels: wanW * wanH,
      },
      snapped_aspect_decimal: Number(snappedAspect.toFixed(6)),
      aspect_delta_percent: Number(aspectDeltaPercent.toFixed(4)),
      total_pixels: snapW64 * snapH64,
      latent_patches_2x2: latentPatches2x2,
      deterministic: true,
    },
    meta: {
      deterministic: true,
      version: "1.0.0",
    },
  });
});

// ---------------------------------------------------------------------------
// Cell 006: JSON Auto-Repair Route
// ---------------------------------------------------------------------------
app.post("/v1/data/json-repair", async (c) => {
  let rawText = "";

  try {
    const rawBody = await c.req.text();
    if (rawBody.length > 524288) {
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

    try {
      const body = JSON.parse(rawBody);
      if (typeof body === "string") {
        rawText = body;
      } else if (body?.raw_payload !== undefined) {
        rawText = String(body.raw_payload);
      } else if (body?.json_string !== undefined) {
        rawText = String(body.json_string);
      } else if (body?.text !== undefined) {
        rawText = String(body.text);
      } else {
        rawText = rawBody;
      }
    } catch {
      rawText = rawBody;
    }
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "MALFORMED_REQUEST",
          message: `Unable to read request payload: ${e.message}`,
          expected_schema: { raw_payload: "string" },
        },
      },
      400
    );
  }

  if (!rawText.trim()) {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_PARAMETERS",
          message: "Must provide a non-empty string payload to repair",
          expected_schema: { raw_payload: "string" },
        },
      },
      400
    );
  }

  try {
    const repairResult = repairJsonString(rawText);
    return c.json({
      ok: true,
      cell: "json_auto_repair",
      answer: {
        cell: "json_auto_repair",
        version: "1.0.0",
        operation: "json_repair",
        repaired: repairResult.repaired,
        repairs_applied: repairResult.repairs_applied,
        repaired_json: repairResult.parsed_json,
        canonical_json_string: repairResult.canonical_string,
        deterministic: true,
      },
      meta: {
        deterministic: true,
        version: "1.0.0",
      },
    });
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "UNREPAIRABLE_JSON",
          message: `Deterministic repair failed: ${e.message}`,
          expected_schema: { raw_payload: "string" },
        },
      },
      400
    );
  }
});

// ---------------------------------------------------------------------------
// Cell 007: Color Math & Luminance Route
// ---------------------------------------------------------------------------
app.post("/v1/media/color-math", async (c) => {
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
          expected_schema: { color: "#3B82F6", compare_color: "#FFFFFF" },
        },
      },
      400
    );
  }

  const primaryInput = body?.color ?? body?.foreground ?? body?.primary ?? body;
  let primaryRgb: [number, number, number];
  try {
    primaryRgb = parseColorToRgb(primaryInput);
  } catch (e: any) {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_COLOR",
          message: `Failed to parse primary color: ${e.message}`,
          expected_schema: { color: "#3B82F6" },
        },
      },
      400
    );
  }

  const [r, g, b] = primaryRgb;
  const hex = rgbToHex(r, g, b);
  const hsl = rgbToHsl(r, g, b);
  const hsv = rgbToHsv(r, g, b);
  const cmyk = rgbToCmyk(r, g, b);
  const lum = calculateRelativeLuminance(r, g, b);

  const answer: Record<string, any> = {
    cell: "color_math",
    version: "1.0.0",
    operation: "color_math",
    primary: {
      hex,
      rgb: { r, g, b },
      hsl,
      hsv,
      cmyk,
      relative_luminance: Number(lum.toFixed(6)),
      is_dark: lum < 0.179,
    },
    deterministic: true,
  };

  const compareInput = body?.compare_color ?? body?.background ?? body?.secondary;
  if (compareInput !== undefined && compareInput !== null) {
    try {
      const [crR, crG, crB] = parseColorToRgb(compareInput);
      const crHex = rgbToHex(crR, crG, crB);
      const crLum = calculateRelativeLuminance(crR, crG, crB);
      const lighter = Math.max(lum, crLum);
      const darker = Math.min(lum, crLum);
      const contrast = (lighter + 0.05) / (darker + 0.05);

      answer.contrast = {
        comparison_color: {
          hex: crHex,
          rgb: { r: crR, g: crG, b: crB },
          relative_luminance: Number(crLum.toFixed(6)),
        },
        contrast_ratio: Number(contrast.toFixed(3)),
        ratio_formatted: `${contrast.toFixed(2)}:1`,
        wcag_aa_normal: contrast >= 4.5,
        wcag_aa_large: contrast >= 3.0,
        wcag_aaa_normal: contrast >= 7.0,
        wcag_aaa_large: contrast >= 4.5,
        ui_component_pass: contrast >= 3.0,
      };
    } catch {}
  }

  return c.json({
    ok: true,
    cell: "color_math",
    answer,
    meta: {
      deterministic: true,
      version: "1.0.0",
    },
  });
});

// ---------------------------------------------------------------------------
// Cell 008: Prompt Token & Weight Normalizer Route
// ---------------------------------------------------------------------------
app.post("/v1/ai/prompt-weight", async (c) => {
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
          expected_schema: { prompt: "((masterpiece)), best quality, (photorealistic:1.4)" },
        },
      },
      400
    );
  }

  const rawPrompt = typeof body === "string" ? body : body?.prompt ?? body?.text;
  if (!rawPrompt || typeof rawPrompt !== "string" || !rawPrompt.trim()) {
    return c.json(
      {
        ok: false,
        error: {
          code: "INVALID_PROMPT",
          message: "prompt must be a non-empty string",
          expected_schema: { prompt: "((masterpiece)), best quality, (photorealistic:1.4)" },
        },
      },
      400
    );
  }

  const targetFormat = body?.target_format ?? "comfy";
  const deduplicate = body?.deduplicate !== false;

  const rawSegments = rawPrompt.split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  const parsedTags: Array<{ text: string; weight: number; original_segment: string; detected_syntax: string }> = [];
  const seenTexts = new Set<string>();
  const duplicates: string[] = [];

  for (const seg of rawSegments) {
    const parsed = parseTagWeight(seg);
    if (!parsed.text) continue;
    const lower = parsed.text.toLowerCase();
    if (seenTexts.has(lower)) {
      duplicates.push(parsed.text);
      if (deduplicate) continue;
    }
    seenTexts.add(lower);
    parsedTags.push({
      text: parsed.text,
      weight: parsed.weight,
      original_segment: seg,
      detected_syntax: parsed.detected_syntax,
    });
  }

  const normalizedSegments: string[] = [];
  const cleanSegments: string[] = [];

  for (const item of parsedTags) {
    cleanSegments.push(item.text);
    if (targetFormat === "comfy" || targetFormat === "a1111") {
      if (Math.abs(item.weight - 1.0) < 0.0001) {
        normalizedSegments.push(item.text);
      } else {
        normalizedSegments.push(`(${item.text}:${item.weight.toFixed(2)})`);
      }
    } else if (targetFormat === "midjourney") {
      if (Math.abs(item.weight - 1.0) < 0.0001) {
        normalizedSegments.push(item.text);
      } else {
        normalizedSegments.push(`${item.text}::${item.weight.toFixed(2)}`);
      }
    } else if (targetFormat === "clean") {
      normalizedSegments.push(item.text);
    } else {
      normalizedSegments.push(Math.abs(item.weight - 1.0) >= 0.0001 ? `(${item.text}:${item.weight.toFixed(2)})` : item.text);
    }
  }

  const cleanString = cleanSegments.join(", ");
  const tokenEst = estimateClipTokens(cleanString);
  const maxChunkSize = 77;
  const chunksNeeded = tokenEst > 0 ? Math.ceil(tokenEst / maxChunkSize) : 1;
  const chunks = [];
  for (let i = 0; i < chunksNeeded; i++) {
    chunks.push({
      chunk_index: i + 1,
      tokens_in_chunk: Math.min(tokenEst - i * maxChunkSize, maxChunkSize),
      max_tokens: maxChunkSize,
    });
  }

  return c.json({
    ok: true,
    cell: "prompt_weight_normalizer",
    answer: {
      cell: "prompt_weight_normalizer",
      version: "1.0.0",
      operation: "prompt_weight_normalization",
      original_prompt: rawPrompt,
      target_format: targetFormat,
      normalized_prompt: normalizedSegments.join(", "),
      clean_prompt: cleanString,
      total_tags: parsedTags.length,
      duplicates_removed: duplicates,
      token_count_estimate: tokenEst,
      clip_chunks: chunks,
      weighted_tags: parsedTags,
      deterministic: true,
    },
    meta: {
      deterministic: true,
      version: "1.0.0",
    },
  });
});



// ============================================================================
// CELL 012: COMFYUI WORKFLOW OPTIMIZER ENGINE (Deterministic Graph Compiler)
// ============================================================================
function optimizeComfyWorkflow(workflow: any, customOutputNodes: string[] = [], preserveNodes: string[] = []) {
  if (!workflow || typeof workflow !== 'object') {
    return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Workflow must be a non-null object' } };
  }

  const STANDARD_OUTPUT_NODES = new Set([
    'SaveImage', 'PreviewImage', 'SaveAnimatedWEBP', 'SaveAnimatedPNG', 
    'VHS_VideoCombine', 'SaveAudio', 'PreviewAudio'
  ]);
  const LOADER_NODE_TYPES = new Set([
    'CheckpointLoaderSimple', 'CheckpointLoader', 'unCLIPCheckpointLoader',
    'VAELoader', 'CLIPLoader', 'DualCLIPLoader', 'UNETLoader'
  ]);

  const customSinks = new Set((customOutputNodes || []).map(String));
  const preserve = new Set((preserveNodes || []).map(String));

  const graph: Record<string, { class_type: string; inputs: Record<string, any>; raw: any }> = {};
  for (const [nid, node] of Object.entries(workflow)) {
    if (node && typeof node === 'object') {
      const n = node as any;
      graph[String(nid)] = {
        class_type: String(n.class_type || ''),
        inputs: (n.inputs && typeof n.inputs === 'object') ? n.inputs : {},
        raw: n
      };
    }
  }

  const forwardAdj: Record<string, string[]> = {};
  const reverseAdj: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  const outDegree: Record<string, number> = {};

  for (const nid of Object.keys(graph)) {
    forwardAdj[nid] = [];
    reverseAdj[nid] = [];
    inDegree[nid] = 0;
    outDegree[nid] = 0;
  }

  for (const [nid, node] of Object.entries(graph)) {
    for (const [inKey, val] of Object.entries(node.inputs)) {
      if (Array.isArray(val) && val.length >= 1) {
        const srcId = String(val[0]);
        if (srcId in graph) {
          forwardAdj[srcId].push(nid);
          reverseAdj[nid].push(srcId);
          outDegree[srcId] = (outDegree[srcId] || 0) + 1;
          inDegree[nid] = (inDegree[nid] || 0) + 1;
        }
      }
    }
  }

  const terminalNodes = new Set<string>();
  for (const [nid, node] of Object.entries(graph)) {
    const ctype = node.class_type;
    const isSink = STANDARD_OUTPUT_NODES.has(ctype) ||
      customSinks.has(nid) ||
      node.raw._is_output_node === true ||
      node.raw.is_output_node === true;
    if (isSink) {
      terminalNodes.add(nid);
    }
  }

  if (terminalNodes.size === 0) {
    for (const [nid, deg] of Object.entries(outDegree)) {
      if (deg === 0) terminalNodes.add(nid);
    }
  }

  const reachable = new Set<string>(terminalNodes);
  const queue = Array.from(terminalNodes);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const parents = reverseAdj[curr] || [];
    for (const parent of parents) {
      if (!reachable.has(parent)) {
        reachable.add(parent);
        queue.push(parent);
      }
    }
  }

  for (const p of preserve) {
    if (p in graph) reachable.add(p);
  }

  const deadNodes = Object.keys(graph)
    .filter(nid => !reachable.has(nid))
    .sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      return (!isNaN(numA) && !isNaN(numB)) ? numA - numB : a.localeCompare(b);
    });

  const duplicateLoaders: any[] = [];
  const seenLoaders = new Map<string, string>();

  for (const [nid, node] of Object.entries(graph)) {
    if (deadNodes.includes(nid)) continue;
    const ctype = node.class_type;
    if (LOADER_NODE_TYPES.has(ctype)) {
      const loaderParams: Record<string, any> = {};
      for (const [k, v] of Object.entries(node.inputs)) {
        if (!(Array.isArray(v) && v.length >= 1 && String(v[0]) in graph)) {
          loaderParams[k] = v;
        }
      }
      const sortedKeys = Object.keys(loaderParams).sort();
      const canonKey = `${ctype}::` + JSON.stringify(sortedKeys.map(k => [k, loaderParams[k]]));

      if (seenLoaders.has(canonKey)) {
        const origId = seenLoaders.get(canonKey)!;
        duplicateLoaders.push({
          original_node_id: origId,
          duplicate_node_id: nid,
          class_type: ctype,
          shared_params: loaderParams
        });
      } else {
        seenLoaders.set(canonKey, nid);
      }
    }
  }

  const redundantVaeDecodes: any[] = [];
  const seenVaeDecodes = new Map<string, string>();

  for (const [nid, node] of Object.entries(graph)) {
    if (deadNodes.includes(nid)) continue;
    const ctype = node.class_type;
    if (ctype === 'VAEDecode' || ctype === 'VAEDecodeTiled') {
      const latentIn = node.inputs.samples !== undefined ? JSON.stringify(node.inputs.samples) : '';
      const vaeIn = node.inputs.vae !== undefined ? JSON.stringify(node.inputs.vae) : '';
      const decodeKey = `${latentIn}::${vaeIn}`;

      if (latentIn !== '' && seenVaeDecodes.has(decodeKey)) {
        const origId = seenVaeDecodes.get(decodeKey)!;
        redundantVaeDecodes.push({
          original_node_id: origId,
          duplicate_node_id: nid,
          class_type: ctype,
          reason: `Decodes identical latent input ${latentIn} with VAE ${vaeIn}`
        });
      } else if (latentIn !== '') {
        seenVaeDecodes.set(decodeKey, nid);
      }
    }
  }

  const unconnectedOutputs: any[] = [];
  for (const [nid, node] of Object.entries(graph)) {
    if (deadNodes.includes(nid)) continue;
    if (!terminalNodes.has(nid) && (outDegree[nid] || 0) === 0) {
      unconnectedOutputs.push({
        node_id: nid,
        class_type: node.class_type,
        reason: 'Node has no downstream connections and is not a terminal save/preview node'
      });
    }
  }

  const nodesToRemove = new Set([...deadNodes, ...duplicateLoaders.map(d => d.duplicate_node_id)]);
  const loaderReplace: Record<string, string> = {};
  for (const d of duplicateLoaders) {
    loaderReplace[d.duplicate_node_id] = d.original_node_id;
  }

  const optimizedRaw: Record<string, any> = {};
  for (const [nid, node] of Object.entries(graph)) {
    if (nodesToRemove.has(nid)) continue;
    const cleanedNode = JSON.parse(JSON.stringify(node.raw));
    if (cleanedNode.inputs && typeof cleanedNode.inputs === 'object') {
      const newInputs: Record<string, any> = {};
      for (const [inK, inV] of Object.entries(cleanedNode.inputs)) {
        if (Array.isArray(inV) && inV.length >= 2 && String(inV[0]) in loaderReplace) {
          newInputs[inK] = [loaderReplace[String(inV[0])], inV[1]];
        } else {
          newInputs[inK] = inV;
        }
      }
      cleanedNode.inputs = newInputs;
    }
    optimizedRaw[nid] = cleanedNode;
  }

  const optimizationsApplied: string[] = [];
  if (deadNodes.length > 0) {
    optimizationsApplied.push(`Pruned ${deadNodes.length} dead/unreachable nodes: [${deadNodes.join(', ')}]`);
  }
  if (duplicateLoaders.length > 0) {
    optimizationsApplied.push(`Consolidated ${duplicateLoaders.length} duplicate model/VAE loader nodes`);
  }
  if (redundantVaeDecodes.length > 0) {
    optimizationsApplied.push(`Flagged ${redundantVaeDecodes.length} redundant VAE decodes`);
  }
  if (unconnectedOutputs.length > 0) {
    optimizationsApplied.push(`Flagged ${unconnectedOutputs.length} unconnected intermediate outputs`);
  }

  const vramSavedEst = Math.round((duplicateLoaders.length * 4096.0 + deadNodes.length * 512.0) * 100) / 100;

  return {
    ok: true,
    cell: 'workflow_optimizer',
    answer: {
      valid: true,
      original_node_count: Object.keys(graph).length,
      optimized_node_count: Object.keys(optimizedRaw).length,
      dead_nodes: deadNodes,
      duplicate_loaders: duplicateLoaders,
      redundant_vae_decodes: redundantVaeDecodes,
      unconnected_outputs: unconnectedOutputs,
      adjacency_map: forwardAdj,
      optimizations_applied: optimizationsApplied,
      optimized_workflow: optimizedRaw,
      savings: {
        dead_nodes_count: deadNodes.length,
        duplicate_loaders_count: duplicateLoaders.length,
        redundant_decodes_count: redundantVaeDecodes.length,
        vram_saved_mb_est: vramSavedEst
      }
    },
    meta: {
      deterministic: true,
      version: '1.0.0'
    }
  };
}

app.post('/v1/workflow/optimize', async (c) => {
  try {
    const body = await c.req.json();
    const workflow = body.workflow || body;
    const customOutputs = Array.isArray(body.custom_output_nodes) ? body.custom_output_nodes : [];
    const preserveNodes = Array.isArray(body.preserve_nodes) ? body.preserve_nodes : [];
    const result = optimizeComfyWorkflow(workflow, customOutputs, preserveNodes);
    if (!result.ok) {
      return c.json(result, 400);
    }
    return c.json(result);
  } catch (err: any) {
    return c.json({
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: err?.message || 'Failed to parse JSON body'
      }
    }, 400);
  }
});


app.get("/.well-known/mcp/server-card.json", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({
    serverInfo: { name: "cell001-day1", version: "1.0.0" },
    tools: [
      { name: "cell_001_media_geometry", description: "Deterministic media aspect ratio and coordinate geometry engine. Gated at $0.003 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] } },
      { name: "cell_002_geometric_measurement", description: "High-precision diagonal and structural clearance validator. Gated at $0.003 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] } },
      { name: "cell_003_json_hygiene", description: "Strict JSON payload structural sanitation engine. Gated at $0.003 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { raw_json: { type: "string" } }, required: ["raw_json"] } },
      { name: "cell_004_comfyui_preflight", description: "ComfyUI node-graph syntax audit and risk scoring engine. Gated at $0.020 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { workflow: { type: "object" },
      { name: "cell_012_workflow_optimizer", description: "Deterministic ComfyUI graph optimizer. Prunes dead nodes, consolidates duplicate model/VAE loaders, remaps inputs, and flags redundant decodes. Gated at $0.035 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { workflow: { type: "object", description: "Raw ComfyUI prompt/workflow node graph" } }, required: ["workflow"] } } }, required: ["workflow"] } }
    ]
  });
});

app.get("/.well-known/mcp.json", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({
    serverInfo: { name: "cell001-day1", version: "1.0.0" },
    tools: [
      { name: "cell_001_media_geometry", description: "Deterministic media aspect ratio and coordinate geometry engine. Gated at $0.003 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] } },
      { name: "cell_002_geometric_measurement", description: "High-precision diagonal and structural clearance validator. Gated at $0.003 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] } },
      { name: "cell_003_json_hygiene", description: "Strict JSON payload structural sanitation engine. Gated at $0.003 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { raw_json: { type: "string" } }, required: ["raw_json"] } },
      { name: "cell_004_comfyui_preflight", description: "ComfyUI node-graph syntax audit and risk scoring engine. Gated at $0.020 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { workflow: { type: "object" },
      { name: "cell_012_workflow_optimizer", description: "Deterministic ComfyUI graph optimizer. Prunes dead nodes, consolidates duplicate model/VAE loaders, remaps inputs, and flags redundant decodes. Gated at $0.035 USDC on Base Mainnet.", inputSchema: { type: "object", properties: { workflow: { type: "object", description: "Raw ComfyUI prompt/workflow node graph" } }, required: ["workflow"] } } }, required: ["workflow"] } }
    ]
  });
});

export default app;
