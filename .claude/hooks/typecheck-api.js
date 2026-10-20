#!/usr/bin/env node
// PostToolUse hook: after an edit under api/, run the TypeScript check and report errors.
// Does nothing until api/ exists. Exit code 2 feeds the errors back to Claude.
const { existsSync } = require("fs");
const { execSync } = require("child_process");
const path = require("path");

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const file = (input.tool_input && input.tool_input.file_path) || "";
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const apiDir = path.join(root, "api");
  const rel = path.relative(apiDir, file);
  if (!/\.tsx?$/.test(file) || rel.startsWith("..") || path.isAbsolute(rel)) return;
  if (!existsSync(path.join(apiDir, "tsconfig.json")) || !existsSync(path.join(apiDir, "node_modules"))) return;
  try {
    execSync("npx tsc --noEmit", { cwd: apiDir, stdio: "pipe", timeout: 90000 });
  } catch (e) {
    console.error(`TypeScript errors after editing ${file}:\n${(e.stdout || "").toString().slice(0, 3000)}`);
    process.exit(2);
  }
});
