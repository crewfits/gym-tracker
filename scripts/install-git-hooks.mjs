#!/usr/bin/env node

import { chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = resolve(repositoryRoot, ".githooks/pre-commit");
const gitCheck = spawnSync("git", ["rev-parse", "--git-dir"], {
  cwd: repositoryRoot,
  stdio: "ignore",
});

if (gitCheck.status !== 0) process.exit(0);

const config = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (config.status !== 0) process.exit(config.status ?? 1);

chmodSync(hookPath, 0o755);
console.log("Installed FitKiro pre-commit checks from .githooks/pre-commit.");
