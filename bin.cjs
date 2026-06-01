#!/usr/bin/env node
const { spawnSync } = require("child_process");
const { join } = require("path");
const result = spawnSync("bun", [join(__dirname, "src/cli/index.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 0);
