package com.zungun.runtime.network

import android.content.Context
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.receipt.VerificationKey

fun interface CredentialProvider {
    suspend fun bearerToken(): String
}

fun interface VerificationKeyResolver {
    suspend fun resolve(keyId: String): VerificationKey?
}

data class ReceiverConfiguration(
    val endpointUrl: String,
    val receiverId: String,
    val credentialProvider: CredentialProvider,
    val verificationKeyResolver: VerificationKeyResolver? = null,
    val connectTimeoutMs: Int = 10_000,
    val readTimeoutMs: Int = 20_000,
    val allowCleartextLoopback: Boolean = false,
)

interface DeliveryDependencyProvider {
    fun database(context: Context): ZungunDatabase = ZungunDatabase.open(context)
    fun receiverConfiguration(context: Context): ReceiverConfiguration
    fun semanticRevalidator(context: Context): SemanticRevalidator
    fun transportClient(context: Context): ReceiverTransportClient = HttpReceiverTransportClient()
}

object DeliveryRuntimeRegistry {
    @Volatile private var provider: DeliveryDependencyProvider? = null

    fun install(value: DeliveryDependencyProvider) {
        provider = value
    }

    fun clear() {
        provider = null
    }

    fun require(): DeliveryDependencyProvider = provider
        ?: error("ZUNGUN_DELIVERY_PROVIDER_NOT_CONFIGURED")
}
