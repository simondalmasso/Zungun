package com.zungun.runtime.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

@Entity(
    tableName = "link_operation_state",
    primaryKeys = ["operationId"],
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("profileHash"), Index("latestSnapshotId"), Index("latestPlanId")],
)
data class LinkOperationStateEntity(
    val operationId: String,
    val profileJson: String,
    val profileHash: String,
    val retryContract: String,
    val payloadStrategy: String,
    val orderingKey: String?,
    val latestSnapshotId: String?,
    val latestPlanId: String?,
    val activeProbeBytesUsed: Int,
    val automaticRetryBlocked: Boolean,
    val nextEligibilityAtMs: Long?,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "link_observations",
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("operationId"), Index("observedAtMs")],
)
data class LinkObservationEntity(
    @androidx.room.PrimaryKey val snapshotId: String,
    val operationId: String,
    val observedAtMs: Long,
    val maxAgeMs: Long,
    val snapshotJson: String,
    val snapshotSha256: String,
    val networkKey: String?,
)

@Entity(
    tableName = "transmission_plans",
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("operationId"), Index("createdAtMs"), Index("snapshotId")],
)
data class TransmissionPlanEntity(
    @androidx.room.PrimaryKey val planId: String,
    val operationId: String,
    val plannerVersion: String,
    val profileHash: String,
    val snapshotId: String,
    val snapshotHash: String,
    val decision: String,
    val reasonsJson: String,
    val adapterId: String?,
    val networkKey: String?,
    val plannedBytes: Int,
    val reconcileFirst: Boolean,
    val nextEligibilityAtMs: Long?,
    val activeProbeAuthorized: Boolean,
    val activeProbeBudgetRemainingBytes: Int,
    val createdAtMs: Long,
)

@Entity(
    tableName = "deferred_objects",
    primaryKeys = ["operationId", "objectId"],
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("operationId"), Index("sha256"), Index("state")],
)
data class DeferredObjectEntity(
    val operationId: String,
    val objectId: String,
    val contentType: String,
    val byteLength: Long,
    val sha256: String,
    val requirement: String,
    val chunkSizeBytes: Int,
    val chunkHashesJson: String,
    val state: String,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "operation_dependencies",
    primaryKeys = ["operationId", "dependsOnOperationId"],
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("operationId"), Index("dependsOnOperationId")],
)
data class OperationDependencyEntity(
    val operationId: String,
    val dependsOnOperationId: String,
)

@Entity(
    tableName = "link_transfer_checkpoints",
    primaryKeys = ["operationId", "objectId"],
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("operationId"), Index("updatedAtMs")],
)
data class LinkTransferCheckpointEntity(
    val operationId: String,
    val objectId: String,
    val objectSha256: String,
    val confirmedOffset: Long,
    val confirmedPrefixSha256: String,
    val remoteVersion: String?,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "link_prefetch_hints",
    primaryKeys = ["operationId", "resourceKey"],
    foreignKeys = [ForeignKey(entity = OperationEntity::class, parentColumns = ["operationId"], childColumns = ["operationId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("operationId"), Index("state"), Index("expiresAtMs")],
)
data class LinkPrefetchHintEntity(
    val operationId: String,
    val resourceKey: String,
    val revisionOrHash: String,
    val sizeEstimate: Long,
    val expiresAtMs: Long,
    val priority: Int,
    val sensitivityClass: String,
    val providerKey: String,
    val state: String,
    val updatedAtMs: Long,
)
