function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readRemoteText(adb, remotePath) {
  const { stdout, code } = await adb.shell(`cat ${remotePath} 2>/dev/null`, {
    allowFail: true,
  });
  if (code !== 0) return "";
  return stdout.trim();
}

export async function waitForStatus(adb, { statusPaths, timeoutMs, onUpdate }) {
  const paths = Array.isArray(statusPaths) ? statusPaths : [statusPaths];
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    let status = "";
    for (const p of paths) {
      const text = await readRemoteText(adb, p);
      if (text) {
        status = text;
        break;
      }
    }
    if (status && status !== last) {
      last = status;
      onUpdate?.(status);
    }
    if (status === "done" || status.startsWith("error")) {
      return status;
    }
    await sleep(500);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for helper (last status: ${last || "none"})`,
  );
}

export async function isRemoteAnswered(adb) {
  const { stdout: tel } = await adb.shell("dumpsys telephony.registry", {
    allowFail: true,
  });
  const states = [...tel.matchAll(/m?ForegroundCallState=(\d+)/gi)].map((m) => Number(m[1]));
  if (states.includes(1)) return true;
  if (/foregroundCall:\s*active/i.test(tel)) return true;

  const { stdout: tc } = await adb.shell("dumpsys telecom", { allowFail: true });
  const active = /(mState|CallState|state):\s*ACTIVE/i.test(tc);
  const notYet = /(mState|CallState|state):\s*(DIALING|CONNECTING|RINGING|ALERTING)/i.test(tc);
  return active && !notYet;
}

export { sleep };

