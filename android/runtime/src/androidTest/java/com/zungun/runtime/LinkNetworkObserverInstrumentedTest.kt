package com.zungun.runtime

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zungun.runtime.link.LinkNetworkObserver
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LinkNetworkObserverInstrumentedTest {
    @Test fun defaultNetworkCallbackProducesBoundedSnapshot() {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val latch=CountDownLatch(1); var captured:com.zungun.runtime.link.LinkSnapshot?=null
        LinkNetworkObserver(context,5_000){captured=it;latch.countDown()}.use { observer -> observer.start(); assertTrue("Link callback did not emit",latch.await(15,TimeUnit.SECONDS)) }
        val snapshot=assertNotNull(captured).let{captured!!};assertTrue(snapshot.maxAgeMs==5_000L);assertTrue(snapshot.snapshotId.isNotBlank())
    }
}
