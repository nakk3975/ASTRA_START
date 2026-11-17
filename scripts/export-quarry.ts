import { writeFile } from "node:fs/promises";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { quarryEnvironment } from "../apps/web/src/carry/quarry-environment.ts";
// GLTFExporter uses the browser FileReader API, even for an untextured scene.
(globalThis as any).FileReader = class {
  result: ArrayBuffer | null = null;
  onloadend?: () => void;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};
const scenery = quarryEnvironment();
const binary = await new GLTFExporter().parseAsync(scenery.root, {
  binary: true,
});
await writeFile(
  "/tmp/scrap-quarry-environment.glb",
  Buffer.from(binary as ArrayBuffer),
);
console.log(
  JSON.stringify({
    staticBatches: scenery.root.children.length,
    output: "/tmp/scrap-quarry-environment.glb",
  }),
);
scenery.dispose();
