import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
  DEFAULT_JOB_MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  publicHostname,
} from "@omc/shared";

export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
  DEFAULT_JOB_MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  publicHostname,
};

export interface OmcClientConfig {
  url: string;
  token: string;
}

export function defaultConfigPath(): string {
  return process.env.OMC_CONFIG ?? join(homedir(), ".omc", "config.json");
}

export function defaultNodeStatePath(): string {
  return (
    process.env.OMC_NODE_STATE ?? join(homedir(), ".omc", "node.json")
  );
}

export function resolveBaseDomain(
  configured: string | undefined,
): string | null {
  return configured?.trim() || process.env.BASE_DOMAIN?.trim() || null;
}
