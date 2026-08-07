package com.zungun.runtime.network

import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.receipt.ReceiptVerifier
import com.zungun.runtime.receipt.VerificationKey
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

sealed interface ReceiverReconciliationResult {
    data class AcceptanceRecovered(val receiverState: String,val applicationOutcome: String,val receipt: VerifiedReceipt?) : ReceiverReconciliationResult
    data class BoundedNotAccepted(val evidenceId: String) : ReceiverReconciliationResult
    data object NotFoundUnbounded : ReceiverReconciliationResult
    data class QueryFailed(val code: String) : ReceiverReconciliationResult
}

fun interface ReceiverReconciliationClient { suspend fun query(operation: OperationEntity, configuration: ReceiverConfiguration, nowMs: Long): ReceiverReconciliationResult }

class HttpReceiverReconciliationClient : ReceiverReconciliationClient {
    override suspend fun query(operation: OperationEntity, configuration: ReceiverConfiguration, nowMs: Long): ReceiverReconciliationResult {
        validateEndpoint(configuration); val token=configuration.credentialProvider.bearerToken();require(token.length>=16){"INVALID_CREDENTIAL"}
        return try { val response=request("${configuration.endpointUrl.trimEnd('/')}/api/v1/operations/${operation.operationId}",token,configuration);when(response.status){
            200->{val root=JSONObject(response.body);val row=root.getJSONObject("operation");val receipt=if(root.isNull("receipt"))null else verifyReceipt(operation,configuration,token,root.getJSONObject("receipt"),nowMs);ReceiverReconciliationResult.AcceptanceRecovered(row.getString("state"),row.optString("application_outcome","UNKNOWN"),receipt)}
            404->ReceiverReconciliationResult.NotFoundUnbounded
            else->ReceiverReconciliationResult.QueryFailed("HTTP_${response.status}")
        }}catch(error:IOException){ReceiverReconciliationResult.QueryFailed(error.javaClass.simpleName)}
    }
    private suspend fun verifyReceipt(operation:OperationEntity,configuration:ReceiverConfiguration,token:String,receipt:JSONObject,nowMs:Long):VerifiedReceipt{
        val payload=receipt.getJSONObject("payload");val payloadJson=CanonicalJson.stringify(payload);val keyId=receipt.getString("keyId");val key=configuration.verificationKeyResolver?.resolve(keyId)?:fetchKey(configuration,token,keyId);require(key!=null){"RECEIPT_KEY_NOT_FOUND"};val algorithm=receipt.getString("algorithm");val signature=receipt.getString("signatureBase64");val payloadSha=receipt.getString("payloadSha256");require(ReceiptVerifier.verify(payloadJson,payloadSha,signature,keyId,algorithm,key,nowMs)){"RECEIPT_SIGNATURE_INVALID"};require(payload.getString("operationId")==operation.operationId){"RECEIPT_OPERATION_MISMATCH"};require(payload.getString("messageCommitment")==operation.messageCommitment){"RECEIPT_COMMITMENT_MISMATCH"};require(payload.getString("receiverId")==configuration.receiverId){"RECEIPT_RECEIVER_MISMATCH"};require(payload.getString("scopeType")==operation.scopeType&&payload.getString("scopeId")==operation.scopeId){"RECEIPT_SCOPE_MISMATCH"};require(payload.getString("replayNonce")==operation.replayNonce){"RECEIPT_NONCE_MISMATCH"};return VerifiedReceipt("receipt_${payloadSha.take(32)}",keyId,algorithm,payloadJson,signature,payloadSha,ReceiptVerifier.requireBusinessOutcome(payloadJson))
    }
    private fun fetchKey(configuration:ReceiverConfiguration,token:String,keyId:String):VerificationKey?{val response=request("${configuration.endpointUrl.trimEnd('/')}/api/v1/keys",token,configuration);if(response.status!=200)return null;val items=JSONObject(response.body).getJSONArray("items");for(index in 0 until items.length()){val item=items.getJSONObject(index);if(item.getString("keyId")==keyId)return VerificationKey(keyId,item.getString("publicKeyPem").replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replace(Regex("\\s"),""),item.getLong("validFromMs"),item.getLong("validUntilMs"),if(item.isNull("revokedAtMs"))null else item.getLong("revokedAtMs"))};return null}
    private data class HttpResponse(val status:Int,val body:String)
    private fun request(url:String,token:String,configuration:ReceiverConfiguration):HttpResponse{val connection=URL(url).openConnection() as HttpURLConnection;try{connection.requestMethod="GET";connection.connectTimeout=configuration.connectTimeoutMs;connection.readTimeout=configuration.readTimeoutMs;connection.instanceFollowRedirects=false;connection.setRequestProperty("authorization","Bearer $token");connection.setRequestProperty("accept","application/json");val status=connection.responseCode;val stream=if(status>=400)connection.errorStream else connection.inputStream;return HttpResponse(status,stream?.bufferedReader()?.use{it.readText()}?:"")}finally{connection.disconnect()}}
    private fun validateEndpoint(configuration:ReceiverConfiguration){val uri=URI(configuration.endpointUrl);val loopback=uri.host in setOf("127.0.0.1","localhost","10.0.2.2","::1");require(uri.scheme=="https"||configuration.allowCleartextLoopback&&loopback){"TLS_REQUIRED"}}
}
