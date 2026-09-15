package com.idea.callagent

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object CallAudioPlayer {
    fun play(context: Context, wav: File) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_IN_CALL
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.availableCommunicationDevices
                .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                ?.let { am.setCommunicationDevice(it) }
        }
        AgentInCallService.forceSpeaker()
        am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0)

        val done = CountDownLatch(2)
        val alarm = startPlayer(wav, AudioAttributes.USAGE_ALARM, AudioManager.STREAM_ALARM, done)
        val music = startPlayer(wav, AudioAttributes.USAGE_MEDIA, AudioManager.STREAM_MUSIC, done)
        done.await(45, TimeUnit.SECONDS)
        releaseQuietly(alarm)
        releaseQuietly(music)
    }

    private fun startPlayer(
        wav: File,
        usage: Int,
        stream: Int,
        done: CountDownLatch,
    ): MediaPlayer {
        val mp = MediaPlayer()
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(usage)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .setLegacyStreamType(stream)
                .build(),
        )
        mp.setDataSource(wav.absolutePath)
        mp.setOnCompletionListener { done.countDown() }
        mp.setOnErrorListener { _, _, _ ->
            done.countDown()
            true
        }
        mp.prepare()
        mp.setVolume(1f, 1f)
        mp.start()
        return mp
    }

    private fun releaseQuietly(mp: MediaPlayer) {
        try {
            if (mp.isPlaying) mp.stop()
        } catch (_: Exception) {
        }
        try {
            mp.release()
        } catch (_: Exception) {
        }
    }
}
