import fs from "node:fs";
import path from "node:path";

const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL";
const PROMPT_TEXT = "Hi, this call is recorded. How are you?";

async function elevenFetch(url, { apiKey, ...init }) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "xi-api-key": apiKey,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 500)}`);
  }
  return res;
}

export function assertApiKey(apiKey) {
  const key = (apiKey || "").trim();
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY is empty. Paste the secret that starts with sk_ into .env");
  }
  if (!key.startsWith("sk_")) {
    throw new Error(
      "ELEVENLABS_API_KEY looks like a key ID, not the secret. In ElevenLabs go to Settings → API keys, create or reveal a key, and paste the value that starts with sk_ (shown only once).",
    );
  }
  return key;
}

export async function listVoices(apiKey) {
  apiKey = assertApiKey(apiKey);
  const res = await elevenFetch("https://api.elevenlabs.io/v1/voices", { apiKey });
  const json = await res.json();
  return json.voices || [];
}

export async function generatePrompt({ apiKey, voiceId, outWav, outMp3 }) {
  apiKey = assertApiKey(apiKey);
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  const voice = voiceId || DEFAULT_VOICE;
  console.log(`ElevenLabs TTS voice: ${voice}`);
  const payload = JSON.stringify({
    text: PROMPT_TEXT,
    model_id: "eleven_multilingual_v2",
  });

  try {
    const res = await elevenFetch(`${TTS_URL}/${voice}?output_format=wav_16000`, {
      apiKey,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav" },
      body: payload,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outWav, buf);
    return outWav;
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes("paid_plan_required") || msg.includes("library voices")) {
      throw new Error(
        `${msg}\nVoice ${voice} is not allowed on the free API (Rachel 21m00Tcm4TlvDq8ikWAM is a library voice now). Set ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL (Sarah) in .env`,
      );
    }
    const res = await elevenFetch(`${TTS_URL}/${voice}?output_format=mp3_44100_128`, {
      apiKey,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: payload,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outMp3, buf);
    console.warn(`WAV TTS unavailable (${err.message}). Saved MP3 instead: ${outMp3}`);
    return outMp3;
  }
}
