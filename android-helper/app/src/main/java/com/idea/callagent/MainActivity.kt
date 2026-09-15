package com.idea.callagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.telecom.TelecomManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private val requestCode = 42

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        AgentFiles.init(this)
        AgentFiles.dir().mkdirs()

        if (hasPermissions()) {
            startAgent()
        } else {
            findViewById<TextView>(R.id.status).text =
                "Grant Phone, Microphone, and Notifications, then run npm start again."
            ActivityCompat.requestPermissions(this, requiredPermissions(), requestCode)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != this.requestCode) return
        if (hasPermissions()) {
            startAgent()
        } else {
            AgentFiles.writeStatus("error:permissions-denied")
            findViewById<TextView>(R.id.status).text =
                "Permissions denied. Enable Phone and Mic in system settings."
        }
    }

    private fun startAgent() {
        val callee = intent.getStringExtra("callee")
        val answerWaitMs = intent.getIntExtra("answerWaitMs", 6000)
        if (callee.isNullOrBlank()) {
            maybeRequestDialerRole()
            findViewById<TextView>(R.id.status).text =
                "Helper installed. If asked, set Call Agent as the default Phone app so the other person can hear the prompt. Then run npm start."
            AgentFiles.writeStatus("idle")
            return
        }
        findViewById<TextView>(R.id.status).text = "Calling $callee"
        val service = Intent(this, CallAgentService::class.java)
            .putExtra("callee", callee)
            .putExtra("answerWaitMs", answerWaitMs)
            .putExtra("playPrompt", intent.getBooleanExtra("playPrompt", true))
            .putExtra("recordAnswer", intent.getBooleanExtra("recordAnswer", true))
            .putExtra("useBluetooth", intent.getBooleanExtra("useBluetooth", false))
        ContextCompat.startForegroundService(this, service)
    }

    private fun maybeRequestDialerRole() {
        val tm = getSystemService(TELECOM_SERVICE) as TelecomManager
        if (tm.defaultDialerPackage == packageName) return
        try {
            startActivity(
                Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER)
                    .putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, packageName),
            )
        } catch (_: Exception) {
        }
    }

    private fun requiredPermissions(): Array<String> {
        val list = mutableListOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.ANSWER_PHONE_CALLS,
        )
        if (Build.VERSION.SDK_INT >= 33) {
            list += Manifest.permission.POST_NOTIFICATIONS
        }
        if (Build.VERSION.SDK_INT >= 31) {
            list += Manifest.permission.BLUETOOTH_CONNECT
        }
        return list.toTypedArray()
    }

    private fun hasPermissions(): Boolean {
        return requiredPermissions().all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }
}
