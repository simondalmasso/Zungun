package com.zungun.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MessengerSendWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
    override suspend fun doWork():Result=withContext(Dispatchers.IO){val id=inputData.getString("messageId")?:return@withContext Result.failure();val sessions=SecureSessionStore(applicationContext);if(sessions.token()==null)return@withContext Result.failure(workDataOf("error" to "NO_SESSION"));val store=MessageStore(applicationContext);val m=store.get(id)?:return@withContext Result.failure();val api=ApiClient(sessions)
        try{
            if(m.state=="UNKNOWN"){
                val reconciliation=api.message(m.conversationId,m.messageId)
                if(reconciliation.status==200){val j=reconciliation.json();val msg=j.getJSONObject("message");store.setState(id,j.getString("state"),sequence=msg.getLong("sequence"),deliveredAtMs=if(msg.isNull("deliveredAtMs"))null else msg.getLong("deliveredAtMs"));return@withContext Result.success()}
                if(reconciliation.status!=404)return@withContext Result.retry()
            }
            if(m.state in setOf("SENT","DELIVERED"))return@withContext Result.success()
            val r=api.sendMessage(m.conversationId,m.messageId,m.body,m.clientCreatedAtMs)
            when{
                r.status in 200..299->{val j=r.json();val msg=j.getJSONObject("message");store.setState(id,j.getString("state"),sequence=msg.getLong("sequence"),deliveredAtMs=if(msg.isNull("deliveredAtMs"))null else msg.getLong("deliveredAtMs"));Result.success()}
                r.status==409->{store.setState(id,"CONFLICT","MESSAGE_ID_CONFLICT");Result.failure(workDataOf("error" to "MESSAGE_ID_CONFLICT"))}
                r.status in 400..499->{store.setState(id,"CONFLICT",runCatching{r.json().optString("error")}.getOrNull());Result.failure()}
                else->{store.setState(id,"UNKNOWN","HTTP_${r.status}");Result.retry()}
            }
        }catch(e:java.io.IOException){store.setState(id,"UNKNOWN",e.javaClass.simpleName);Result.retry()}
    }
}
