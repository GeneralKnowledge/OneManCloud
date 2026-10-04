import { applyD1Migrations, env } from "cloudflare:test";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    OPERATOR_TOKEN: string;
    HEARTBEAT_TIMEOUT_SECONDS: string;
    BASE_DOMAIN: string;
  }
}

// Provided by vitest.config.ts define
declare const __D1_MIGRATIONS: D1Migration[];

await applyD1Migrations(env.DB, __D1_MIGRATIONS);
