#!/usr/bin/env node
// PreToolUse hook: block reading/writing secret files and shell commands that print them.
// Exit code 2 = block the tool call; stderr is shown to Claude.
const SECRET_FILE = /(^|[\\/])(\.env(\..+)?|.*\.(pem|key|p12|keystore|jks))$/i;
const ALLOWED = /\.env\.example$/i;
const SECRET_CMD = /\b(cat|type|less|more|head|tail|Get-Content|gc)\b[^|;&\n]*\.env(?!\.example)(\.\w+)?\b/i;

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // never break the session on malformed input
  }
  const ti = input.tool_input || {};
  const file = ti.file_path || ti.path || "";
  if (file && SECRET_FILE.test(file) && !ALLOWED.test(file)) {
    console.error(`Blocked: ${file} looks like a secrets file. Ask the user to handle it, or use .env.example.`);
    process.exit(2);
  }
  const cmd = ti.command || "";
  if (cmd && SECRET_CMD.test(cmd) && !ALLOWED.test(cmd)) {
    console.error("Blocked: command would print a .env file. Secrets must not enter the conversation.");
    process.exit(2);
  }
});
