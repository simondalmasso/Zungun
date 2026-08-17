package com.zungun.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiClient(private val sessions:SecureSessionStore){
    data class Response(val status:Int,val body:String){fun json()=JSONObject(body.ifBlank{"{}"})}
    fun request(path:String,method:String="GET",body:JSONObject?=null,authenticated:Boolean=true,extraHeaders:Map<String,String> = emptyMap()):Response{
        val c=URL(sessions.endpoint+path).openConnection() as HttpURLConnection
        try{c.requestMethod=method;c.connectTimeout=10_000;c.readTimeout=20_000;c.instanceFollowRedirects=false;c.setRequestProperty("accept","application/json");if(authenticated){val token=sessions.token()?:throw IOException("NO_SESSION");c.setRequestProperty("authorization","Bearer $token")};extraHeaders.forEach{(k,v)->c.setRequestProperty(k,v)};if(body!=null){c.doOutput=true;c.setRequestProperty("content-type","application/json");c.outputStream.use{it.write(body.toString().toByteArray())}};val status=c.responseCode;val stream=if(status>=400)c.errorStream else c.inputStream;return Response(status,stream?.bufferedReader()?.use{it.readText()}?:"") }finally{c.disconnect()}
    }
    fun requireOk(r:Response):JSONObject{if(r.status !in 200..299){val code=runCatching{r.json().optString("error","HTTP_${r.status}")}.getOrDefault("HTTP_${r.status}");throw IOException(code)};return r.json()}
    fun createIdentity(name:String):SecureSessionStore.Identity{val j=requireOk(request("/api/v1/identity","POST",JSONObject().put("displayName",name).put("client","android"),false));val i=j.getJSONObject("identity");val identity=SecureSessionStore.Identity(i.getString("userId"),i.getString("displayName"),i.getString("pairingCode"));sessions.saveIdentity(identity,j.getString("sessionToken"));return identity}
    fun revoke(){runCatching{request("/api/v1/session/revoke","POST",JSONObject())};sessions.clear()}
    fun assignedWorkOrders():JSONArray=requireOk(request("/api/v1/work-orders")).getJSONArray("items")
    fun workOrder(id:String):JSONObject=requireOk(request("/api/v1/work-orders/$id")).getJSONObject("workOrder")
    fun conversations():JSONArray=requireOk(request("/api/v1/conversations")).getJSONArray("items")
    fun createConversation(code:String):JSONObject=requireOk(request("/api/v1/conversations","POST",JSONObject().put("pairingCode",code.uppercase()))).getJSONObject("conversation")
    fun history(id:String,after:Long=0):JSONArray=requireOk(request("/api/v1/conversations/$id/messages?after=$after")).getJSONArray("items")
    fun message(id:String,messageId:String):Response=request("/api/v1/conversations/$id/messages/${java.net.URLEncoder.encode(messageId,"UTF-8")}")
    fun sendMessage(id:String,messageId:String,body:String,createdAtMs:Long):Response=request("/api/v1/conversations/$id/messages","POST",JSONObject().put("messageId",messageId).put("body",body).put("clientCreatedAtMs",createdAtMs))
    fun ack(id:String,messageId:String):Response=request("/api/v1/conversations/$id/messages/${java.net.URLEncoder.encode(messageId,"UTF-8")}/ack","POST",JSONObject())
}
