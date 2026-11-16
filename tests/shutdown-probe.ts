/** Actual local PostgreSQL + application SIGTERM test. Run with no server active. */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.DATABASE_URL || process.env.NODE_ENV === "production")
  throw Error("Shutdown probe requires the development embedded PostgreSQL");
if (existsSync(".local/postgres/postmaster.pid"))
  throw Error("Stop the existing development server before running this probe");
process.env.ORBIT_QA = "0";
process.env.ORBIT_FULL_QA = "0";
mkdirSync("docs/qa/evidence", { recursive: true });
const prefix = "docs/qa/evidence/graceful-shutdown";
writeFileSync(prefix + ".txt", "");
for (const name of ["log", "warn", "error"] as const) {
  const original = console[name].bind(console);
  console[name] = (...args: unknown[]) => {
    appendFileSync(
      prefix + ".txt",
      new Date().toISOString() +
        " " +
        name +
        " " +
        args.map(String).join(" ") +
        "\n",
    );
    original(...args);
  };
}
let signaledAt: number | undefined;
const exit = process.exit.bind(process);
process.exit = ((code?: number | string) => {
  const dbStopped = !existsSync(".local/postgres/postmaster.pid");
  writeFileSync(
    prefix + ".json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        status:
          code === 0 && dbStopped && signaledAt !== undefined ? "PASS" : "FAIL",
        exitCode: code,
        postgresPidFileRemoved: dbStopped,
        shutdownMilliseconds:
          signaledAt === undefined ? null : performance.now() - signaledAt,
        trigger:
          "SIGTERM sent to the running Node application, real local PostgreSQL",
        limits:
          "Graceful termination only; not forced crash, partition or lost COMMIT response",
      },
      null,
      2,
    ) + "\n",
  );
  return exit(code);
}) as typeof process.exit;
await import("../apps/server/src/main.ts");
console.log("SHUTDOWN_PROBE_READY");
setTimeout(() => {
  console.log("SHUTDOWN_PROBE_SIGTERM");
  signaledAt = performance.now();
  process.kill(process.pid, "SIGTERM");
}, 12000);
