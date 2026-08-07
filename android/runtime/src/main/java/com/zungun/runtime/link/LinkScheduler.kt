package com.zungun.runtime.link

data class LinkSchedulableOperation(val operationId:String,val urgency:LinkUrgency,val deadlineAtMs:Long?,val enqueuedAtMs:Long,val dependenciesSatisfied:Boolean,val deferredBytes:Long)

object LinkScheduler {
    private val priority=mapOf(LinkUrgency.CRITICAL to 0,LinkUrgency.HIGH to 1,LinkUrgency.NORMAL to 2,LinkUrgency.BULK to 3)
    fun eligible(values:List<LinkSchedulableOperation>):List<LinkSchedulableOperation> = values.filter{it.dependenciesSatisfied}.sortedWith(compareBy<LinkSchedulableOperation>{priority.getValue(it.urgency)}.thenBy{it.deadlineAtMs?:Long.MAX_VALUE}.thenBy{it.enqueuedAtMs}.thenBy{it.operationId})
    fun next(values:List<LinkSchedulableOperation>,consecutiveNonBulkDispatches:Int,goodLink:Boolean,bulkPromotionThreshold:Int=8):LinkSchedulableOperation? {
        val ordered=eligible(values);if(ordered.isEmpty())return null
        ordered.firstOrNull{it.urgency==LinkUrgency.CRITICAL}?.let{return it}
        if(goodLink&&consecutiveNonBulkDispatches>=bulkPromotionThreshold){ordered.filter{it.urgency==LinkUrgency.BULK}.minWithOrNull(compareBy<LinkSchedulableOperation>{it.enqueuedAtMs}.thenBy{it.operationId})?.let{return it}}
        return ordered.first()
    }
}
