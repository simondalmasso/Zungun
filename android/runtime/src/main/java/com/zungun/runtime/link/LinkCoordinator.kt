package com.zungun.runtime.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.room.withTransaction
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import java.security.MessageDigest

class LinkCoordinator(private val context:Context,private val database:ZungunDatabase){
    init{LinkNetworkWakeRegistry.ensure(context.applicationContext)}
    suspend fun createPlan(operation:OperationEntity,nowMs:Long=System.currentTimeMillis()):TransmissionPlan?{
        val state=database.link().state(operation.operationId)?:return null;val profile=LinkPersistence.profile(state.profileJson);val snapshot=observeSnapshot(nowMs);val deferred=database.link().deferredFor(operation.operationId);if(database.link().unsatisfiedDependencyCount(operation.operationId)>0)return null
        val provider=DeliveryRuntimeRegistry.require();val delta=LinkPersistence.payloadMetadata(state.profileJson)?.delta
        val receiverCaps=if(delta!=null)provider.receiverCapabilityClient(context).fetch(context,provider.receiverConfiguration(context),delta.baseSha256,nowMs)else null
        val pendingDeferred=deferred.filter{it.state!="COMPLETED"};val deferredBytes=pendingDeferred.sumOf{it.byteLength}.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        val fullBytes=if(pendingDeferred.isEmpty())operation.payload.size else Int.MAX_VALUE
        val deltaAvailable=delta!=null&&receiverCaps?.validAt(nowMs)==true&&receiverCaps.deltaMode=="EXACT_BASE"&&receiverCaps.exactBaseAvailable
        val payload=LinkPayloadShape(fullBytes=fullBytes,criticalCoreBytes=operation.payload.size,deferredBytes=deferredBytes,deltaBytes=delta?.payload?.size,deltaBaseRequired=delta?.baseSha256,deltaBaseAvailable=delta?.baseSha256?.takeIf{deltaAvailable},hasRequiredDeferredEvidence=pendingDeferred.any{it.requirement=="REQUIRED_FOR_FINAL_EVIDENCE"})
        val plannerCaps=RuntimeTransportSelector.plannerCapabilities(profile,provider.transportCapabilities(context))
        val input=LinkPlannerInput(nowMs=nowMs,opId=operation.operationId,profile=profile,snapshot=snapshot,payload=payload,transports=plannerCaps,priorAmbiguousOutcome=operation.state in setOf("UNKNOWN","DELIVERING","RECEIVER_ACCEPTED"),automaticRetryAttempt=operation.attempts>0,activeProbeBytesUsed=state.activeProbeBytesUsed,hasOutstandingDeferredObjects=pendingDeferred.isNotEmpty(),prefetchEligible=database.link().pendingPrefetch(operation.operationId).isNotEmpty())
        val plan=LinkPlanner.create(input)
        database.withTransaction{val observation=LinkPersistence.observation(operation.operationId,snapshot);database.link().observation(observation);database.link().setLatestSnapshot(operation.operationId,snapshot.snapshotId,nowMs);database.link().plan(LinkPersistence.plan(operation.operationId,plan,nowMs));database.link().setLatestPlan(operation.operationId,plan.planId,nowMs);database.link().pruneObservations(operation.operationId,16);database.link().prunePlans(operation.operationId,32)}
        return plan
    }
    fun deferredEligible(profile:DeliveryProfileV2,snapshot:LinkSnapshot,required:Boolean,nowMs:Long):Boolean{if(!snapshot.hasNetwork||!snapshot.internetCapable||snapshot.suspended||snapshot.captivePortal)return false;if(!snapshot.validated&&!profile.allowUnvalidated)return false;if(snapshot.metered&&!snapshot.temporarilyUnmetered&&!profile.allowMetered)return false;if(snapshot.roaming&&!profile.allowRoaming)return false;val near=profile.deadlineAtMs?.let{nowMs+(profile.maxDelayMs?:0)>=it}?:false;if(snapshot.congested&&!profile.allowCongested&&!(required&&near))return false;val good=snapshot.validated&&!snapshot.captivePortal&&!snapshot.suspended&&(!snapshot.metered||snapshot.temporarilyUnmetered)&&!snapshot.congested&&!snapshot.roaming;return good||(required&&near)}
    fun observeSnapshot(nowMs:Long=System.currentTimeMillis()):LinkSnapshot{LinkNetworkWakeRegistry.latest(nowMs)?.let{return it};val manager=context.getSystemService(ConnectivityManager::class.java);val network=manager.activeNetwork?:return offline(nowMs);val caps=manager.getNetworkCapabilities(network)?:return offline(nowMs);val transports=listOf(NetworkCapabilities.TRANSPORT_CELLULAR to "CELLULAR",NetworkCapabilities.TRANSPORT_WIFI to "WIFI",NetworkCapabilities.TRANSPORT_ETHERNET to "ETHERNET",NetworkCapabilities.TRANSPORT_VPN to "VPN",NetworkCapabilities.TRANSPORT_BLUETOOTH to "BLUETOOTH").filter{caps.hasTransport(it.first)}.map{it.second}.sorted();val raw="$nowMs|${caps.hashCode()}";val id="ls_"+MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()).joinToString(""){"%02x".format(it)}.take(32);return LinkSnapshot(id,nowMs,30_000,true,caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),android.os.Build.VERSION.SDK_INT>=30&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED),!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_CONGESTED),!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING),caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN),!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED),caps.linkDownstreamBandwidthKbps.takeIf{it>0},caps.linkUpstreamBandwidthKbps.takeIf{it>0},transports,"active-default",null,null,null)}
    private fun offline(nowMs:Long)=LinkSnapshot("offline-$nowMs",nowMs,30_000,false,false,false,false,false,false,false,false,false,false,null,null,emptyList(),null,null,null,null)
}
