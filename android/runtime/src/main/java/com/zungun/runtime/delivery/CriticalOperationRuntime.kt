package com.zungun.runtime.delivery
import android.content.Context
import androidx.room.withTransaction
import androidx.work.*
import com.zungun.runtime.db.*
import com.zungun.runtime.model.*
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class CriticalOperationRuntime(private val context:Context,private val database:ZungunDatabase=ZungunDatabase.open(context)) {
 suspend fun enqueue(request:EnqueueRequest,nowMs:Long=request.policy.createdAtMs):String {require(request.payload.size<=request.policy.maxPayloadBytes);require(request.policy.expiresAtMs>nowMs);val id=StableIdentity.operationId(request.tenantId,request.deviceId,request.localSequence,request.policy.createdAtMs);val entity=OperationEntity(id,"idem_$id",request.tenantId,request.deviceId,request.scopeType,request.scopeId,request.workOrderId,request.messageId,request.messageCommitment,request.payload,request.contentType,request.policy.priority,request.policy.createdAtMs,request.policy.expiresAtMs,request.policy.retryBudget,0,request.policy.cancellationAllowed,request.policy.semanticRevalidationRequired,OperationState.QUEUED.name,null,nowMs);database.withTransaction{database.operations().insert(entity);database.operations().evidence(EvidenceEntity(operationId=id,source="DEVICE",kind="QUEUED",occurredAtMs=nowMs,reference="local",payloadJson="{}",sha256=sha256("$id|QUEUED|$nowMs"))};schedule(id);return id}
 fun schedule(operationId:String){val request=OneTimeWorkRequestBuilder<DeliveryWorker>().setInputData(workDataOf("operationId" to operationId)).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS).addTag("zungun:$operationId").build();WorkManager.getInstance(context).enqueueUniqueWork("zungun:$operationId",ExistingWorkPolicy.KEEP,request)}
 suspend fun cancel(operationId:String,nowMs:Long):Boolean=database.operations().cancel(operationId,nowMs)==1
 suspend fun recoverPending():Int {val pending=database.operations().pending();pending.forEach{schedule(it.operationId)};return pending.size}
 companion object {private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}}
}
