// Uses this PC as a Bluetooth hands-free unit for the phone.
// While a call is routed here, the HFP sink is the phone's uplink (what the
// callee hears) and the HFP source is the downlink (what the callee says).
import { spawn, spawnSync } from "node:child_process";
import { sleep } from "./wait-for-call.js";

const HEADSET_PROFILE = "headset-audio-gateway";

function run(bin, args) {
  const res = spawnSync(bin, args, { encoding: "utf8" });
  return {
    code: res.status ?? 1,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function macToNodeId(mac) {
  return mac.trim().toUpperCase().replace(/:/g, "_");
}

export function listPairedDevices() {
  const { stdout } = run("bluetoothctl", ["devices", "Paired"]);
  return stdout
    .split("\n")
    .map((line) => line.match(/^Device\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ mac: m[1], name: m[2].trim() }));
}

export function isConnected(mac) {
  const { stdout } = run("bluetoothctl", ["info", mac]);
  return /Connected:\s*yes/i.test(stdout);
}

export async function connectPhone(mac) {
  if (isConnected(mac)) return;
  run("bluetoothctl", ["connect", mac]);
  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    if (isConnected(mac)) return;
  }
  throw new Error(
    `Could not connect to ${mac} over Bluetooth. Turn Bluetooth on, keep the phone nearby, then retry.`,
  );
}

function cardName(mac) {
  const { stdout } = run("pactl", ["list", "cards", "short"]);
  const want = `bluez_card.${macToNodeId(mac)}`;
  return stdout.split("\n").find((line) => line.includes(want))?.split(/\s+/)[1] || null;
}

function cardProfile(card) {
  const { stdout } = run("pactl", ["list", "cards"]);
  const block = stdout.split(/^Card #/m).find((b) => b.includes(card));
  return block?.match(/Active Profile:\s*(\S+)/)?.[1] || "";
}

// The phone only hands over call audio if we present ourselves as its headset.
export async function ensureHeadsetProfile(mac) {
  for (let i = 0; i < 20; i += 1) {
    const card = cardName(mac);
    if (card) {
      if (cardProfile(card) === HEADSET_PROFILE) return card;
      const { code, stderr } = run("pactl", ["set-card-profile", card, HEADSET_PROFILE]);
      if (code !== 0) {
        throw new Error(
          `Phone does not expose the ${HEADSET_PROFILE} profile (${stderr.trim()}).\n` +
            "On the phone: Bluetooth → this laptop → enable Calls / Call audio.",
        );
      }
      return card;
    }
    await sleep(500);
  }
  throw new Error(`No Bluetooth audio card for ${mac}. Pair the phone with this PC first.`);
}

function shortList(kind, mac) {
  const prefix = kind === "sinks" ? "bluez_output" : "bluez_input";
  const { stdout } = run("pactl", ["list", kind, "short"]);
  return stdout
    .split("\n")
    .map((line) => line.split(/\s+/)[1])
    .filter((name) => name?.startsWith(`${prefix}.${macToNodeId(mac)}`));
}

// The SCO link only exists while a call is up, so these appear late.
export async function waitForCallAudio(mac, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sink = shortList("sinks", mac)[0];
    const source = shortList("sources", mac)[0];
    if (sink && source) return { sink, source };
    await sleep(400);
  }
  throw new Error(
    "Call audio never reached this PC over Bluetooth.\n" +
      "During the call, open the phone's in-call screen and pick this laptop as the audio device.",
  );
}

export function playToUplink(sink, file) {
  return new Promise((resolve, reject) => {
    const child = spawn("paplay", [`--device=${sink}`, file], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`paplay exited with ${code}`)),
    );
  });
}

export function recordDownlink(source, outFile, ms) {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "pulse",
    "-i", source,
    "-t", String(ms / 1000),
    "-ac", "1",
    "-ar", "16000",
    outFile,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(outFile) : reject(new Error(`ffmpeg exited with ${code}`)),
    );
  });
}
