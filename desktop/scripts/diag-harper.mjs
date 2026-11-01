// Diagnoses the Harper (WebAssembly) load in the packaged app's Node.
//   ELECTRON_RUN_AS_NODE=1 "<app exe>" scripts/diag-harper.mjs <resources/server dir> <out file>
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [serverDir, out] = process.argv.slice(2);
writeFileSync(out, "");
const say = (...parts) => appendFileSync(out, parts.map(String).join(" ") + "\n");
try {
  say("node", process.versions.node, "electron", process.versions.electron, "platform", process.platform);
  say("typeof fetch", typeof fetch, "typeof Response", typeof Response, "typeof WebAssembly.instantiateStreaming", typeof WebAssembly.instantiateStreaming);
  const r = await fetch("data:application/wasm;base64,AGFzbQEAAAA=");
  say("data fetch ->", r?.constructor?.name, "instanceof Response", r instanceof Response, "ok", r.ok);
  const mech = await import(pathToFileURL(join(serverDir, "node_modules/@plotlint/mechanics/dist/harper.js")).href);
  const bin = await mech.harperBinary();
  say("binary url prefix", String(bin.url ?? bin.binary ?? "").slice(0, 40));
  const { LocalLinter } = await import(pathToFileURL(join(serverDir, "node_modules/harper.js/dist/index.js")).href);
  const lints = await new LocalLinter({ binary: bin }).lint("She recieved the key.");
  say("lints", lints.length);
} catch (error) {
  say("ERROR", error?.stack ?? error);
}
