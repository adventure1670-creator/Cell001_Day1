import { resolveNetworkConfig } from "../cloudflare-worker/src/networkConfig.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}
const env = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

try {
  process.stdout.write(JSON.stringify({ ok: true, result: resolveNetworkConfig(env) }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
}
