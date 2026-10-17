package com.zungun.runtime.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkSnapshotContractTest {
    private fun profile() = DeliveryProfileV2(urgency=LinkUrgency.NORMAL,deadlineAtMs=null,expiresAtMs=100_000,maxDelayMs=5_000,retryContract=LinkRetryContract.RECONCILE_BEFORE_RETRY,idempotencyRequired=true,semanticRevalidationRequired=true,orderingKey=null,dependencies=emptyList(),payloadStrategy=LinkPayloadStrategy.FULL_ONLY,maxImmediateBytes=4096,allowMetered=false,allowRoaming=false,allowCongested=false,allowUnvalidated=false,heavyDataPolicy="DEFER_ON_CONSTRAINED",activeProbeBudgetBytes=0,transportAllowlist=listOf("http"),receiptRequirement="DURABLE_ACCEPTANCE",evidenceRequirement="FULL_WITNESS")
    private fun snapshot(validated:Boolean=true,captive:Boolean=false,metered:Boolean=false,roaming:Boolean=false,congested:Boolean=false,observedAt:Long=1_000,maxAge:Long=5_000)=LinkSnapshot("s",observedAt,maxAge,true,true,validated,captive,metered,false,congested,roaming,false,false,1000,500,listOf("CELLULAR"),"net",null,null,null)
    private fun plan(s:LinkSnapshot,now:Long=1_200)=LinkPlanner.create(LinkPlannerInput(nowMs=now,opId="op",profile=profile(),snapshot=s,payload=LinkPayloadShape(512,null,0,null,null,null,false),transports=listOf(LinkTransportCapability("http",true,null,true)),priorAmbiguousOutcome=false,automaticRetryAttempt=false,activeProbeBytesUsed=0,hasOutstandingDeferredObjects=false,prefetchEligible=false))
    @Test fun unvalidatedCaptiveMeteredRoamingAndStaleFailClosed(){assertTrue(plan(snapshot(validated=false)).reasonCodes.contains("NETWORK_NOT_VALIDATED"));assertTrue(plan(snapshot(captive=true)).reasonCodes.contains("CAPTIVE_PORTAL"));assertTrue(plan(snapshot(metered=true)).reasonCodes.contains("POLICY_METERED_FORBIDDEN"));assertTrue(plan(snapshot(roaming=true)).reasonCodes.contains("POLICY_ROAMING_FORBIDDEN"));assertTrue(plan(snapshot(observedAt=1_000,maxAge=100),1_200).reasonCodes.contains("STALE_LINK_SNAPSHOT"))}
    @Test fun validatedGoodLinkCanSend(){assertEquals(LinkDecision.SEND_FULL_NOW,plan(snapshot()).decision)}
}
