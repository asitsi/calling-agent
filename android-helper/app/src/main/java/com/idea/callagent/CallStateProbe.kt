package com.idea.callagent

/**
 * Android CALL_STATE_OFFHOOK fires when *this* phone starts dialing, not when
 * the remote party picks up. Precise foreground state 1 = ACTIVE (answered).
 */
object CallStateProbe {
    const val ACTIVE = 1

    fun isRemoteAnswered(): Boolean {
        if (AgentFiles.remoteAnsweredFlagExists()) return true
        val tel = dumpsys("telephony.registry")
        val states = Regex("(?i)m?ForegroundCallState=(\\d+)").findAll(tel)
            .map { it.groupValues[1].toIntOrNull() }
            .filterNotNull()
            .toList()
        if (states.contains(ACTIVE)) return true
        if (Regex("(?i)foregroundCall:\\s*active").containsMatchIn(tel)) return true

        val telecom = dumpsys("telecom")
        if (Regex("(?i)(mState|CallState|state):\\s*ACTIVE").containsMatchIn(telecom) &&
            !Regex("(?i)(mState|CallState|state):\\s*(DIALING|CONNECTING|RINGING|ALERTING)").containsMatchIn(telecom)
        ) {
            return true
        }
        return false
    }

    private fun dumpsys(service: String): String {
        return try {
            val proc = Runtime.getRuntime().exec(arrayOf("dumpsys", service))
            proc.inputStream.bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            ""
        }
    }
}
