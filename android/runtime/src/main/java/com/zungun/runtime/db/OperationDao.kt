package com.zungun.runtime.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface OperationDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(operation: OperationEntity): Long

    @Query("SELECT * FROM operations WHERE operationId=:id")
    suspend fun get(id: String): OperationEntity?

    @Query("SELECT * FROM operations WHERE state NOT IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED') ORDER BY priority DESC,createdAtMs ASC")
    suspend fun pending(): List<OperationEntity>

    @Query("UPDATE operations SET state=:next,lastError=:error,updatedAtMs=:atMs,attempts=:attempts WHERE operationId=:id AND state=:expected")
    suspend fun transition(
        id: String,
        expected: String,
        next: String,
        error: String?,
        atMs: Long,
        attempts: Int,
    ): Int

    @Query("UPDATE operations SET state=:next,lastError=:error,updatedAtMs=:atMs,attempts=:attempts WHERE operationId=:id")
    suspend fun forceState(
        id: String,
        next: String,
        error: String?,
        atMs: Long,
        attempts: Int,
    ): Int

    @Query("UPDATE operations SET state='CANCELLED',updatedAtMs=:atMs WHERE operationId=:id AND cancellationAllowed=1 AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED')")
    suspend fun cancel(id: String, atMs: Long): Int

    @Insert
    suspend fun evidence(value: EvidenceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun receipt(value: ReceiptEntity)

    @Query("SELECT * FROM receipts WHERE operationId=:id")
    suspend fun receiptFor(id: String): ReceiptEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun transportAttempt(value: TransportAttemptEntity)

    @Query("UPDATE transport_attempts SET completedAtMs=:completedAtMs,status=:status,httpStatus=:httpStatus,responseSha256=:responseSha256,errorCode=:errorCode WHERE attemptId=:attemptId")
    suspend fun completeTransportAttempt(
        attemptId: String,
        completedAtMs: Long,
        status: String,
        httpStatus: Int?,
        responseSha256: String?,
        errorCode: String?,
    ): Int

    @Query("SELECT * FROM transport_attempts WHERE operationId=:id ORDER BY startedAtMs,attemptNumber")
    suspend fun attemptsFor(id: String): List<TransportAttemptEntity>

    @Query("SELECT * FROM evidence WHERE operationId=:id ORDER BY occurredAtMs,id")
    suspend fun evidenceFor(id: String): List<EvidenceEntity>
}
