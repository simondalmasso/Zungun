package com.zungun.runtime.delivery

import android.content.Context
import androidx.room.withTransaction
import androidx.work.*
import com.zungun.runtime.db.*
import com.zungun.runtime.link.*
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationState
import java.util.concurrent.TimeUnit

class CriticalOperationRuntime(private val context:Context,private val database:ZungunDatabase=ZungunDatabase.open(context)){
    suspend fun enqueue(request:EnqueueRequest,nowMs:Long=request.policy.createdAtMs):String=enqueueInternal(request,null,emptyList(),emptyList(),nowMs,null)
    suspend fun enqueue(request:EnqueueRequest,deliveryProfile:DeliveryProfileV2,deferredObjects:List<LinkDeferredObjectSpec> = emptyList(),prefetchHints:List<LinkPrefetchSpec> = emptyList(),nowMs:Long=request.policy.createdAtMs):String=enqueueInternal(request,deliveryProfile,deferredObjects,prefetchHints,nowMs,null)
    suspend fun enqueue(request:EnqueueRequest,deliveryProfile:DeliveryProfileV2,deferredObjects:List<LinkDeferredObjectSpec>,prefetchHints:List<LinkPrefetchSpec>,nowMs:Long,deltaSpec:LinkDeltaSpec?):String=enqueueInternal(request,deliveryProfile,deferredObjects,prefetchHints,nowMs,deltaSpec)

    private suspend fun enqueueInternal(request:EnqueueRequest,profile:DeliveryProfileV2?,deferredObjects:List<LinkDeferredObjectSpec>,prefetchHints:List<LinkPrefetchSpec>,nowMs:Long,deltaSpec:LinkDeltaSpec?):String{
        require(request.payload.size<=request.policy.maxPayloadBytes){"Payload exceeds maxPayloadBytes"};require(request.policy.expiresAtMs>nowMs){"Operation must not be expired when enqueued"};require(request.policy.retryBudget in 0..100){"retryBudget must be between 0 and 100"}
        if(profile!=null){require(profile.expiresAtMs==null||profile.expiresAtMs>nowMs){"Link profile already expired"};require(profile.dependencies.distinct().size==profile.dependencies.size){"Duplicate Link dependency"};require(deferredObjects.distinctBy{it.objectId}.size==deferredObjects.size){"Duplicate deferred object"};require(prefetchHints.distinctBy{it.resourceKey}.size==prefetchHints.size){"Duplicate prefetch hint"};if(deltaSpec!=null)require(profile.payloadStrategy==LinkPayloadStrategy.DELTA_ALLOWED){"LINK_DELTA_REQUIRES_DELTA_ALLOWED"}}
        val operationId=StableIdentity.operationId(request.tenantId,request.deviceId,request.localSequence,request.policy.createdAtMs)
        val entity=OperationEntity(operationId,"idem_$operationId",request.tenantId,request.deviceId,request.scopeType,request.scopeId,request.workOrderId,request.messageId,request.messageCommitment,"nonce_$operationId",request.payload,request.contentType,request.policy.priority,request.policy.createdAtMs,request.policy.expiresAtMs,request.policy.retryBudget,request.policy.maxPayloadBytes,0,request.policy.cancellationAllowed,request.policy.semanticRevalidationRequired,OperationState.QUEUED.name,null,nowMs)
        database.withTransaction{
            val inserted=database.operations().insert(entity)
            if(inserted==-1L){val existing=database.operations().get(operationId)?:error("IDEMPOTENCY_CONFLICT");require(existing.messageCommitment==request.messageCommitment&&existing.payload.contentEquals(request.payload)){"IDEMPOTENCY_CONFLICT"};if(profile!=null){val expected=LinkPersistence.state(operationId,profile,nowMs,LinkPayloadMetadata(deltaSpec)).profileHash;require(database.link().state(operationId)?.profileHash==expected){"LINK_IDEMPOTENCY_CONFLICT"}}}
            else{
                database.operations().evidence(EvidenceEntity(operationId=operationId,source="DEVICE",kind="QUEUED",occurredAtMs=nowMs,reference="local",payloadJson="{}",sha256=EvidenceHasher.sha256("$operationId|QUEUED|$nowMs")));WitnessChain.initial(operationId,request.deviceId,nowMs).forEach{database.operations().witnessEvidence(it)}
                if(profile!=null){database.link().linkState(LinkPersistence.state(operationId,profile,nowMs,LinkPayloadMetadata(deltaSpec)));profile.dependencies.forEach{database.link().dependency(OperationDependencyEntity(operationId,it))};deferredObjects.forEach{spec->require(spec.byteLength>=0&&spec.sha256.matches(Regex("[0-9a-f]{64}"))){"LINK_DEFERRED_DESCRIPTOR_INVALID"};require(spec.requirement in setOf("REQUIRED_FOR_EFFECT","REQUIRED_FOR_FINAL_EVIDENCE","OPTIONAL")){"LINK_DEFERRED_REQUIREMENT_INVALID"};database.link().deferred(DeferredObjectEntity(operationId,spec.objectId,spec.contentType,spec.byteLength,spec.sha256,spec.requirement,spec.chunkSizeBytes,org.json.JSONArray(spec.chunkHashes).toString(),"PENDING",nowMs))};prefetchHints.forEach{hint->require(hint.resourceKey.matches(Regex("[A-Za-z0-9._:-]{1,256}"))&&hint.revisionOrHash.isNotBlank()&&hint.providerKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))){"LINK_PREFETCH_HINT_INVALID"};require(hint.sizeEstimate in 0..64L*1024*1024&&hint.expiresAtMs>nowMs){"LINK_PREFETCH_HINT_INVALID"};database.link().prefetchHint(LinkPrefetchHintEntity(operationId,hint.resourceKey,hint.revisionOrHash,hint.sizeEstimate,hint.expiresAtMs,hint.priority,hint.sensitivityClass,hint.providerKey,"PENDING",nowMs))}}
            }
        }
        if(profile!=null)LinkNetworkWakeRegistry.ensure(context);schedule(operationId,profile!=null);return operationId
    }
    fun schedule(operationId:String,linkEnabled:Boolean=false,initialDelayMs:Long=0){val builder=(if(linkEnabled)OneTimeWorkRequestBuilder<LinkDeliveryWorker>() else OneTimeWorkRequestBuilder<DeliveryWorker>()).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setInputData(workDataOf("operationId" to operationId)).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS).addTag("zungun:$operationId");if(initialDelayMs>0)builder.setInitialDelay(initialDelayMs,TimeUnit.MILLISECONDS);WorkManager.getInstance(context).enqueueUniqueWork("zungun:$operationId",ExistingWorkPolicy.KEEP,builder.build())}
    suspend fun cancel(operationId:String,nowMs:Long):Boolean{val cancelled=database.operations().cancel(operationId,nowMs)==1;if(cancelled)WorkManager.getInstance(context).cancelUniqueWork("zungun:$operationId");return cancelled}
    suspend fun recoverPending():Int{val pending=database.link().recoverableOperations();pending.forEach{schedule(it.operationId,database.link().state(it.operationId)!=null)};return pending.size}
}
