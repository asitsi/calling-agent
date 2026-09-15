import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
    // Project .env wins for these so a leftover shell export cannot keep a library voice.
    if (key === "ELEVENLABS_VOICE_ID" || key === "ELEVENLABS_API_KEY") {
      process.env[key] = value;
    }
  }
}

export function config() {
  loadEnv();
  const homeAdb = path.join(os.homedir(), "Android/Sdk/platform-tools/adb");
  return {
    root,
    callee: process.env.CALLEE || "+918830077603",
    adbPath: process.env.ADB_PATH || (fs.existsSync(homeAdb) ? homeAdb : "adb"),
    answerWaitMs: Number(process.env.ANSWER_WAIT_MS || 6000),
    timeoutMs: Number(process.env.TIMEOUT_MS || 90000),
    // bluetooth: this PC acts as the phone's headset, so the prompt goes into
    //   the call as real uplink audio and the reply is captured from downlink
    // pc: this computer's speakers, picked up by the phone's mic
    // phone: the calling phone's speaker (echo cancellation hides it from the callee)
    // both: pc and phone
    promptPlayback: (process.env.PROMPT_PLAYBACK || "bluetooth").toLowerCase(),
    phoneBtMac: (process.env.PHONE_BT_MAC || "").trim(),
    recordMs: Number(process.env.RECORD_MS || 12000),
    packageName: "com.idea.callagent",
    activity: "com.idea.callagent.MainActivity",
    promptLocal: path.join(root, "prompts/how-are-you.wav"),
    promptMp3: path.join(root, "prompts/how-are-you.mp3"),
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || "",
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    recordingsDir: path.join(root, "recordings"),
    apkPath: path.join(
      root,
      "android-helper/app/build/outputs/apk/debug/app-debug.apk",
    ),
    remoteFilesDir: "/sdcard/Android/data/com.idea.callagent/files",
    remotePrompt: "/sdcard/Android/data/com.idea.callagent/files/how-are-you.wav",
    remotePromptMp3: "/sdcard/Android/data/com.idea.callagent/files/how-are-you.mp3",
    remoteStatus: "/sdcard/Android/data/com.idea.callagent/files/status.txt",
    remoteHangup: "/sdcard/Android/data/com.idea.callagent/files/agent-hangup",
    remoteDownloadDir: "/sdcard/Download/call-agent",
  };
}
