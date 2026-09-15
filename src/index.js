import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { config } from "./env.js";
import { createAdb } from "./adb.js";
import { waitForStatus, isRemoteAnswered, sleep, readRemoteText } from "./wait-for-call.js";
import { generatePrompt } from "./elevenlabs.js";
import {
  connectPhone,
  ensureHeadsetProfile,
  listPairedDevices,
  playToUplink,
  recordDownlink,
  waitForCallAudio,
} from "./bluetooth.js";

const cfg = config();
const adb = createAdb(cfg.adbPath);
const installOnly = process.argv.includes("--install-only");
const bluetoothMode = cfg.promptPlayback === "bluetooth";
const pcSpeakerMode = cfg.promptPlayback === "pc" || cfg.promptPlayback === "both";

async function ensurePrompt() {
  if (fs.existsSync(cfg.promptLocal) || fs.existsSync(cfg.promptMp3)) return;
  fs.mkdirSync(path.dirname(cfg.promptLocal), { recursive: true });
  if (cfg.elevenLabsApiKey) {
    console.log("Generating prompt with ElevenLabs…");
    await generatePrompt({
      apiKey: cfg.elevenLabsApiKey,
      voiceId: cfg.elevenLabsVoiceId,
      outWav: cfg.promptLocal,
      outMp3: cfg.promptMp3,
    });
    return;
  }
  const result = spawnSync(
    "espeak-ng",
    ["-v", "en-in", "Hi, this call is recorded. How are you?", "-w", cfg.promptLocal],
    { stdio: "inherit" },
  );
  if (result.status !== 0 || !fs.existsSync(cfg.promptLocal)) {
    throw new Error(
      "No prompt audio. Set ELEVENLABS_API_KEY in .env or install espeak-ng, then run: npm run prompt",
    );
  }
}

async function requireOneDevice() {
  const devices = await adb.devices();
  const ready = devices.filter((d) => d.state === "device");
  const unauthorized = devices.filter((d) => d.state === "unauthorized");
  if (unauthorized.length) {
    throw new Error(
      "Phone is unauthorized. Unlock it and tap Allow USB debugging, then retry.",
    );
  }
  if (ready.length === 0) {
    throw new Error(
      "No Android device. Plug in USB, enable USB debugging, then run: adb devices",
    );
  }
  if (ready.length > 1) {
    throw new Error(
      `Expected exactly one device, found ${ready.length}:\n${devices.map((d) => d.raw).join("\n")}`,
    );
  }
  return ready[0];
}

async function isPackageInstalled() {
  const { stdout } = await adb.shell(`pm path ${cfg.packageName}`, {
    allowFail: true,
  });
  return stdout.includes(cfg.packageName);
}

async function installApk() {
  if (!fs.existsSync(cfg.apkPath)) {
    throw new Error(
      `APK not found at ${cfg.apkPath}\nBuild it with: npm run build-apk`,
    );
  }
  console.log("Installing helper APK…");
  await adb.install(cfg.apkPath);
  await adb.shell(
    "cmd role add-role-holder android.app.role.DIALER com.idea.callagent",
    { allowFail: true },
  );
  await adb.shell(
    "cmd role add-role-holder --user 0 android.app.role.DIALER com.idea.callagent",
    { allowFail: true },
  );
}

async function pushPrompt() {
  await adb.shell(`mkdir -p ${cfg.remoteFilesDir} ${cfg.remoteDownloadDir}`, {
    allowFail: true,
  });
  const local = fs.existsSync(cfg.promptLocal) ? cfg.promptLocal : cfg.promptMp3;
  if (!fs.existsSync(local)) {
    throw new Error("Prompt file missing after generation.");
  }
  const name = path.basename(local);
  console.log(`Pushing prompt ${name}…`);
  try {
    await adb.push(local, `${cfg.remoteFilesDir}/${name}`);
  } catch {
    await adb.push(local, `${cfg.remoteDownloadDir}/${name}`);
  }
}

async function launchHelper() {
  await adb.shell(
    `rm -f ${cfg.remoteStatus} ${cfg.remoteFilesDir}/answer-* ${cfg.remoteFilesDir}/remote-answered ${cfg.remoteDownloadDir}/status.txt ${cfg.remoteDownloadDir}/answer-* ${cfg.remoteDownloadDir}/remote-answered`,
    { allowFail: true },
  );
  const playOnPhone = cfg.promptPlayback === "phone" || cfg.promptPlayback === "both";
  const cmd =
    `am start -S -n ${cfg.packageName}/.MainActivity ` +
    `--es callee '${cfg.callee}' --ei answerWaitMs ${cfg.answerWaitMs} ` +
    `--ez playPrompt ${playOnPhone && !bluetoothMode} ` +
    `--ez recordAnswer ${!bluetoothMode} --ez useBluetooth ${bluetoothMode}`;
  console.log(`Launching helper → ${cfg.callee}`);
  const { stdout, stderr } = await adb.shell(cmd);
  const out = `${stdout}\n${stderr}`;
  if (/Error|Exception/i.test(out) && !/Starting:/i.test(out)) {
    throw new Error(`Failed to start helper:\n${out}`);
  }
}

async function statusPaths() {
  return [cfg.remoteStatus, `${cfg.remoteDownloadDir}/status.txt`];
}

