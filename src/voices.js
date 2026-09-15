import { config } from "./env.js";
import { listVoices } from "./elevenlabs.js";

const cfg = config();

function row(voice) {
  const cat = voice.category || "unknown";
  const desc = (voice.labels?.description || voice.labels?.accent || "").toString();
  return `${voice.voice_id}\t${cat}\t${voice.name}${desc ? ` (${desc})` : ""}`;
}

async function main() {
  const voices = await listVoices(cfg.elevenLabsApiKey);
  const premade = voices.filter((v) => v.category === "premade");
  const rest = voices.filter((v) => v.category !== "premade");

  console.log("Free-plan API voices (premade / default):\n");
  if (!premade.length) {
    console.log("(none returned — your account may only have library voices added)");
  } else {
    for (const v of premade) console.log(row(v));
  }

  if (rest.length) {
    console.log("\nAlso on this account, but Voice Library / cloned (paid API):\n");
    for (const v of rest) console.log(row(v));
  }

  console.log("\nCopy a premade voice_id into ELEVENLABS_VOICE_ID in .env, then: npm run prompt");
}

main().catch((err) => {
  const msg = String(err.message || err);
  console.error(msg);
  if (msg.includes("voices_read") || msg.includes("missing_permissions")) {
    console.error(`
Your API key cannot list voices. In ElevenLabs → Settings → API keys, create a key
with voices_read (and text_to_speech), or use a premade default ID on the free plan:

  21m00Tcm4TlvDq8ikWAM   Rachel (paid / library — will 402 on free)
  EXAVITQu4vr4xnSDxMaL   Sarah (free-plan default)
  EXAVITQu4vr4xnSDxMaL   Sarah
  ErXwobaYiN019PkySvjV   Antoni
  VR6AewLTigWG4xSOukaG   Arnold
  TxGEqnHWrfWFTfGW9XjX   Josh
  pNInz6obpgDQGcFmaJgB   Adam
  JBFqnCBsd6RMkjVDRZzb   George
  cgSgspJ2msm6clMCkdW9   Jessica

Set one in .env as ELEVENLABS_VOICE_ID, then: npm run prompt
Do not use Voice Library / Explore IDs on the free API.
`);
  }
  process.exit(1);
});

