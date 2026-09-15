import { config } from "./env.js";
import { isConnected, listPairedDevices } from "./bluetooth.js";

const cfg = config();
const devices = listPairedDevices();

if (devices.length === 0) {
  console.log("Nothing is paired with this PC yet.");
  console.log("On the phone: Settings → Bluetooth → pair with this laptop,");
  console.log("then enable Calls / Call audio for it.");
  process.exit(0);
}

console.log("Paired devices:");
for (const d of devices) {
  const mark = d.mac.toUpperCase() === cfg.phoneBtMac.toUpperCase() ? " ← PHONE_BT_MAC" : "";
  console.log(`  ${d.mac}  ${isConnected(d.mac) ? "connected   " : "disconnected"}  ${d.name}${mark}`);
}

if (!cfg.phoneBtMac) {
  console.log("\nCopy the phone's address into .env as PHONE_BT_MAC=…");
}
