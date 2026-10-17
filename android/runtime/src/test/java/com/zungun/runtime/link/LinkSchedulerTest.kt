package com.zungun.runtime.link
import org.junit.Assert.assertEquals
import org.junit.Test
class LinkSchedulerTest {
 @Test fun criticalNeverYieldsToBulk(){val values=listOf(LinkSchedulableOperation("bulk",LinkUrgency.BULK,null,1,true,9_000_000),LinkSchedulableOperation("critical",LinkUrgency.CRITICAL,10,2,true,10));assertEquals("critical",LinkScheduler.next(values,100,true)?.operationId)}
 @Test fun oldBulkAdvancesAheadOfHighAfterFiniteGoodLinkBudget(){val values=listOf(LinkSchedulableOperation("bulk",LinkUrgency.BULK,null,1,true,9_000_000),LinkSchedulableOperation("high",LinkUrgency.HIGH,null,2,true,10));assertEquals("bulk",LinkScheduler.next(values,8,true)?.operationId)}
 @Test fun dependenciesBlockEligibility(){val values=listOf(LinkSchedulableOperation("blocked",LinkUrgency.CRITICAL,1,1,false,0),LinkSchedulableOperation("ready",LinkUrgency.NORMAL,null,2,true,0));assertEquals("ready",LinkScheduler.next(values,0,true)?.operationId)}
}
