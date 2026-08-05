package com.zungun.runtime.model

enum class OperationState { QUEUED, ELIGIBLE, DELIVERING, RECEIVER_ACCEPTED, UNKNOWN, COMPLETED, REJECTED, EXPIRED, CANCELLED }
enum class ConnectivityClass { OFFLINE, CONSTRAINED, UNMETERED }
data class OperationPolicy(val priority:Int,val createdAtMs:Long,val expiresAtMs:Long,val retryBudget:Int,val cancellationAllowed:Boolean,val semanticRevalidationRequired:Boolean,val maxPayloadBytes:Int)
data class EnqueueRequest(val tenantId:String,val deviceId:String,val localSequence:Long,val scopeType:String,val scopeId:String,val workOrderId:String,val messageId:String,val messageCommitment:String,val payload:ByteArray,val contentType:String,val policy:OperationPolicy)
data class DeliveryDecision(val allowed:Boolean,val reason:String,val payloadLimitBytes:Int)
data class ApplicationAck(val outcome:String,val applicationReference:String,val receiptJson:String?)
