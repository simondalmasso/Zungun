package com.zungun.app

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class MessengerClient(private val context:Context){private val sessions=SecureSessionStore(context);private val api=ApiClient(sessions);private val store=MessageStore(context)
    suspend fun refreshConversations()=withContext(Dispatchers.IO){val remote=api.conversations();for(i in 0 until remote.length()){val c=remote.getJSONObject(i);val p=c.getJSONObject("peer");store.upsertConversation(c.getString("conversationId"),p.getString("displayName"),p.getString("pairingCode"),p.getString("userId"))};store.conversations()}
    suspend fun createConversation(code:String)=withContext(Dispatchers.IO){val c=api.createConversation(code);val p=c.getJSONObject("peer");store.upsertConversation(c.getString("conversationId"),p.getString("displayName"),p.getString("pairingCode"),p.getString("userId"));c.getString("conversationId")}
    suspend fun send(conversationId:String,body:String):String=withContext(Dispatchers.IO){require(body.length in 1..2000);val me=sessions.identity()?:error("NO_IDENTITY");val id="msg_${UUID.randomUUID()}";store.queue(id,conversationId,me.userId,body,System.currentTimeMillis());schedule(id);id}
    fun schedule(messageId:String){val req=OneTimeWorkRequestBuilder<MessengerSendWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setInputData(workDataOf("messageId" to messageId)).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS).build();WorkManager.getInstance(context).enqueueUniqueWork("zungun-message:$messageId",ExistingWorkPolicy.KEEP,req)}
    suspend fun sync(conversationId:String)=withContext(Dispatchers.IO){val me=sessions.identity()?:return@withContext emptyList<MessageStore.Message>();val items=api.history(conversationId,0);for(i in 0 until items.length()){val m=items.getJSONObject(i);val delivered=if(m.isNull("deliveredAtMs"))null else m.getLong("deliveredAtMs");store.ingest(conversationId,m.getString("messageId"),m.getString("senderId"),m.getString("body"),m.getLong("clientCreatedAtMs"),m.getLong("sequence"),delivered);if(m.getString("senderId")!=me.userId&&delivered==null){val ack=api.ack(conversationId,m.getString("messageId"));if(ack.status in 200..299){val a=ack.json().getJSONObject("message");store.setState(m.getString("messageId"),"DELIVERED",sequence=a.getLong("sequence"),deliveredAtMs=a.getLong("deliveredAtMs"))}}};store.messages(conversationId)}
    fun local(conversationId:String)=store.messages(conversationId)
}
