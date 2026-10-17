package com.zungun.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL

@RunWith(AndroidJUnit4::class)
class Order083MessengerRecoveryInstrumentedTest {
    private val context=ApplicationProvider.getApplicationContext<Context>()
    private val app=context as ZungunApplication
    private val marker=context.getSharedPreferences("order083-recovery-marker",Context.MODE_PRIVATE)

    @Test fun phase1SetupOnline()=runBlocking {
        app.sessions.clear();context.deleteDatabase("zungun-product-v1.db");marker.edit().clear().commit()
        app.api.createIdentity("ORDER083 Recovery Sender ${System.nanoTime()}");app.installRuntime()
        val peer=createRemote("ORDER083 Recovery Offline Peer")
        val conversationId=MessengerClient(context).createConversation(peer.getJSONObject("identity").getString("pairingCode"))
        marker.edit().putString("conversation_id",conversationId).commit();assertTrue(conversationId.startsWith("cv_"))
    }

    @Test fun phase2QueueWhileOffline()=runBlocking {
        assertNotNull(app.sessions.token());val conversationId=marker.getString("conversation_id",null)?:error("NO_CONVERSATION")
        val messageId=MessengerClient(context).send(conversationId,"ORDER083 queued across force stop")
        marker.edit().putString("message_id",messageId).commit();val row=MessageStore(context).get(messageId)!!;assertEquals("QUEUED",row.state)
        delay(1500);assertEquals("QUEUED",MessageStore(context).get(messageId)!!.state)
    }

    @Test fun phase3VerifyAfterReconnect()=runBlocking {
        app.installRuntime();val conversationId=marker.getString("conversation_id",null)?:error("NO_CONVERSATION");val messageId=marker.getString("message_id",null)?:error("NO_MESSAGE")
        val store=MessageStore(context);val end=System.currentTimeMillis()+90_000
        while(System.currentTimeMillis()<end){val state=store.get(messageId)?.state;if(state=="SENT"||state=="DELIVERED")break;delay(500)}
        val local=store.get(messageId)?:error("MISSING_LOCAL_MESSAGE");assertEquals("SENT",local.state)
        val remote=app.api.message(conversationId,messageId);assertEquals(200,remote.status);assertEquals("SENT",remote.json().getString("state"))
        val history=app.api.history(conversationId,0);var count=0;for(i in 0 until history.length())if(history.getJSONObject(i).getString("messageId")==messageId)count++;assertEquals(1,count)
    }

    private fun createRemote(name:String):JSONObject { val c=URL("https://zungun.simondalmasso44.workers.dev/api/v1/identity").openConnection() as HttpURLConnection;try{c.requestMethod="POST";c.doOutput=true;c.setRequestProperty("content-type","application/json");c.outputStream.use{it.write(JSONObject().put("displayName",name).put("client","android").toString().toByteArray())};val code=c.responseCode;val text=(if(code>=400)c.errorStream else c.inputStream).bufferedReader().use{it.readText()};if(code!=201)error("IDENTITY_HTTP_$code");return JSONObject(text)}finally{c.disconnect()} }
}
