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
    ],
    version = 4,
    exportSchema = true,
)
abstract class ZungunDatabase : RoomDatabase() {
    abstract fun operations(): OperationDao

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

        fun open(context: Context, name: String = "zungun-critical-operations.db") =
            Room.databaseBuilder(context, ZungunDatabase::class.java, name)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .build()
    }
}
