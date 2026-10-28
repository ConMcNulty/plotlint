import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exitQuietlyOnEpipe } from "../epipe.js";

describe("exitQuietlyOnEpipe", () => {
  it("exits 0 on EPIPE and rethrows other stream errors", () => {
    const stream = new EventEmitter() as unknown as NodeJS.WritableStream;
    const codes: number[] = [];
    exitQuietlyOnEpipe(stream, (code) => codes.push(code));
    stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(codes).toEqual([0]);
    expect(() => stream.emit("error", Object.assign(new Error("disk"), { code: "EIO" }))).toThrow("disk");
  });
});

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

describe("inkos with a closed stdout (`| head`)", () => {
  let projectDir: string;
  const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))), HOME: projectDir });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-epipe-"));
    execFileSync("node", [cliEntry, "init"], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 15_000 });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("stops quietly instead of printing an EPIPE stack", async () => {
    const child = spawn("node", [cliEntry, "lint", "rules"], { cwd: projectDir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    // Read one chunk, then hang up like `head -1` does.
    child.stdout.once("data", () => child.stdout.destroy());
    const code = await new Promise<number | null>((done) => child.on("close", done));
    expect(stderr).not.toMatch(/EPIPE|Unhandled/u);
    expect(code).toBe(0);
  }, 20_000);
});
