package com.zungun.runtime

import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.framework.FrameworkSQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zungun.runtime.db.ZungunDatabase
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DatabaseMigrationTest {
    @Test
    fun migration1To3AddsOperationalDeliveryState() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val path = context.getDatabasePath("migration-order076.sqlite")
        path.delete()
        path.parentFile?.mkdirs()
        val raw = SQLiteDatabase.openOrCreateDatabase(path, null)
        raw.execSQL(
            """
            CREATE TABLE operations (
              operationId TEXT NOT NULL PRIMARY KEY,
              idempotencyKey TEXT NOT NULL,
              tenantId TEXT NOT NULL,
              deviceId TEXT NOT NULL,
              scopeType TEXT NOT NULL,
              scopeId TEXT NOT NULL,
              workOrderId TEXT NOT NULL,
              messageId TEXT NOT NULL,
              messageCommitment TEXT NOT NULL,
              payload BLOB NOT NULL,
              contentType TEXT NOT NULL,
              priority INTEGER NOT NULL,
              createdAtMs INTEGER NOT NULL,
              expiresAtMs INTEGER NOT NULL,
              retryBudget INTEGER NOT NULL,
              attempts INTEGER NOT NULL,
              cancellationAllowed INTEGER NOT NULL,
              semanticRevalidationRequired INTEGER NOT NULL,
              state TEXT NOT NULL,
              updatedAtMs INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        val database = FrameworkSQLiteDatabase(raw)
        ZungunDatabase.MIGRATION_1_2.migrate(database)
        ZungunDatabase.MIGRATION_2_3.migrate(database)
        val columns = raw.rawQuery("PRAGMA table_info(operations)", null).use { cursor ->
            buildList { while (cursor.moveToNext()) add(cursor.getString(1)) }
        }
        assertTrue(columns.containsAll(listOf("lastError", "replayNonce", "maxPayloadBytes")))
        val tables = raw.rawQuery("SELECT name FROM sqlite_master WHERE type='table'", null).use { cursor ->
            buildList { while (cursor.moveToNext()) add(cursor.getString(0)) }
        }
        assertTrue(tables.contains("transport_attempts"))
        raw.close()
        path.delete()
    }
}
