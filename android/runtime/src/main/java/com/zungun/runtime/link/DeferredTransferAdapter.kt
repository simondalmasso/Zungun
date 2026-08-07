package com.zungun.runtime.link

import android.net.Network
import java.io.InputStream

data class DeferredTransferRequest(
    val operationId: String,
    val objectId: String,
    val objectSha256: String,
    val byteLength: Long,
    val contentType: String,
    val offset: Long,
    val network: Network?,
)

data class DeferredTransferResult(
    val confirmedOffset: Long,
    val remoteVersion: String?,
    val applicationReceipt: String?,
    val complete: Boolean,
)

fun interface DeferredTransferAdapter {
    suspend fun transfer(request: DeferredTransferRequest, openSource: (Long) -> InputStream): DeferredTransferResult
}
