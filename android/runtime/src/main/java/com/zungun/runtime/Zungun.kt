package com.zungun.runtime

import android.content.Context
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.link.*
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.network.DeliveryDependencyProvider
import com.zungun.runtime.network.DeliveryRuntimeRegistry

object Zungun {
    fun configure(context:Context,provider:DeliveryDependencyProvider){DeliveryRuntimeRegistry.install(provider);LinkNetworkWakeRegistry.ensure(context.applicationContext)}
    suspend fun enqueue(context:Context,request:EnqueueRequest):String{val db=ZungunDatabase.open(context);return try{CriticalOperationRuntime(context,db).enqueue(request)}finally{db.close()}}
    suspend fun enqueue(context:Context,request:EnqueueRequest,deliveryProfile:DeliveryProfileV2,deferredObjects:List<LinkDeferredObjectSpec> = emptyList(),prefetchHints:List<LinkPrefetchSpec> = emptyList(),deltaSpec:LinkDeltaSpec? = null):String{val db=ZungunDatabase.open(context);return try{CriticalOperationRuntime(context,db).enqueue(request,deliveryProfile,deferredObjects,prefetchHints,request.policy.createdAtMs,deltaSpec)}finally{db.close()}}
    suspend fun status(context:Context,operationId:String):LinkOperationStatus?{val db=ZungunDatabase.open(context);return try{LinkStatusReader.read(db,operationId)}finally{db.close()}}
}
