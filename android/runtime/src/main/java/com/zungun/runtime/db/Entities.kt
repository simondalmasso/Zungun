package com.zungun.runtime.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "operations",
    indices = [
        Index(value = ["idempotencyKey"], unique = true),
        Index("state"),
        Index("scopeId"),
    ],
)
data class OperationEntity(
    @PrimaryKey val operationId: String,
    val idempotencyKey: String,
    val tenantId: String,
    val deviceId: String,
    val scopeType: String,
    val scopeId: String,
    val workOrderId: String,
    val messageId: String,
    val messageCommitment: String,
    val replayNonce: String,
    val payload: ByteArray,
    val contentType: String,
    val priority: Int,
    val createdAtMs: Long,
    val expiresAtMs: Long,
    val retryBudget: Int,
    val maxPayloadBytes: Int,
    val attempts: Int,
    val cancellationAllowed: Boolean,
    val semanticRevalidationRequired: Boolean,
    val state: String,
    val lastError: String?,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "evidence",
    foreignKeys = [ForeignKey(
        entity = OperationEntity::class,
        parentColumns = ["operationId"],
        childColumns = ["operationId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("operationId")],
)
data class EvidenceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val operationId: String,
    val source: String,
    val kind: String,
    val occurredAtMs: Long,
    val reference: String,
    val payloadJson: String,
    val sha256: String,
)

@Entity(
    tableName = "receipts",
    foreignKeys = [ForeignKey(
        entity = OperationEntity::class,
        parentColumns = ["operationId"],
        childColumns = ["operationId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index(value = ["operationId"], unique = true)],
)
data class ReceiptEntity(
    @PrimaryKey val receiptId: String,
    val operationId: String,
    val keyId: String,
    val algorithm: String,
    val payloadJson: String,
    val signatureBase64: String,
    val payloadSha256: String,
    val verifiedAtMs: Long,
)

@Entity(
    tableName = "transport_attempts",
    foreignKeys = [ForeignKey(
        entity = OperationEntity::class,
        parentColumns = ["operationId"],
        childColumns = ["operationId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("operationId"), Index("startedAtMs")],
)
data class TransportAttemptEntity(
    @PrimaryKey val attemptId: String,
    val operationId: String,
    val attemptNumber: Int,
    val startedAtMs: Long,
    val completedAtMs: Long?,
    val status: String,
    val httpStatus: Int?,
    val responseSha256: String?,
    val errorCode: String?,
)
