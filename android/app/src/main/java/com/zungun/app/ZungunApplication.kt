package com.zungun.app

import android.app.Application
import android.content.Context
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.network.*
import org.json.JSONObject

class ZungunApplication:Application(){
    lateinit var sessions:SecureSessionStore; private set
    lateinit var api:ApiClient; private set
    override fun onCreate(){super.onCreate();sessions=SecureSessionStore(this);api=ApiClient(sessions);installRuntime()}
    fun installRuntime(){if(sessions.token()==null)return;DeliveryRuntimeRegistry.install(object:DeliveryDependencyProvider{
        override fun receiverConfiguration(context:Context)=ReceiverConfiguration(endpointUrl=sessions.endpoint,receiverId="zungun-cloudflare-order083",credentialProvider=CredentialProvider{sessions.token()?:error("NO_SESSION")})
        override fun semanticRevalidator(context:Context)=SemanticRevalidator{operation->runCatching{val p=JSONObject(String(operation.payload));require(p.getString("kind")=="ZUNGUN_FIELD_ACTION_V1");require(p.getInt("expectedRevision")>=1);require(operation.expiresAtMs>System.currentTimeMillis())}}
    })}
}