function promptFile() {
  return fs.existsSync(cfg.promptLocal) ? cfg.promptLocal : cfg.promptMp3;
}

function requireBtMac() {
  if (cfg.phoneBtMac) return cfg.phoneBtMac;
  const paired = listPairedDevices();
  const lines = paired.length
    ? paired.map((d) => `  ${d.mac}  ${d.name}`).join("\n")
    : "  (nothing paired yet)";
  throw new Error(
    `PHONE_BT_MAC is not set in .env.\nPair the phone with this laptop, then pick its address:\n${lines}`,
  );
}

async function prepareBluetooth() {
  const mac = requireBtMac();
  console.log(`Connecting to phone over Bluetooth (${mac})…`);
  await connectPhone(mac);
  await ensureHeadsetProfile(mac);
  console.log("  this PC is now the phone's hands-free device");
  return mac;
}

async function speakAndRecordOverBluetooth(mac) {
  const { sink, source } = await waitForCallAudio(mac);
  console.log(`  call audio arrived on ${sink}`);
  console.log("  speaking the prompt into the call…");
  await playToUplink(sink, promptFile());
  fs.mkdirSync(cfg.recordingsDir, { recursive: true });
  const out = path.join(cfg.recordingsDir, `answer-${Date.now()}.wav`);
  console.log(`  recording the reply for ${cfg.recordMs / 1000}s…`);
  await recordDownlink(source, out, cfg.recordMs);
  return out;
}

function playOnPc() {
  const file = promptFile();
  const candidates = [
    ["paplay", [file]],
    ["pw-play", [file]],
    ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]],
    ["aplay", [file]],
  ];
  const available = candidates.find(([bin]) => spawnSync("command", ["-v", bin], { shell: true }).status === 0);
  if (!available) {
    throw new Error(
      "No audio player on this PC. Install pulseaudio-utils (paplay) or ffmpeg (ffplay), or set PROMPT_PLAYBACK=phone",
    );
  }
  const [bin, args] = available;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", () => resolve(bin));
  });
}

async function pullAnswer() {
  fs.mkdirSync(cfg.recordingsDir, { recursive: true });
  const dirs = [cfg.remoteFilesDir, cfg.remoteDownloadDir];
  for (const dir of dirs) {
    const { stdout } = await adb.shell(`ls -1t ${dir}/answer-* 2>/dev/null`, {
      allowFail: true,
    });
    const remote = stdout
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.includes("answer-"));
    if (!remote) continue;
    const remotePath = remote.startsWith("/") ? remote : `${dir}/${path.posix.basename(remote)}`;
    const local = path.join(cfg.recordingsDir, path.posix.basename(remotePath));
    await adb.pull(remotePath, local);
    return local;
  }
  throw new Error("Helper finished but no answer-* file was found on the phone.");
}

async function main() {
  console.log(`Using adb: ${cfg.adbPath}`);
  await requireOneDevice();
  await ensurePrompt();

  const installed = await isPackageInstalled();
  if (!installed || installOnly || fs.existsSync(cfg.apkPath)) {
    await installApk();
  }

  if (installOnly) {
    console.log("Helper installed. Open Call Agent on the phone and grant Phone + Mic.");
    await adb.shell(`am start -n ${cfg.packageName}/.MainActivity`, {
      allowFail: true,
    });
    return;
  }

  const mac = bluetoothMode ? await prepareBluetooth() : null;

  if (!bluetoothMode) await pushPrompt();
  await launchHelper();

  console.log("Waiting for the other phone to pick up…");
  let localAnswer = null;
  const drivePcAudio = (async () => {
    const deadline = Date.now() + cfg.timeoutMs;
    let flagged = false;
    let spoken = false;
    while (Date.now() < deadline) {
      const status = await readRemoteText(adb, cfg.remoteStatus);
      if (status === "done" || status.startsWith("error")) return;

      if (!flagged) {
        const helperSawAnswer = ["answered", "playing", "recording", "live"].includes(status);
        if (helperSawAnswer || (await isRemoteAnswered(adb))) {
          flagged = true;
          if (!helperSawAnswer) {
            await adb.shell(
              `echo answered > ${cfg.remoteFilesDir}/remote-answered; echo answered > ${cfg.remoteDownloadDir}/remote-answered`,
              { allowFail: true },
            );
          }
          console.log("  remote answered");
        }
      }

      if (!spoken && bluetoothMode && status === "live") {
        spoken = true;
        localAnswer = await speakAndRecordOverBluetooth(mac);
        await adb.shell(`echo hangup > ${cfg.remoteHangup}`, { allowFail: true });
        return;
      }

      if (!spoken && pcSpeakerMode && status === "recording") {
        spoken = true;
        console.log("  playing prompt on this PC (hold the phone mic toward the speakers)…");
        await playOnPc();
        return;
      }
      await sleep(300);
    }
  })();

  const status = await waitForStatus(adb, {
    statusPaths: await statusPaths(),
    timeoutMs: cfg.timeoutMs,
    onUpdate: (s) => console.log(`  status: ${s}`),
  });
  await drivePcAudio;
  if (status.startsWith("error")) {
    throw new Error(`Helper error: ${status}`);
  }

  const local = localAnswer ?? (await pullAnswer());
  console.log(`Saved answer: ${local}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
