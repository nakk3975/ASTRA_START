import { build } from "vite";
import { rolldown } from "rolldown";
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(root, "dist/site"));
const hosting = process.argv[3]
  ? JSON.parse(await readFile(path.resolve(process.argv[3]), "utf8"))
  : { d1: "DB", r2: null };
if (hosting.static) throw Error("Worker output cannot declare static");
await build({
  configFile: path.join(root, "apps/web/vite.config.ts"),
  mode: "production",
});
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "server"), { recursive: true });
await cp(path.join(root, "dist/web"), path.join(out, "client"), {
  recursive: true,
});
const bundle = await rolldown({
  input: path.join(root, "apps/sites-worker/index.ts"),
  platform: "browser",
});
await bundle.write({
  file: path.join(out, "server/index.js"),
  format: "esm",
  minify: true,
});
await bundle.close();
await mkdir(path.join(out, ".openai"), { recursive: true });
await writeFile(
  path.join(out, ".openai/hosting.json"),
  JSON.stringify(hosting, null, 2),
);
await writeFile(
  path.join(out, "server/wrangler.json"),
  JSON.stringify(
    {
      name: "scrap-to-space-carry",
      main: "index.js",
      compatibility_date: "2026-11-17",
      assets: {
        directory: "../client",
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*", "/legacy*"],
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "site-creator-d1",
          database_id: "00000000-0000-4000-8000-000000000000",
        },
      ],
    },
    null,
    2,
  ),
);
console.log("Built carry Worker, game assets and D1 manifest:", out);
