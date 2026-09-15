package com.idea.callagent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class CallAgentService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val playerExecutor = Executors.newSingleThreadExecutor()
    private val startedCall = AtomicBoolean(false)
    private val finished = AtomicBoolean(false)

    private var telephony: TelephonyManager? = null
    private var legacyListener: PhoneStateListener? = null
    private var modernCallback: TelephonyCallback? = null
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var answerFile: File? = null
    private var answerWaitMs = 6000
    private var playPrompt = true
    private var recordAnswer = true
    private var useBluetooth = false
    private var callee: String = ""
    private val remoteAnswered = AtomicBoolean(false)
    private val pollAnswer = object : Runnable {
        override fun run() {
            if (finished.get() || remoteAnswered.get()) return
            if (CallStateProbe.isRemoteAnswered()) {
                onRemoteAnswered()
                return
            }
            handler.postDelayed(this, 400)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        AgentFiles.init(this)
        createChannel()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                1,
                notification("Starting call agent"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(1, notification("Starting call agent"))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        callee = intent?.getStringExtra("callee").orEmpty()
        answerWaitMs = intent?.getIntExtra("answerWaitMs", 6000) ?: 6000
        playPrompt = intent?.getBooleanExtra("playPrompt", true) ?: true
        recordAnswer = intent?.getBooleanExtra("recordAnswer", true) ?: true
        useBluetooth = intent?.getBooleanExtra("useBluetooth", false) ?: false
        if (callee.isBlank()) {
            fail("missing-callee")
            return START_NOT_STICKY
        }
        AgentFiles.clearFlags()
        AgentFiles.writeStatus("started")
        telephony = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
        placeCall()
        registerCallState()
        handler.postDelayed(pollAnswer, 800)
        handler.postDelayed({
            if (!finished.get() && !remoteAnswered.get()) {
                fail("no-answer")
            }
        }, 90_000)
        return START_NOT_STICKY
    }

    private fun placeCall() {
        if (!startedCall.compareAndSet(false, true)) return
        val uri = Uri.fromParts("tel", callee, null)
        val call = Intent(Intent.ACTION_CALL, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(call)
    }

    private fun registerCallState() {
        val tm = telephony ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(state: Int) {
                    handleState(state)
                }
            }
            modernCallback = cb
            tm.registerTelephonyCallback(executor, cb)
        } else {
            val listener = object : PhoneStateListener() {
                @Deprecated("Deprecated in Java")
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    handleState(state)
                }
            }
            legacyListener = listener
            @Suppress("DEPRECATION")
            tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
        }
    }

    private fun handleState(state: Int) {
        when (state) {
            TelephonyManager.CALL_STATE_OFFHOOK -> handler.post { onOffHook() }
            TelephonyManager.CALL_STATE_IDLE -> handler.post { onIdle() }
        }
    }

    private val offHookStarted = AtomicBoolean(false)

    private fun onOffHook() {
        if (!offHookStarted.compareAndSet(false, true)) return
        AgentFiles.writeStatus("ringing")
        handler.post(pollAnswer)
    }

    private fun onRemoteAnswered() {
        if (!remoteAnswered.compareAndSet(false, true)) return
        handler.removeCallbacks(pollAnswer)
        AgentFiles.writeStatus("answered")
        routeCallAudio()
        handler.postDelayed({ playThenRecord() }, answerWaitMs.toLong().coerceAtMost(2_000))
    }

    private fun playThenRecord() {
        if (finished.get()) return
        routeCallAudio()
        if (!playPrompt && !recordAnswer) {
            // The PC is the headset for this call: it speaks and records.
            holdForPc()
            return
        }
        if (!playPrompt) {
            // The PC plays the prompt over its speakers; only record here.
            startRecording()
            return
        }
        val prompt = AgentFiles.prompt()
        if (!prompt.exists()) {
            fail("missing-prompt")
            return
        }
        AgentFiles.writeStatus("playing")
        playerExecutor.execute {
            try {
                CallAudioPlayer.play(this, prompt)
                handler.post { startRecording() }
            } catch (e: Exception) {
                handler.post { fail("prompt-play-failed:${e.message}") }
            }
        }
    }

    private fun holdForPc() {
        AgentFiles.writeStatus("live")
        val until = System.currentTimeMillis() + HOLD_TIMEOUT_MS
        handler.postDelayed(object : Runnable {
            override fun run() {
                if (finished.get()) return
                if (AgentFiles.hangupRequested() || System.currentTimeMillis() >= until) {
                    finishSuccess()
                    return
                }
                routeCallAudio()
                handler.postDelayed(this, 500)
            }
        }, 500)
    }

    private fun startRecording() {
        if (finished.get()) return
        val out = AgentFiles.newAnswerFile()
        answerFile = out
        AgentFiles.writeStatus("recording")
        try {
            val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioSamplingRate(16000)
            rec.setAudioEncodingBitRate(64000)
            rec.setOutputFile(out.absolutePath)
            rec.prepare()
            rec.start()
            recorder = rec
            watchSilence(rec, System.currentTimeMillis())
        } catch (e: Exception) {
            fail("record-failed:${e.message}")
        }
    }

    private fun watchSilence(rec: MediaRecorder, startedAt: Long) {
        rec.maxAmplitude
        handler.postDelayed(object : Runnable {
            var lastLoud = startedAt
            override fun run() {
                if (finished.get()) return
                val now = System.currentTimeMillis()
                val amp = try {
                    rec.maxAmplitude
                } catch (_: Exception) {
                    0
                }
                if (amp > 800) lastLoud = now
                val elapsed = now - startedAt
                val quietFor = now - lastLoud
                if (elapsed >= 30_000 || (elapsed >= 8_000 && quietFor >= 4_000)) {
                    finishSuccess()
                } else {
                    handler.postDelayed(this, 250)
                }
            }
        }, 250)
    }

    private fun finishSuccess() {
        if (!finished.compareAndSet(false, true)) return
        stopRecorder()
        hangUp()
        AgentFiles.writeStatus("done")
        stopSelf()
    }

    private fun onIdle() {
        if (finished.get()) return
        // Registering the listener delivers IDLE immediately, before we even dial.
        if (!offHookStarted.get()) return
        if (remoteAnswered.get()) {
            finishSuccess()
            return
        }
        fail("no-answer")
    }

    private fun hangUp() {
        try {
            val telecom = getSystemService(TELECOM_SERVICE) as TelecomManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                telecom.endCall()
            }
        } catch (_: Exception) {
            // Some OEMs block endCall unless this app is the default dialer.
        }
        clearCallAudio()
    }

    private fun audio(): AudioManager = getSystemService(AUDIO_SERVICE) as AudioManager

    private fun telephonyOutput(): AudioDeviceInfo? {
        return audio().getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .firstOrNull { it.type == AudioDeviceInfo.TYPE_TELEPHONY }
    }

    private fun routeCallAudio() {
        val am = audio()
        am.mode = AudioManager.MODE_IN_CALL
        if (useBluetooth) {
            routeToBluetooth(am)
            return
        }
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.availableCommunicationDevices
                .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                ?.let { am.setCommunicationDevice(it) }
        }
        am.setStreamVolume(
            AudioManager.STREAM_VOICE_CALL,
            am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL),
            0,
        )
        am.setStreamVolume(
            AudioManager.STREAM_MUSIC,
            am.getStreamMaxVolume(AudioManager.STREAM_MUSIC),
            0,
        )
        try {
            am.setParameters("noise_suppression=off")
            am.setParameters("aec=false")
            am.setParameters("acoustic_echo_canceler=false")
        } catch (_: Exception) {
        }
    }

    private fun routeToBluetooth(am: AudioManager) {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.availableCommunicationDevices
                .firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                        it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
                }
                ?.let { am.setCommunicationDevice(it) }
        } else {
            @Suppress("DEPRECATION")
            am.startBluetoothSco()
            @Suppress("DEPRECATION")
            am.isBluetoothScoOn = true
        }
        AgentInCallService.forceBluetooth()
    }

    private fun clearCallAudio() {
        val am = audio()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                am.clearCommunicationDevice()
            } catch (_: Exception) {
            }
        }
        am.mode = AudioManager.MODE_NORMAL
    }

    private fun stopRecorder() {
        try {
            player?.stop()
        } catch (_: Exception) {
        }
        try {
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        try {
            recorder?.stop()
        } catch (_: Exception) {
        }
        try {
            recorder?.release()
        } catch (_: Exception) {
        }
        recorder = null
    }

    private fun fail(reason: String) {
        if (!finished.compareAndSet(false, true)) return
        stopRecorder()
        hangUp()
        AgentFiles.writeStatus("error:$reason")
        stopSelf()
    }

    private fun notification(text: String): Notification {
        val launch = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Call Agent")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(launch)
            .setOngoing(true)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Call Agent", NotificationManager.IMPORTANCE_LOW),
        )
    }

    override fun onDestroy() {
        unregisterCallState()
        handler.removeCallbacks(pollAnswer)
        stopRecorder()
        executor.shutdownNow()
        playerExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun unregisterCallState() {
        val tm = telephony ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            modernCallback?.let {
                try {
                    tm.unregisterTelephonyCallback(it)
                } catch (_: Exception) {
                }
            }
        } else {
            legacyListener?.let {
                @Suppress("DEPRECATION")
                tm.listen(it, PhoneStateListener.LISTEN_NONE)
            }
        }
    }

    companion object {
        private const val CHANNEL = "call-agent"
        private const val HOLD_TIMEOUT_MS = 120_000L
    }
}
