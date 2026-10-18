package com.zungun.runtime.link

data class LinkDeferredObjectSpec(
    val objectId:String,
    val contentType:String,
    val byteLength:Long,
    val sha256:String,
    val requirement:String,
    val chunkSizeBytes:Int,
    val chunkHashes:List<String>,
)
