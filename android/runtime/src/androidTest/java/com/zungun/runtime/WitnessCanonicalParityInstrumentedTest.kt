package com.zungun.runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zungun.runtime.delivery.WitnessChain
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WitnessCanonicalParityInstrumentedTest {
    @Test
    fun androidWitnessHashesMatchProtocolCoreGoldenVector() {
        val operationId = "op_witness_parity"
        val deviceId = "device_parity"
        val initial = WitnessChain.initial(operationId, deviceId, 1_000L)
        val custody = WitnessChain.custody(operationId, deviceId, 2_000L, initial.last())

        assertEquals(
            "sha256:03c5a235cb12770237ede93c203b8939b8bd9c5b4e1a3c6e240c94293d6e0240",
            initial[0].evidenceSha256,
        )
        assertEquals(
            "sha256:ea587b2dd075934a88cc9b73d0022fc68a568e1429b067f450bb2dc8976785f8",
            initial[1].evidenceSha256,
        )
        assertEquals(
            "sha256:09846efb11c42654bc953c4de844b84ad0bf4d1efccc881cb22c956af755b31b",
            custody.evidenceSha256,
        )
    }
}
