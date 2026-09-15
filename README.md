# Outbound call agent (Node + Android)

Places a real GSM call from the USB-connected Android (SIM **+916394066616**), asks the callee how they are, and saves the spoken reply on this PC.

No Twilio, Exotel, or USB GSM dongle. ADB only controls the phone and copies the recording.

No Twilio, Exotel, or USB GSM dongle. ADB only controls the phone and copies the recording.

## What you need

- This PC (Node 24, ADB)
- [ElevenLabs](https://elevenlabs.io) API key (optional, for a natural spoken prompt)
- Android phone with SIM, USB cable, **USB debugging** on
- Second phone to **answer** **+918830077603**

`espeak-ng` is only a fallback if the API key is missing.

## One-time phone setup

1. **Settings → About phone** → tap Build number 7 times.
2. Enable **USB debugging**. Plug in the cable. Tap **Allow**.
3. Confirm:

```bash
adb devices
```

You want `device`, not `unauthorized`.

## ElevenLabs

1. Create a key at [API keys](https://elevenlabs.io/app/settings/api-keys).
2. Put it in `.env`:

```env
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

`ELEVENLABS_VOICE_ID` is optional (default Rachel). Pick another voice ID from the ElevenLabs voice library.

Generate (or refresh) the on-call prompt:

```bash
npm run prompt
```

That writes `prompts/how-are-you.wav` (or `.mp3` if WAV is not on your plan).

## Build and run

```bash
cp .env.example .env   # then paste ELEVENLABS_API_KEY
npm run prompt
npm run build-apk      # compiles android-helper (already built once)
npm start
```

First run installs **Call Agent**, opens it, and asks for **Phone**, **Microphone**, and (on Android 13+) **Notifications**. Grant them, then run `npm start` again if the call did not start.

Have **+918830077603** ready. After they pick up, wait about six seconds (ring time). The calling phone plays *Hi, this call is recorded. How are you?* on speaker, records the mic until silence (~4s) or 30s, then hangs up if the OEM allows it.

Outputs:

- `recordings/answer-<timestamp>.m4a` — audio only (nothing is uploaded for transcription)

Reinstall the helper only:

```bash
npm run install-apk
```

## Config (`.env`)

| Variable | Meaning |
|---|---|
| `CALLEE` | Number that rings (`+918830077603`) |
| `ADB_PATH` | Path to `adb` |
| `ANSWER_WAIT_MS` | Short pause **after the callee picks up**, before the prompt (capped at 2s) |
| `TIMEOUT_MS` | Give up waiting for the helper |
| `PROMPT_PLAYBACK` | `bluetooth` (default), `pc`, `phone`, or `both` — see Audio path |
| `PHONE_BT_MAC` | Calling phone's Bluetooth address (`npm run bt` lists paired devices) |
| `RECORD_MS` | How long to record the reply in `bluetooth` mode |
| `ELEVENLABS_API_KEY` | Spoken prompt only (TTS). Recordings stay local. |
| `ELEVENLABS_VOICE_ID` | Voice for the prompt |

## Limits

- An app on stock Android cannot write into the cellular uplink, and the phone's echo canceller strips its **own** speaker output out of what the callee hears. That is why `PROMPT_PLAYBACK=phone` is loud to you and silent to the callee.
- Some phones block `endCall()` unless this app is the default dialer — hang up manually if the call stays open.
- Only call numbers you own or have consent to call. The prompt states that the call is recorded.

## Audio path

`PROMPT_PLAYBACK=bluetooth` (default) is the only mode that delivers clean audio, because it stops trying to fight the phone and makes this PC the phone's headset instead.

One-time pairing:

1. On the phone: Settings → Bluetooth → pair with this laptop.
2. Open the laptop entry on the phone and enable **Calls** / **Call audio** (not just Media).
3. Run `npm run bt` and copy the phone's address into `.env` as `PHONE_BT_MAC`.

During a call the phone hands its audio to the laptop over HFP. The laptop's Bluetooth sink is the phone's **uplink**, so `paplay` into it is heard by the callee as ordinary call audio. Its Bluetooth source is the **downlink**, so the reply is recorded straight from the line — no room noise, and no in-call recording restrictions. Recordings land in `recordings/answer-<timestamp>.wav`.

If the laptop never receives the audio, open the phone's in-call screen and pick the laptop as the audio device; some OEM dialers do not switch automatically.

The older `pc` mode (prompt over the laptop's speakers, reply via the phone's mic) still works as a fallback and needs no pairing, but it is acoustic, so both directions pick up the room.

## Layout

- `src/` — Node CLI (`npm start`)
- `src/elevenlabs.js` — prompt TTS only
- `android-helper/` — first-party Kotlin helper APK
- `prompts/` — ElevenLabs (or espeak) prompt audio
- `recordings/` — pulled answers (audio files only)
