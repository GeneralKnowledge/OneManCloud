import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(
    __dirname,
    "../../database/migrations",
  );
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              OPERATOR_TOKEN: "test-operator-token",
              HEARTBEAT_TIMEOUT_SECONDS: "1",
              BASE_DOMAIN: "example.test",
            },
            d1Databases: ["DB"],
          },
          singleWorker: true,
        },
      },
    },
    define: {
      __D1_MIGRATIONS: JSON.stringify(migrations),
    },
  };
});
