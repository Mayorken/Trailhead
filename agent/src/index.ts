import { loadConfig } from "./config.js";
import { runAgent } from "./agent.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const controller = new AbortController();

  const shutdown = (sig: string) => {
    console.log(`\n${sig} received, shutting down...`);
    controller.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await runAgent(cfg, controller.signal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
