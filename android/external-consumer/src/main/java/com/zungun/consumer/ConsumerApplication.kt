package com.zungun.consumer

import android.app.Application
import android.content.Context
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.network.CredentialProvider
import com.zungun.runtime.network.DeliveryDependencyProvider
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import com.zungun.runtime.network.ReceiverConfiguration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class ConsumerApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (installFromPreferences(this)) {
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                runCatching { CriticalOperationRuntime(this@ConsumerApplication).recoverPending() }
            }
        }
    }

    companion object {
        const val PREFERENCES = "zungun-consumer-order076b"
        private const val ENDPOINT = "endpoint"
        private const val TOKEN = "token"
        private const val RECEIVER_ID = "receiverId"

        fun configure(context: Context, endpoint: String, token: String, receiverId: String) {
            require(endpoint.startsWith("http://10.0.2.2:") || endpoint.startsWith("https://"))
            require(token.length >= 16)
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
                .putString(ENDPOINT, endpoint)
                .putString(TOKEN, token)
                .putString(RECEIVER_ID, receiverId)
                .commit()
            install(context, endpoint, token, receiverId)
        }

        fun installFromPreferences(context: Context): Boolean {
            val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            val endpoint = preferences.getString(ENDPOINT, null) ?: return false
            val token = preferences.getString(TOKEN, null) ?: return false
            val receiverId = preferences.getString(RECEIVER_ID, null) ?: return false
            install(context, endpoint, token, receiverId)
            return true
        }

        private fun install(context: Context, endpoint: String, token: String, receiverId: String) {
            DeliveryRuntimeRegistry.install(object : DeliveryDependencyProvider {
                override fun receiverConfiguration(context: Context) = ReceiverConfiguration(
                    endpointUrl = endpoint,
                    receiverId = receiverId,
                    credentialProvider = CredentialProvider { token },
                    connectTimeoutMs = 3_000,
                    readTimeoutMs = 5_000,
                    allowCleartextLoopback = endpoint.startsWith("http://10.0.2.2:"),
                )

                override fun semanticRevalidator(context: Context) = SemanticRevalidator { operation ->
                    if (operation.workOrderId == WORK_ORDER_ID) Result.success(Unit)
                    else Result.failure(IllegalStateException("WORK_ORDER_NOT_AUTHORIZED"))
                }
            })
        }

        const val WORK_ORDER_ID = "WO-ANDROID-076B"
    }
}
