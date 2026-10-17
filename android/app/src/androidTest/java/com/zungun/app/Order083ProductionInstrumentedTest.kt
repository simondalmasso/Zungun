package com.zungun.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.zungun.runtime.Zungun
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.link.*
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class Order083ProductionInstrumentedTest {
    private val context=ApplicationProvider.getApplicationContext<Context>()
    private val app=context as ZungunApplication
    private val origin="https://zungun.simondalmasso44.workers.dev"
    data class RemoteIdentity(val userId:String,val displayName:String,val pairingCode:String,val token:String)

    @Before fun reset(){app.sessions.clear();context.deleteDatabase("zungun-critical-operations.db");context.deleteDatabase("zungun-product-v1.db")}

    @Test fun fieldAndMessengerAgainstRealWorker()=runBlocking {
        val field=app.api.createIdentity("ORDER083 Android ${System.nanoTime()}");app.installRuntime()
        val control=createRemote("ORDER083 Control Android")
        val work=request("/api/v1/work-orders","POST",control.token,JSONObject().put("title","Android production E2E").put("description","ORDER083 Gate41").put("assigneeCode",field.pairingCode).put("expiresAtMs",System.currentTimeMillis()+3_600_000)).getJSONObject("workOrder")
        val now=System.currentTimeMillis();val payload=JSONObject().put("kind","ZUNGUN_FIELD_ACTION_V1").put("workOrderId",work.getString("workOrderId")).put("expectedRevision",work.getInt("revision")).put("action","COMPLETE").put("note","android real worker").toString().toByteArray()
        val req=EnqueueRequest("zungun-v1",app.sessions.deviceId(),app.sessions.nextSequence(),"WORK_ORDER",work.getString("workOrderId"),work.getString("workOrderId"),"field:${work.getString("workOrderId")}:COMPLETE",sha256(payload),payload,"application/vnd.zungun.field-action+json",OperationPolicy(8,now,work.getLong("expiresAtMs"),8,false,true,64_000))
        val profile=DeliveryProfileV2(urgency=LinkUrgency.HIGH,deadlineAtMs=work.getLong("expiresAtMs")-30_000,expiresAtMs=work.getLong("expiresAtMs"),maxDelayMs=30_000,retryContract=LinkRetryContract.RECONCILE_BEFORE_RETRY,idempotencyRequired=true,semanticRevalidationRequired=true,orderingKey=work.getString("workOrderId"),dependencies=emptyList(),payloadStrategy=LinkPayloadStrategy.FULL_ONLY,maxImmediateBytes=64_000,allowMetered=true,allowRoaming=true,allowCongested=true,heavyDataPolicy="NONE",activeProbeBudgetBytes=0,transportAllowlist=listOf("http"),receiptRequirement="APPLICATION_ACK",evidenceRequirement="VERIFIED_RECEIPT")
        val operationId=CriticalOperationRuntime(context).enqueue(req,profile)
        waitForWork("zungun:$operationId")
        val status=Zungun.status(context,operationId);assertNotNull(status);assertEquals("COMPLETED",status!!.semanticState);assertTrue(status.effectComplete);assertNotNull(status.immediateReceiptId)
        val remoteWork=request("/api/v1/work-orders/${work.getString("workOrderId")}","GET",control.token,null).getJSONObject("workOrder");assertEquals("COMPLETED",remoteWork.getString("status"));assertEquals(operationId,remoteWork.getString("effectOperationId"))

        val recipient=createRemote("ORDER083 Browser peer")
        val messenger=MessengerClient(context);val conversationId=messenger.createConversation(recipient.pairingCode);val messageId=messenger.send(conversationId,"ORDER083 Android message")
        waitUntil(60_000){MessageStore(context).get(messageId)?.state in setOf("SENT","DELIVERED")}
        val before=MessageStore(context).get(messageId)!!;assertEquals("SENT",before.state)
        val history=request("/api/v1/conversations/$conversationId/messages?after=0","GET",recipient.token,null).getJSONArray("items");val exact=(0 until history.length()).map{history.getJSONObject(it)}.single{it.getString("messageId")==messageId};assertTrue(exact.isNull("deliveredAtMs"))
        request("/api/v1/conversations/$conversationId/messages/$messageId/ack","POST",recipient.token,JSONObject())
        messenger.sync(conversationId);val delivered=MessageStore(context).get(messageId)!!;assertEquals("DELIVERED",delivered.state);assertNotNull(delivered.deliveredAtMs)
    }


    @Test fun messengerToBrowserPairingArgument()=runBlocking {
        val peerCode=InstrumentationRegistry.getArguments().getString("peerCode")?:error("peerCode argument required")
        app.api.createIdentity("ORDER083 Android Browser Bridge ${System.nanoTime()}");app.installRuntime()
        val messenger=MessengerClient(context);val conversationId=messenger.createConversation(peerCode);val messageId=messenger.send(conversationId,"ORDER083 Android to browser")
        waitUntil(90_000){
            runCatching{messenger.sync(conversationId)}
            MessageStore(context).get(messageId)?.state=="DELIVERED"
        }
        val delivered=MessageStore(context).get(messageId)!!;assertEquals("DELIVERED",delivered.state);assertNotNull(delivered.deliveredAtMs)
    }

    private fun createRemote(name:String):RemoteIdentity{val j=request("/api/v1/identity","POST",null,JSONObject().put("displayName",name).put("client","android"));val i=j.getJSONObject("identity");return RemoteIdentity(i.getString("userId"),i.getString("displayName"),i.getString("pairingCode"),j.getString("sessionToken"))}
    private fun request(path:String,method:String,token:String?,body:JSONObject?):JSONObject{val c=URL(origin+path).openConnection() as HttpURLConnection;try{c.requestMethod=method;c.connectTimeout=15_000;c.readTimeout=30_000;c.setRequestProperty("accept","application/json");if(token!=null)c.setRequestProperty("authorization","Bearer $token");if(body!=null){c.doOutput=true;c.setRequestProperty("content-type","application/json");c.outputStream.use{it.write(body.toString().toByteArray())}};val code=c.responseCode;val text=(if(code>=400)c.errorStream else c.inputStream)?.bufferedReader()?.use{it.readText()}?:"{}";if(code !in 200..299)error("HTTP_${code}:${JSONObject(text).optString("error")}");return JSONObject(text)}finally{c.disconnect()}}
    private suspend fun waitForWork(name:String){val wm=WorkManager.getInstance(context);val deadline=System.currentTimeMillis()+90_000;while(System.currentTimeMillis()<deadline){val infos=wm.getWorkInfosForUniqueWork(name).get(10,TimeUnit.SECONDS);if(infos.any{it.state==WorkInfo.State.SUCCEEDED})return;if(infos.any{it.state==WorkInfo.State.FAILED||it.state==WorkInfo.State.CANCELLED})error("WORK_FAILED:$name:${infos.map{it.state}}");delay(500)};error("WORK_TIMEOUT:$name")}
    private suspend fun waitUntil(timeout:Long,p:suspend ()->Boolean){val end=System.currentTimeMillis()+timeout;while(System.currentTimeMillis()<end){if(p())return;delay(400)};error("TIMEOUT")}
    private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
}
