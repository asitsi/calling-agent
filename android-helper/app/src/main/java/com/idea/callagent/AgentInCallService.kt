package com.idea.callagent

import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService

class AgentInCallService : InCallService() {
    override fun onCallAdded(call: Call) {
        instance = this
        applyRoute()
    }

    override fun onCallRemoved(call: Call) {
        if (instance === this) instance = null
    }

    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        if (audioState.route != desiredRoute) applyRoute()
    }

    companion object {
        @Volatile
        var instance: AgentInCallService? = null

        @Volatile
        private var desiredRoute = CallAudioState.ROUTE_SPEAKER

        private fun applyRoute() {
            try {
                instance?.setAudioRoute(desiredRoute)
            } catch (_: Exception) {
            }
        }

        fun forceSpeaker() {
            desiredRoute = CallAudioState.ROUTE_SPEAKER
            applyRoute()
        }

        // Hands the call over to the paired PC, which then supplies the uplink.
        fun forceBluetooth() {
            desiredRoute = CallAudioState.ROUTE_BLUETOOTH
            applyRoute()
        }
    }
}
