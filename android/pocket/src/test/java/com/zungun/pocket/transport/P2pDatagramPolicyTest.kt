package com.zungun.pocket.transport

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class P2pDatagramPolicyTest {
    @Test fun socketRequiresP2pNetworkAndFormedGroup() {
        assertFalse(P2pDatagramPolicy.canOpenSocket(false, true))
        assertFalse(P2pDatagramPolicy.canOpenSocket(true, false))
        assertFalse(P2pDatagramPolicy.canOpenSocket(false, false))
        assertTrue(P2pDatagramPolicy.canOpenSocket(true, true))
    }

    @Test fun datagramsFitConservativeMtuBudget() {
        assertFalse(P2pDatagramPolicy.acceptsDatagram(0))
        assertTrue(P2pDatagramPolicy.acceptsDatagram(1))
        assertTrue(P2pDatagramPolicy.acceptsDatagram(1232))
        assertFalse(P2pDatagramPolicy.acceptsDatagram(1233))
    }
}
