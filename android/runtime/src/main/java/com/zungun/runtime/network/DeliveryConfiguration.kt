package com.zungun.runtime.network

import android.content.Context
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.link.DeferredTransferAdapter
import com.zungun.runtime.link.LinkPrefetchAdapter
import com.zungun.runtime.link.RuntimeTransportCapability
import com.zungun.runtime.receipt.VerificationKey

fun interface CredentialProvider { suspend fun bearerToken(): String }
fun interface VerificationKeyResolver { suspend fun resolve(keyId: String): VerificationKey? }

data class ReceiverConfiguration(val endpointUrl:String,val receiverId:String,val credentialProvider:CredentialProvider,val verificationKeyResolver:VerificationKeyResolver?=null,val connectTimeoutMs:Int=10_000,val readTimeoutMs:Int=20_000,val allowCleartextLoopback:Boolean=false)

interface DeliveryDependencyProvider {
    fun database(context:Context):ZungunDatabase = ZungunDatabase.open(context)
    fun receiverConfiguration(context:Context):ReceiverConfiguration
    fun semanticRevalidator(context:Context):SemanticRevalidator
    fun transportClient(context:Context):ReceiverTransportClient = HttpReceiverTransportClient()
    fun transportClient(context:Context,adapterId:String):ReceiverTransportClient { require(adapterId=="http") { "LINK_TRANSPORT_ADAPTER_NOT_INSTALLED:$adapterId" }; return transportClient(context) }
    fun transportCapabilities(context:Context):List<RuntimeTransportCapability> = listOf(RuntimeTransportCapability(adapterId="http",available=true,reachabilityClass="INTERNET",maxPayloadBytes=null,supportsDurableReceipt=true,supportsReceiverQuery=true,supportsResume=false,supportsNetworkBinding=true,duplex="FULL"))
    fun receiverCapabilityClient(context:Context):ReceiverCapabilityClient = HttpReceiverCapabilityClient()
    fun reconciliationClient(context:Context):ReceiverReconciliationClient = HttpReceiverReconciliationClient()
    fun deferredTransferAdapter(context:Context):DeferredTransferAdapter? = null
    fun prefetchAdapter(context:Context):LinkPrefetchAdapter? = null
}

object DeliveryRuntimeRegistry {
    @Volatile private var provider:DeliveryDependencyProvider?=null
    fun install(value:DeliveryDependencyProvider){provider=value}
    fun clear(){provider=null}
    fun require():DeliveryDependencyProvider=provider?:error("ZUNGUN_DELIVERY_PROVIDER_NOT_CONFIGURED")
}
