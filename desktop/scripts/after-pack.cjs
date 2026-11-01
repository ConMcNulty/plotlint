// electron-builder drops node_modules folders from extraResources, so the
// Studio server (prepared by prepare-server.mjs) is copied in here instead.
"use strict";
const { cpSync, existsSync } = require("node:fs");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
  const source = join(__dirname, "..", "build", "server");
  if (!existsSync(join(source, "plotlint-server.mjs"))) {
    throw new Error("build/server is missing; run `npm run prepare-server` first.");
  }
  const resources = context.electronPlatformName === "darwin"
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : join(context.appOutDir, "resources");
  cpSync(source, join(resources, "server"), { recursive: true, dereference: true });
};
