import { spawn } from "node:child_process";

export function createAdb(adbPath) {
  function run(args, { allowFail = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(adbPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !allowFail) {
          reject(
            new Error(
              `adb ${args.join(" ")} failed (${code}): ${stderr || stdout}`.trim(),
            ),
          );
          return;
        }
        resolve({ code, stdout, stderr });
      });
    });
  }

  return {
    run,
    async devices() {
      const { stdout } = await run(["devices", "-l"]);
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("List of devices"));
      return lines.map((line) => {
        const [serial, state] = line.split(/\s+/);
        return { serial, state, raw: line };
      });
    },
    async shell(command, opts) {
      return run(["shell", command], opts);
    },
    async push(local, remote) {
      return run(["push", local, remote]);
    },
    async pull(remote, local) {
      return run(["pull", remote, local]);
    },
    async install(apkPath) {
      return run(["install", "-r", apkPath]);
    },
  };
}
