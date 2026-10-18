package com.zungun.sample

import android.app.Application
import android.content.Context
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.network.CredentialProvider
import com.zungun.runtime.network.DeliveryDependencyProvider
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import com.zungun.runtime.network.ReceiverConfiguration

class SampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        installFromPreferences()
    }

    fun saveAndInstall(endpoint: String, token: String, receiverId: String) {
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
            .putString("endpoint", endpoint)
            .putString("token", token)
            .putString("receiverId", receiverId)
            .apply()
        install(endpoint, token, receiverId)
    }

    private fun installFromPreferences() {
        val preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
        val endpoint = preferences.getString("endpoint", null) ?: return
        val token = preferences.getString("token", null) ?: return
        val receiverId = preferences.getString("receiverId", "receiver_local_1") ?: "receiver_local_1"
        install(endpoint, token, receiverId)
    }

    private fun install(endpoint: String, token: String, receiverId: String) {
        DeliveryRuntimeRegistry.install(object : DeliveryDependencyProvider {
            override fun receiverConfiguration(context: Context) = ReceiverConfiguration(
                endpointUrl = endpoint,
                receiverId = receiverId,
                credentialProvider = CredentialProvider { token },
                allowCleartextLoopback = true,
            )

            override fun semanticRevalidator(context: Context) = SemanticRevalidator { operation ->
                if (operation.workOrderId.isBlank()) {
                    Result.failure(IllegalStateException("WORK_ORDER_REQUIRED"))
                } else {
                    Result.success(Unit)
                }
            }
        })
    }

    companion object {
        private const val PREFERENCES = "zungun-sample-order076"
    }
}
