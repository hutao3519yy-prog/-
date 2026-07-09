import "dotenv/config";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const proxyUrl = process.env.OPENAI_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const env = { ...process.env };

if (proxyUrl) {
  env.NODE_USE_ENV_PROXY = env.NODE_USE_ENV_PROXY || "1";
  env.HTTPS_PROXY = env.HTTPS_PROXY || proxyUrl;
  env.HTTP_PROXY = env.HTTP_PROXY || proxyUrl;
}

const child = spawn(process.execPath, args.length ? args : ["server.js"], {
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
