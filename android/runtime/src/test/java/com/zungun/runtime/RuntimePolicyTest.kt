package com.zungun.runtime
import com.zungun.runtime.delivery.*
import com.zungun.runtime.diagnostics.SafeDiagnostics
import com.zungun.runtime.model.ConnectivityClass
import org.junit.Assert.*
import org.junit.Test
class RuntimePolicyTest {
 @Test fun stableIdentityIsDeterministic(){assertEquals(StableIdentity.operationId("tenant","device",7,10),StableIdentity.operationId("tenant","device",7,10))}
 @Test fun constrainedPayloadIsBounded(){assertFalse(PayloadPolicy.decide(ConnectivityClass.CONSTRAINED,20_000,100_000).allowed)}
 @Test fun offlineDeliveryIsBlocked(){assertEquals(0,PayloadPolicy.decide(ConnectivityClass.OFFLINE,1,100).payloadLimitBytes)}
 @Test fun diagnosticsRejectSecrets(){assertThrows(IllegalArgumentException::class.java){SafeDiagnostics.event("X","op","Bearer abc")}}
}
