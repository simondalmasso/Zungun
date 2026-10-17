package com.zungun.runtime

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zungun.runtime.link.DeferredObjectStore
import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LinkDeferredObjectInstrumentedTest {
 @Test fun contentAddressedObjectVerifiesAndResumesAtChunkBoundary(){
   val context=ApplicationProvider.getApplicationContext<android.content.Context>();val data=ByteArray(600_000){(it%251).toByte()};val store=DeferredObjectStore(context,2_000_000);val saved=store.put(ByteArrayInputStream(data),128*1024)
   assertEquals(data.size.toLong(),saved.byteLength);assertTrue(saved.chunkHashes.size>1);val offset=256L*1024;assertEquals(64,store.prefixSha256(saved.sha256,offset).length);val rest=store.open(saved.sha256,offset).use{it.readBytes()};assertEquals(data.size-offset.toInt(),rest.size)
 }
}
