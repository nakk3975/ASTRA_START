import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function localDatabase() {
  const databaseDir = fileURLToPath(
    new URL("../.local/postgres", import.meta.url),
  );
  const db = new EmbeddedPostgres({
    databaseDir,
    user: "orbit",
    password: "local-orbit-only",
    port: 55432,
    persistent: true,
    postgresFlags: ["-h", "127.0.0.1", "-k", ""],
    onLog: (m) => console.log(String(m)),
    onError: (m) => console.error(String(m)),
  });
  if (!existsSync(databaseDir + "/PG_VERSION")) await db.initialise();
  await db.start();
  try {
    await db.createDatabase("orbit");
  } catch {}
  // embedded-postgres registers its own exit hook. Both that hook and our
  // signal handler must await room persistence before stopping PostgreSQL.
  const stopPostgres = db.stop.bind(db);
  let beforeStop: (() => Promise<void>) | undefined;
  let stopping: Promise<void> | undefined;
  db.stop = () =>
    (stopping ??= (async () => {
      try {
        await beforeStop?.();
      } finally {
        await stopPostgres();
      }
    })());
  return {
    db,
    beforeStop(fn: () => Promise<void>) {
      beforeStop = fn;
    },
    url: "postgres://orbit:local-orbit-only@127.0.0.1:55432/orbit",
  };
}
if (process.argv[1]?.endsWith("local-db.ts")) {
  const { db } = await localDatabase();
  console.log("Local PostgreSQL ready on 127.0.0.1:55432 (development only)");
  for (const s of ["SIGINT", "SIGTERM"] as const)
    process.on(s, async () => {
      await db.stop();
      process.exit(0);
    });
}
