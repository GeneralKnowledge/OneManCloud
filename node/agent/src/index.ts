import { runAgent } from "./run.js";

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const args = process.argv.slice(2);
await runAgent({
  name: flag(args, "--name") ?? process.env.OMC_NODE_NAME ?? "local",
  once: args.includes("--once"),
  url: flag(args, "--url") ?? process.env.OMC_URL,
  // Remote nodes must use OMC_NODE_TOKEN only. Operator registration is
  // reserved for `omc node local` (reads ~/.omc), not OPERATOR_TOKEN env.
  nodeToken: process.env.OMC_NODE_TOKEN,
});
