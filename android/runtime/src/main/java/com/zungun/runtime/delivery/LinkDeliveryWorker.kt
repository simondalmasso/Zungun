package com.zungun.runtime.delivery

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.zungun.runtime.db.EvidenceEntity
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.link.*
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.DeliveryDependencyProvider
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import com.zungun.runtime.network.ReceiverReconciliationResult

class LinkDeliveryWorker(context:Context,private val parameters:WorkerParameters):CoroutineWorker(context,parameters){
    override suspend fun doWork():Result{
        val operationId=inputData.getString("operationId")?:return Result.failure();val dependencies=runCatching{DeliveryRuntimeRegistry.require()}.getOrElse{return Result.retry()};val database=dependencies.database(applicationContext);var delegate=false
        try{val operation=database.operations().get(operationId)?:return Result.failure();if(operation.state in TERMINAL_STATES)return Result.success();val now=System.currentTimeMillis();val plan=LinkCoordinator(applicationContext,database).createPlan(operation,now)?:return Result.retry();evidence(database,operationId,"TRANSMISSION_PLAN_CREATED",now,plan.planId,"decision=${plan.decision.name};adapter=${plan.adapterId?:"none"};reasons=${plan.reasonCodes.joinToString(",")}")
            when(plan.decision){
                LinkDecision.SEND_FULL_NOW,LinkDecision.SEND_CRITICAL_CORE_NOW,LinkDecision.SEND_DELTA_NOW->{database.link().setRetryGate(operationId,false,plan.nextEligibilityAtMs,now);if(plan.decision==LinkDecision.SEND_CRITICAL_CORE_NOW)evidence(database,operationId,"CRITICAL_CORE_SEND_AUTHORIZED",now,plan.planId,"plannedBytes=${plan.plannedBytes}");delegate=true}
                LinkDecision.RECONCILE_BEFORE_RETRY->{if(!reconcileBeforeRetry(database,dependencies,operation,plan.planId,now))return Result.retry();delegate=true}
                LinkDecision.PREFETCH_WHEN_GOOD->{LinkPrefetchScheduler.enqueue(applicationContext,operationId);database.link().setRetryGate(operationId,false,plan.nextEligibilityAtMs,now);return Result.retry()}
                LinkDecision.DEFER_HEAVY->{DeferredTransferScheduler.enqueue(applicationContext,operationId);database.link().setRetryGate(operationId,false,plan.nextEligibilityAtMs,now);evidence(database,operationId,"HEAVY_OBJECT_DEFERRED",now,plan.planId,"plannedBytes=${plan.plannedBytes}");return Result.retry()}
                LinkDecision.WAIT_FOR_VALIDATED_LINK->{database.link().setRetryGate(operationId,false,plan.nextEligibilityAtMs,now);return Result.retry()}
                LinkDecision.REJECT_BY_POLICY->{database.link().setRetryGate(operationId,true,null,now);return Result.failure(workDataOf("error" to "LINK_RETRY_POLICY_BLOCKED"))}
                LinkDecision.EXPIRED_NO_SEND->{database.operations().forceState(operationId,OperationState.EXPIRED.name,"LINK_PROFILE_EXPIRED",now,operation.attempts);database.link().setRetryGate(operationId,true,null,now);return Result.failure(workDataOf("error" to "LINK_PROFILE_EXPIRED"))}
            }
        }finally{database.close()}
        return if(delegate)DeliveryWorker(applicationContext,parameters).doWork()else Result.retry()
    }
    private suspend fun reconcileBeforeRetry(database:com.zungun.runtime.db.ZungunDatabase,dependencies:DeliveryDependencyProvider,operation:OperationEntity,planId:String,now:Long):Boolean{
        evidence(database,operation.operationId,"RECONCILIATION_STARTED",now,planId,"receiver_query_before_retry")
        return when(val result=dependencies.reconciliationClient(applicationContext).query(operation,dependencies.receiverConfiguration(applicationContext),now)){
            is ReceiverReconciliationResult.AcceptanceRecovered->{val at=System.currentTimeMillis();evidence(database,operation.operationId,"RECONCILIATION_RESULT",at,planId,"ACCEPTANCE_RECOVERED:${result.receiverState}");val receipt=result.receipt;if(receipt!=null){LinkCompletionPolicy.persistAcceptedReceipt(database,operation.operationId,receipt,at,operation.attempts);database.link().setRetryGate(operation.operationId,false,null,at);if(database.link().requiredEffectPendingCount(operation.operationId)>0)DeferredTransferScheduler.enqueue(applicationContext,operation.operationId)}else{database.operations().forceState(operation.operationId,OperationState.RECEIVER_ACCEPTED.name,"APPLICATION_ACK_MISSING",at,operation.attempts);database.link().setRetryGate(operation.operationId,true,null,at)};false}
            is ReceiverReconciliationResult.BoundedNotAccepted->{val at=System.currentTimeMillis();evidence(database,operation.operationId,"RECONCILIATION_RESULT",at,result.evidenceId,"BOUNDED_NOT_ACCEPTED");database.link().setRetryGate(operation.operationId,false,null,at);true}
            ReceiverReconciliationResult.NotFoundUnbounded->{val at=System.currentTimeMillis();evidence(database,operation.operationId,"RECONCILIATION_RESULT",at,planId,"NOT_FOUND_UNBOUNDED");database.link().setRetryGate(operation.operationId,true,null,at);false}
            is ReceiverReconciliationResult.QueryFailed->{val at=System.currentTimeMillis();evidence(database,operation.operationId,"RECONCILIATION_RESULT",at,planId,"QUERY_FAILED:${result.code}");database.link().setRetryGate(operation.operationId,true,null,at);false}
        }
    }
    private suspend fun evidence(database:com.zungun.runtime.db.ZungunDatabase,operationId:String,kind:String,at:Long,reference:String,detail:String){database.operations().evidence(EvidenceEntity(operationId=operationId,source="DEVICE",kind=kind,occurredAtMs=at,reference=reference,payloadJson="{\"detail\":${org.json.JSONObject.quote(detail)}}",sha256=EvidenceHasher.sha256("$operationId|$kind|$at|$reference|$detail")))}
    companion object{private val TERMINAL_STATES=setOf(OperationState.COMPLETED.name,OperationState.REJECTED.name,OperationState.EXPIRED.name,OperationState.CANCELLED.name)}
}
