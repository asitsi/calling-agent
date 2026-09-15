package com.idea.callagent

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

object WavPcm {
    data class Pcm(val sampleRate: Int, val channels: Int, val samples: ShortArray)

    fun read(file: File): Pcm {
        val bytes = file.readBytes()
        if (bytes.size < 44 || String(bytes, 0, 4) != "RIFF") {
            throw IllegalArgumentException("not a WAV file")
        }
        var offset = 12
        var channels = 1
        var rate = 16000
        var bits = 16
        var data: ByteArray? = null
        while (offset + 8 <= bytes.size) {
            val id = String(bytes, offset, 4)
            val size = ByteBuffer.wrap(bytes, offset + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
            val start = offset + 8
            if (id == "fmt ") {
                val fmt = ByteBuffer.wrap(bytes, start, size).order(ByteOrder.LITTLE_ENDIAN)
                fmt.short
                channels = fmt.short.toInt()
                rate = fmt.int
                fmt.int
                fmt.short
                bits = fmt.short.toInt()
            } else if (id == "data") {
                data = bytes.copyOfRange(start, start + size)
                break
            }
            offset = start + size + (size % 2)
        }
        val pcmBytes = data ?: throw IllegalArgumentException("WAV has no data chunk")
        if (bits != 16) throw IllegalArgumentException("only 16-bit WAV is supported")
        val samples = ShortArray(pcmBytes.size / 2)
        ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
        val mono = if (channels == 1) samples else toMono(samples, channels)
        return Pcm(rate, 1, mono)
    }

    fun to8kMono(pcm: Pcm): ShortArray {
        if (pcm.sampleRate == 8000) return pcm.samples
        val ratio = pcm.sampleRate / 8000.0
        val outLen = (pcm.samples.size / ratio).roundToInt().coerceAtLeast(1)
        val out = ShortArray(outLen)
        for (i in out.indices) {
            val src = (i * ratio).toInt().coerceAtMost(pcm.samples.lastIndex)
            out[i] = pcm.samples[src]
        }
        return out
    }

    private fun toMono(samples: ShortArray, channels: Int): ShortArray {
        val frames = samples.size / channels
        val out = ShortArray(frames)
        for (i in 0 until frames) {
            var sum = 0
            for (c in 0 until channels) sum += samples[i * channels + c]
            out[i] = (sum / channels).toShort()
        }
        return out
    }
}
