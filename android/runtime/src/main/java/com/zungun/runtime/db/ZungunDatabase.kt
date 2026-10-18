package com.zungun.runtime.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        OperationEntity::class,
        EvidenceEntity::class,
        ReceiptEntity::class,
        TransportAttemptEntity::class,
        WitnessEvidenceEntity::class,
        LinkOperationStateEntity::class,
        LinkObservationEntity::class,
        TransmissionPlanEntity::class,
        DeferredObjectEntity::class,
        OperationDependencyEntity::class,
        LinkTransferCheckpointEntity::class,
        LinkPrefetchHintEntity::class,
    ],
    version = 5,
    exportSchema = true,
)
abstract class ZungunDatabase : RoomDatabase() {
    abstract fun operations(): OperationDao
    abstract fun link(): LinkDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE operations ADD COLUMN lastError TEXT")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_operations_scopeId ON operations(scopeId)")
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE operations ADD COLUMN replayNonce TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE operations ADD COLUMN maxPayloadBytes INTEGER NOT NULL DEFAULT 16384")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS transport_attempts (
                      attemptId TEXT NOT NULL PRIMARY KEY,
                      operationId TEXT NOT NULL,
                      attemptNumber INTEGER NOT NULL,
                      startedAtMs INTEGER NOT NULL,
                      completedAtMs INTEGER,
                      status TEXT NOT NULL,
                      httpStatus INTEGER,
                      responseSha256 TEXT,
                      errorCode TEXT,
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent(),
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_transport_attempts_operationId ON transport_attempts(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_transport_attempts_startedAtMs ON transport_attempts(startedAtMs)")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS witness_evidence (
                      evidenceId TEXT NOT NULL PRIMARY KEY,
                      operationId TEXT NOT NULL,
                      chainPosition INTEGER NOT NULL,
                      state TEXT NOT NULL,
                      evidenceJson TEXT NOT NULL,
                      evidenceSha256 TEXT NOT NULL,
                      previousHash TEXT,
                      monotonicMs INTEGER NOT NULL,
                      createdAtMs INTEGER NOT NULL,
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent(),
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_witness_evidence_operationId ON witness_evidence(operationId)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_witness_evidence_operationId_chainPosition ON witness_evidence(operationId,chainPosition)")
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS link_operation_state (
                      operationId TEXT NOT NULL PRIMARY KEY,
                      profileJson TEXT NOT NULL,
                      profileHash TEXT NOT NULL,
                      retryContract TEXT NOT NULL,
                      payloadStrategy TEXT NOT NULL,
                      orderingKey TEXT,
                      latestSnapshotId TEXT,
                      latestPlanId TEXT,
                      activeProbeBytesUsed INTEGER NOT NULL,
                      automaticRetryBlocked INTEGER NOT NULL DEFAULT 0,
                      nextEligibilityAtMs INTEGER,
                      updatedAtMs INTEGER NOT NULL,
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_operation_state_profileHash ON link_operation_state(profileHash)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_operation_state_latestSnapshotId ON link_operation_state(latestSnapshotId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_operation_state_latestPlanId ON link_operation_state(latestPlanId)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS link_observations (
                      snapshotId TEXT NOT NULL PRIMARY KEY,
                      operationId TEXT NOT NULL,
                      observedAtMs INTEGER NOT NULL,
                      maxAgeMs INTEGER NOT NULL,
                      snapshotJson TEXT NOT NULL,
                      snapshotSha256 TEXT NOT NULL,
                      networkKey TEXT,
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_observations_operationId ON link_observations(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_observations_observedAtMs ON link_observations(observedAtMs)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS transmission_plans (
                      planId TEXT NOT NULL PRIMARY KEY,
                      operationId TEXT NOT NULL,
                      plannerVersion TEXT NOT NULL,
                      profileHash TEXT NOT NULL,
                      snapshotId TEXT NOT NULL,
                      snapshotHash TEXT NOT NULL,
                      decision TEXT NOT NULL,
                      reasonsJson TEXT NOT NULL,
                      adapterId TEXT,
                      networkKey TEXT,
                      plannedBytes INTEGER NOT NULL,
                      reconcileFirst INTEGER NOT NULL,
                      nextEligibilityAtMs INTEGER,
                      activeProbeAuthorized INTEGER NOT NULL,
                      activeProbeBudgetRemainingBytes INTEGER NOT NULL,
                      createdAtMs INTEGER NOT NULL,
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_transmission_plans_operationId ON transmission_plans(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_transmission_plans_createdAtMs ON transmission_plans(createdAtMs)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_transmission_plans_snapshotId ON transmission_plans(snapshotId)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS deferred_objects (
                      operationId TEXT NOT NULL,
                      objectId TEXT NOT NULL,
                      contentType TEXT NOT NULL,
                      byteLength INTEGER NOT NULL,
                      sha256 TEXT NOT NULL,
                      requirement TEXT NOT NULL,
                      chunkSizeBytes INTEGER NOT NULL,
                      chunkHashesJson TEXT NOT NULL,
                      state TEXT NOT NULL,
                      updatedAtMs INTEGER NOT NULL,
                      PRIMARY KEY(operationId,objectId),
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_deferred_objects_operationId ON deferred_objects(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_deferred_objects_sha256 ON deferred_objects(sha256)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_deferred_objects_state ON deferred_objects(state)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS operation_dependencies (
                      operationId TEXT NOT NULL,
                      dependsOnOperationId TEXT NOT NULL,
                      PRIMARY KEY(operationId,dependsOnOperationId),
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_operation_dependencies_operationId ON operation_dependencies(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_operation_dependencies_dependsOnOperationId ON operation_dependencies(dependsOnOperationId)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS link_transfer_checkpoints (
                      operationId TEXT NOT NULL,
                      objectId TEXT NOT NULL,
                      objectSha256 TEXT NOT NULL,
                      confirmedOffset INTEGER NOT NULL,
                      confirmedPrefixSha256 TEXT NOT NULL,
                      remoteVersion TEXT,
                      updatedAtMs INTEGER NOT NULL,
                      PRIMARY KEY(operationId,objectId),
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_transfer_checkpoints_operationId ON link_transfer_checkpoints(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_transfer_checkpoints_updatedAtMs ON link_transfer_checkpoints(updatedAtMs)")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS link_prefetch_hints (
                      operationId TEXT NOT NULL,
                      resourceKey TEXT NOT NULL,
                      revisionOrHash TEXT NOT NULL,
                      sizeEstimate INTEGER NOT NULL,
                      expiresAtMs INTEGER NOT NULL,
                      priority INTEGER NOT NULL,
                      sensitivityClass TEXT NOT NULL,
                      providerKey TEXT NOT NULL,
                      state TEXT NOT NULL,
                      updatedAtMs INTEGER NOT NULL,
                      PRIMARY KEY(operationId,resourceKey),
                      FOREIGN KEY(operationId) REFERENCES operations(operationId) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_prefetch_hints_operationId ON link_prefetch_hints(operationId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_prefetch_hints_state ON link_prefetch_hints(state)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_link_prefetch_hints_expiresAtMs ON link_prefetch_hints(expiresAtMs)")
            }
        }

        fun open(context: Context, name: String = "zungun-critical-operations.db") =
            Room.databaseBuilder(context, ZungunDatabase::class.java, name)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()
    }
}
