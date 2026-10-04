export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newId(prefix?: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id}` : id;
}

/** Constant-time string compare using Web Crypto digest lengths. */
export async function timingSafeEqual(
  a: string,
  b: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    // Still hash both to reduce timing leakage of length differences for callers.
    await sha256Hex(a);
    await sha256Hex(b);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export type LogEvent =
  | "STATUS_CHECKED"
  | "AUTH_FAILED"
  | "AUTH_OK"
  | "NODE_REGISTERED"
  | "NODE_HEARTBEAT"
  | "NODE_OFFLINE"
  | "JOB_CREATED"
  | "JOB_DISPATCHED"
  | "JOB_STARTED"
  | "JOB_SUCCEEDED"
  | "JOB_FAILED"
  | "DEPLOYMENT_STARTED"
  | "DEPLOYMENT_SUCCEEDED"
  | "DEPLOYMENT_FAILED"
  | "APP_REGISTERED";

export function structuredLog(
  event: LogEvent,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...fields,
    }),
  );
}

export function parseMemoryMb(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 512;
  const match = /^(\d+)\s*(mb|gb)?$/i.exec(value.trim());
  if (!match) return 512;
  const n = Number(match[1]);
  const unit = (match[2] ?? "mb").toLowerCase();
  return unit === "gb" ? n * 1024 : n;
}

export function formatBytes(mb: number | null | undefined): string {
  if (mb == null) return "-";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)}GB`;
  }
  return `${mb}MB`;
}

export const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 90;
export const DEFAULT_JOB_MAX_ATTEMPTS = 3;
export const DEFAULT_POLL_INTERVAL_MS = 3000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;

export function publicHostname(
  baseDomain: string,
  subdomain: string,
): string {
  return `${subdomain}.${baseDomain}`;
}
