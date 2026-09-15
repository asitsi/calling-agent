import { config } from "./env.js";
import { generatePrompt } from "./elevenlabs.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cfg = config();

async function main() {
  fs.mkdirSync(path.dirname(cfg.promptLocal), { recursive: true });
  if (cfg.elevenLabsApiKey) {
    const out = await generatePrompt({
      apiKey: cfg.elevenLabsApiKey,
      voiceId: cfg.elevenLabsVoiceId,
      outWav: cfg.promptLocal,
      outMp3: cfg.promptMp3,
    });
    console.log(`Wrote ElevenLabs prompt: ${out}`);
    return;
  }
  const result = spawnSync(
    "espeak-ng",
    ["-v", "en-in", "Hi, this call is recorded. How are you?", "-w", cfg.promptLocal],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("Set ELEVENLABS_API_KEY or install espeak-ng to generate the prompt.");
  }
  console.log(`Wrote espeak prompt: ${cfg.promptLocal}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
