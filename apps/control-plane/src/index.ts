import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { appRoutes } from "./routes/apps";
import { jobRoutes } from "./routes/jobs";
import { nodeRoutes } from "./routes/nodes";
import { statusRoutes } from "./routes/status";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "UNHANDLED_ERROR",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return c.json({ error: "Internal Server Error" }, 500);
});

app.route("/", statusRoutes);
app.route("/", nodeRoutes);
app.route("/", jobRoutes);
app.route("/", appRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
