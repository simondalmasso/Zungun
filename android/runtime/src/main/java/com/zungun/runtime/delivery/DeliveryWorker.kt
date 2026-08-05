package com.zungun.runtime.delivery
import android.content.Context
import androidx.work.*
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.ConnectivityClassifier

class DeliveryWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){override suspend fun doWork():Result{val id=inputData.getString("operationId")?:return Result.failure();val db=ZungunDatabase.open(applicationContext);val dao=db.operations();val op=dao.get(id)?:return Result.failure();val now=System.currentTimeMillis();if(op.expiresAtMs<=now){dao.transition(id,op.state,OperationState.EXPIRED.name,"TTL_EXPIRED",now,op.attempts);return Result.failure()};if(op.attempts>=op.retryBudget){dao.transition(id,op.state,OperationState.UNKNOWN.name,"RETRY_BUDGET_EXHAUSTED",now,op.attempts);return Result.failure()};val connectivity=ConnectivityClassifier(applicationContext).current();val decision=PayloadPolicy.decide(connectivity,op.payload.size,16_384);if(!decision.allowed)return Result.retry();val changed=dao.transition(id,op.state,OperationState.DELIVERING.name,null,now,op.attempts+1);return if(changed==1)Result.success(workDataOf("operationId" to id,"state" to OperationState.DELIVERING.name))else Result.retry()}}
