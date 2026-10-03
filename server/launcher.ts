import { join } from "node:path";

/** Exit code with which the server asks the launcher to start it again, e.g. after an update. */
export const RESTART_EXIT_CODE = 75;

/** Runs the server and starts it again each time it exits with RESTART_EXIT_CODE. */
async function main(): Promise<never> {
  const entry = join(import.meta.dir, "index.ts");
  for (;;) {
    const server = Bun.spawn([process.execPath, "run", entry], {
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env, CLAYFOLD_LAUNCHER: "1" },
    });
    // The terminal sends Ctrl+C to the server too; a second SIGINT finds its shutdown already running.
    const forward = (signal: NodeJS.Signals) => server.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    const code = await server.exited;
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
    if (code !== RESTART_EXIT_CODE) process.exit(code);
    console.log("Restarting Clayfold");
  }
}

if (import.meta.main) await main();
