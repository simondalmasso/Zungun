package com.zungun.runtime.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface LinkDao {
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun linkState(value: LinkOperationStateEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun observation(value: LinkObservationEntity)
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun plan(value: TransmissionPlanEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun deferred(value: DeferredObjectEntity)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun dependency(value: OperationDependencyEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun checkpoint(value: LinkTransferCheckpointEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun prefetchHint(value: LinkPrefetchHintEntity)

    @Query("SELECT * FROM link_operation_state WHERE operationId=:operationId") suspend fun state(operationId: String): LinkOperationStateEntity?
    @Query("SELECT * FROM link_observations WHERE operationId=:operationId ORDER BY observedAtMs DESC LIMIT 1") suspend fun latestObservation(operationId: String): LinkObservationEntity?
    @Query("SELECT * FROM transmission_plans WHERE operationId=:operationId ORDER BY createdAtMs DESC LIMIT 1") suspend fun latestPlan(operationId: String): TransmissionPlanEntity?
    @Query("SELECT * FROM deferred_objects WHERE operationId=:operationId ORDER BY requirement, objectId") suspend fun deferredFor(operationId: String): List<DeferredObjectEntity>
    @Query("SELECT * FROM link_transfer_checkpoints WHERE operationId=:operationId AND objectId=:objectId") suspend fun checkpointFor(operationId: String, objectId: String): LinkTransferCheckpointEntity?
    @Query("SELECT dependsOnOperationId FROM operation_dependencies WHERE operationId=:operationId ORDER BY dependsOnOperationId") suspend fun dependenciesFor(operationId: String): List<String>
    @Query("SELECT COUNT(*) FROM operation_dependencies d JOIN operations o ON o.operationId=d.dependsOnOperationId WHERE d.operationId=:operationId AND o.state != 'COMPLETED'") suspend fun unsatisfiedDependencyCount(operationId: String): Int
    @Query("UPDATE link_operation_state SET latestSnapshotId=:snapshotId, updatedAtMs=:nowMs WHERE operationId=:operationId") suspend fun setLatestSnapshot(operationId: String, snapshotId: String, nowMs: Long)
    @Query("UPDATE link_operation_state SET latestPlanId=:planId, updatedAtMs=:nowMs WHERE operationId=:operationId") suspend fun setLatestPlan(operationId: String, planId: String, nowMs: Long)

    @Query("UPDATE link_operation_state SET automaticRetryBlocked=:blocked,nextEligibilityAtMs=:nextEligibilityAtMs,updatedAtMs=:nowMs WHERE operationId=:operationId") suspend fun setRetryGate(operationId: String, blocked: Boolean, nextEligibilityAtMs: Long?, nowMs: Long)
    @Query("SELECT o.* FROM operations o LEFT JOIN link_operation_state l ON l.operationId=o.operationId WHERE o.state NOT IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED') AND COALESCE(l.automaticRetryBlocked,0)=0 ORDER BY o.priority DESC,o.createdAtMs ASC") suspend fun recoverableOperations(): List<OperationEntity>
    @Query("SELECT d.operationId FROM operation_dependencies d JOIN operations o ON o.operationId=d.operationId WHERE d.dependsOnOperationId=:operationId AND o.state NOT IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED') ORDER BY d.operationId") suspend fun dependentsOf(operationId: String): List<String>
    @Query("SELECT DISTINCT operationId FROM deferred_objects WHERE state NOT IN ('COMPLETED','REJECTED') ORDER BY operationId") suspend fun operationsWithPendingDeferred(): List<String>
    @Query("SELECT * FROM link_prefetch_hints WHERE operationId=:operationId AND state='PENDING' ORDER BY priority DESC,expiresAtMs,resourceKey") suspend fun pendingPrefetch(operationId: String): List<LinkPrefetchHintEntity>
    @Query("SELECT DISTINCT operationId FROM link_prefetch_hints WHERE state='PENDING' ORDER BY operationId") suspend fun operationsWithPendingPrefetch(): List<String>
    @Query("UPDATE link_prefetch_hints SET state=:state,updatedAtMs=:nowMs WHERE operationId=:operationId AND resourceKey=:resourceKey") suspend fun setPrefetchState(operationId:String,resourceKey:String,state:String,nowMs:Long)
    @Query("UPDATE deferred_objects SET state=:state, updatedAtMs=:nowMs WHERE operationId=:operationId AND objectId=:objectId") suspend fun setDeferredState(operationId: String, objectId: String, state: String, nowMs: Long)
    @Query("DELETE FROM link_observations WHERE operationId=:operationId AND snapshotId NOT IN (SELECT snapshotId FROM link_observations WHERE operationId=:operationId ORDER BY observedAtMs DESC LIMIT :keep)") suspend fun pruneObservations(operationId: String, keep: Int)
    @Query("DELETE FROM transmission_plans WHERE operationId=:operationId AND planId NOT IN (SELECT planId FROM transmission_plans WHERE operationId=:operationId ORDER BY createdAtMs DESC LIMIT :keep)") suspend fun prunePlans(operationId: String, keep: Int)
}
