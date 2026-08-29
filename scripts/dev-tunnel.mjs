#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = process.env.PORT || "3000";
const ngrokApiUrl = process.env.NGROK_API_URL || "http://127.0.0.1:4040/api/tunnels";
const ngrokArgs = ["http", port, "--log=stdout", "--log-format=logfmt"];
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

if (process.env.NGROK_URL) ngrokArgs.push(`--url=${process.env.NGROK_URL}`);

const children = [];
const childCompletions = new WeakMap();
let shuttingDown = false;

function commandExists(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(locator, [command], { stdio: "ignore" }).status === 0;
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
  children.push(child);
  childCompletions.set(child, childExit(child, command));
  return child;
}

function stopChild(child, signal) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...children].reverse()) stopChild(child, signal);
}

function childExit(child, name) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ name, code: 1, error }));
    child.once("exit", (code, signal) => resolve({ name, code, signal }));
  });
}

async function waitForTunnel(ngrok) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (ngrok.exitCode !== null) throw new Error("ngrok stopped before opening a tunnel");
    try {
      const response = await fetch(ngrokApiUrl, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const data = await response.json();
        const tunnel = data.tunnels?.find((item) => item.proto === "https");
        if (tunnel?.public_url) return tunnel.public_url.replace(/\/$/, "");
      }
    } catch {
      // The local ngrok inspection API is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ngrok at ${ngrokApiUrl}`);
}

process.once("SIGINT", () => stopAll("SIGINT"));
process.once("SIGTERM", () => stopAll("SIGTERM"));

try {
  if (!commandExists("ngrok")) {
    throw new Error(
      "ngrok is not installed or is not on PATH. On Windows, install it with " +
        "`winget install ngrok -s msstore`, open a new terminal, then run " +
        "`ngrok config add-authtoken <YOUR_TOKEN>`.",
    );
  }

  const ngrok = start("ngrok", ngrokArgs);
  const publicUrl = await Promise.race([
    waitForTunnel(ngrok),
    childCompletions.get(ngrok).then((result) => {
      const reason = result.error?.message || result.signal || `exit code ${result.code ?? 0}`;
      throw new Error(`ngrok stopped before opening a tunnel (${reason})`);
    }),
  ]);
  console.log(`\nGymDesk tunnel: ${publicUrl}`);
  console.log("Starting Next.js with this URL for QR links...\n");

  const next = start(process.execPath, [nextCli, "dev"], {
    env: { ...process.env, PORT: port, NEXT_PUBLIC_APP_URL: publicUrl },
  });

  const result = await Promise.race([
    childCompletions.get(ngrok),
    childCompletions.get(next),
  ]);

  if (!shuttingDown) {
    const reason = result.error?.message || result.signal || `exit code ${result.code ?? 0}`;
    console.error(`\n${result.name} stopped (${reason}); closing the other process.`);
    stopAll();
    process.exitCode = result.code || 1;
  }
} catch (error) {
  console.error(`\nUnable to start the local tunnel: ${error instanceof Error ? error.message : error}`);
  stopAll();
  process.exitCode = 1;
}
