package com.zungun.consumer
import com.zungun.runtime.delivery.StableIdentity
object ConsumerProof { val operationId:String=StableIdentity.operationId("external","consumer",1,1) }
