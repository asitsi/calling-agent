package com.idea.callagent

import android.content.Context
import android.os.Environment
import java.io.File

object AgentFiles {
    private var root: File? = null

    fun init(context: Context) {
        val external = context.getExternalFilesDir(null)
        val download = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "call-agent",
        )
        root = when {
            external != null -> {
                external.mkdirs()
                external
            }
            download.exists() || download.mkdirs() -> download
            else -> context.filesDir
        }
    }

    fun dir(): File {
        return root ?: File("/sdcard/Android/data/com.idea.callagent/files").also { it.mkdirs() }
    }

    fun prompt(): File {
        val names = arrayOf("how-are-you.wav", "how-are-you.mp3")
        for (name in names) {
            val primary = File(dir(), name)
            if (primary.exists()) return primary
            val download = File("/sdcard/Download/call-agent", name)
            if (download.exists()) return download
        }
        return File(dir(), "how-are-you.wav")
    }

    fun statusFile(): File = File(dir(), "status.txt")

    fun writeStatus(value: String) {
        dir().mkdirs()
        statusFile().writeText(value)
    }

    fun newAnswerFile(): File {
        val name = "answer-${System.currentTimeMillis()}.m4a"
        return File(dir(), name)
    }

    fun hangupRequested(): Boolean {
        if (File(dir(), "agent-hangup").exists()) return true
        return File("/sdcard/Download/call-agent/agent-hangup").exists()
    }

    fun clearFlags() {
        File(dir(), "agent-hangup").delete()
        File("/sdcard/Download/call-agent/agent-hangup").delete()
    }

    fun remoteAnsweredFlag(): File = File(dir(), "remote-answered")

    fun remoteAnsweredFlagExists(): Boolean {
        if (remoteAnsweredFlag().exists()) return true
        return File("/sdcard/Download/call-agent/remote-answered").exists()
    }
}
