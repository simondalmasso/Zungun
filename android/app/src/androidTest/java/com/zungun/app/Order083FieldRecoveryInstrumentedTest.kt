package com.zungun.app
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zungun.runtime.Zungun
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.link.*
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class Order083FieldRecoveryInstrumentedTest {
 private val context=ApplicationProvider.getApplicationContext<Context>();private val app=context as ZungunApplication;private val mark=context.getSharedPreferences("order083-field-recovery",Context.MODE_PRIVATE)
 @Test fun phase1SetupOnline(){runBlocking{app.sessions.clear();context.deleteDatabase("zungun-critical-operations.db");mark.edit().clear().commit();val field=app.api.createIdentity("ORDER083 Field Recovery ${System.nanoTime()}");app.installRuntime();val ctl=createRemote("ORDER083 Field Recovery Control");val w=request("/api/v1/work-orders","POST",ctl.second,JSONObject().put("title","Field recovery").put("description","ORDER083 B/C").put("assigneeCode",field.pairingCode).put("expiresAtMs",System.currentTimeMillis()+3600000)).getJSONObject("workOrder");mark.edit().putString("work",w.toString()).commit()}}
 @Test fun phase2QueueOffline()=runBlocking{val w=JSONObject(mark.getString("work",null)?:error("NO_WORK"));val op=enqueue(w,"B offline");mark.edit().putString("op_b",op).commit();assertEquals("QUEUED",Zungun.status(context,op)!!.semanticState)}
 @Test fun phase3VerifyRecovered()=runBlocking{app.installRuntime();val w=JSONObject(mark.getString("work",null)?:error("NO_WORK"));val op=mark.getString("op_b",null)?:error("NO_OP_B");waitCompleted(op);val remote=app.api.workOrder(w.getString("workOrderId"));assertEquals("COMPLETED",remote.getString("status"));assertEquals(op,remote.getString("effectOperationId"))}
 @Test fun phase4SetupAmbiguousOnline(){runBlocking{val field=app.sessions.identity()?:error("NO_IDENTITY");val ctl=createRemote("ORDER083 Field Ambiguous Control");val w=request("/api/v1/work-orders","POST",ctl.second,JSONObject().put("title","Field ambiguous").put("description","ORDER083 C").put("assigneeCode",field.pairingCode).put("expiresAtMs",System.currentTimeMillis()+3600000)).getJSONObject("workOrder");mark.edit().putString("work_c",w.toString()).commit()}}
 @Test fun phase5QueueAmbiguousOffline()=runBlocking{val w=JSONObject(mark.getString("work_c",null)?:error("NO_WORK_C"));val op=enqueue(w,"C unknown");mark.edit().putString("op_c",op).commit();context.filesDir.resolve("order083-ambiguous-operation-id.txt").writeText(op);assertEquals("QUEUED",Zungun.status(context,op)!!.semanticState)}
 @Test fun phase6VerifyUnknownThenReconciled()=runBlocking{app.installRuntime();val w=JSONObject(mark.getString("work_c",null)?:error("NO_WORK_C"));val op=mark.getString("op_c",null)?:error("NO_OP_C");waitCompleted(op);val db=ZungunDatabase.open(context);try{val kinds=db.operations().evidenceFor(op).map{it.kind};assertTrue("UNKNOWN evidence missing",kinds.contains("UNKNOWN"));assertTrue("reconciliation evidence missing",kinds.contains("RECONCILIATION_RESULT"))}finally{db.close()};val remote=app.api.workOrder(w.getString("workOrderId"));assertEquals(op,remote.getString("effectOperationId"))}
 private suspend fun enqueue(w:JSONObject,note:String):String{val now=System.currentTimeMillis();val payload=JSONObject().put("kind","ZUNGUN_FIELD_ACTION_V1").put("workOrderId",w.getString("workOrderId")).put("expectedRevision",w.getInt("revision")).put("action","COMPLETE").put("note",note).toString().toByteArray();val r=EnqueueRequest("zungun-v1",app.sessions.deviceId(),app.sessions.nextSequence(),"WORK_ORDER",w.getString("workOrderId"),w.getString("workOrderId"),"field:${w.getString("workOrderId")}:COMPLETE",sha(payload),payload,"application/vnd.zungun.field-action+json",OperationPolicy(8,now,w.getLong("expiresAtMs"),8,false,true,64000));val p=DeliveryProfileV2(urgency=LinkUrgency.HIGH,deadlineAtMs=w.getLong("expiresAtMs")-30000,expiresAtMs=w.getLong("expiresAtMs"),maxDelayMs=30000,retryContract=LinkRetryContract.RECONCILE_BEFORE_RETRY,idempotencyRequired=true,semanticRevalidationRequired=true,orderingKey=w.getString("workOrderId"),dependencies=emptyList(),payloadStrategy=LinkPayloadStrategy.FULL_ONLY,maxImmediateBytes=64000,allowMetered=true,allowRoaming=true,allowCongested=true,heavyDataPolicy="NONE",activeProbeBudgetBytes=0,transportAllowlist=listOf("http"),receiptRequirement="APPLICATION_ACK",evidenceRequirement="VERIFIED_RECEIPT");return CriticalOperationRuntime(context).enqueue(r,p)}
 private suspend fun waitCompleted(op:String){val end=System.currentTimeMillis()+120000;while(System.currentTimeMillis()<end){if(Zungun.status(context,op)?.semanticState=="COMPLETED")return;delay(500)};error("FIELD_RECOVERY_TIMEOUT")}
 private fun createRemote(name:String):Pair<String,String>{val j=request("/api/v1/identity","POST",null,JSONObject().put("displayName",name).put("client","android"));return j.getJSONObject("identity").getString("pairingCode") to j.getString("sessionToken")}
 private fun request(path:String,method:String,token:String?,body:JSONObject?):JSONObject{val c=URL("https://zungun.simondalmasso44.workers.dev"+path).openConnection() as HttpURLConnection;try{c.requestMethod=method;c.doOutput=body!=null;if(token!=null)c.setRequestProperty("authorization","Bearer $token");if(body!=null){c.setRequestProperty("content-type","application/json");c.outputStream.use{it.write(body.toString().toByteArray())}};val code=c.responseCode;val text=(if(code>=400)c.errorStream else c.inputStream).bufferedReader().use{it.readText()};if(code !in 200..299)error("HTTP_$code:${JSONObject(text).optString("error")}");return JSONObject(text)}finally{c.disconnect()}}
 private fun sha(v:ByteArray)=MessageDigest.getInstance("SHA-256").digest(v).joinToString(""){"%02x".format(it)}
}
