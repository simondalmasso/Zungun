package com.zungun.runtime

import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
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
        val databaseName = "migration-order076.sqlite"
        context.deleteDatabase(databaseName)

        val configuration = SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(databaseName)
            .callback(
                object : SupportSQLiteOpenHelper.Callback(1) {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        db.execSQL(
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
                    }

                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
                },
            )
            .build()
        val helper = FrameworkSQLiteOpenHelperFactory().create(configuration)

        try {
            val database = helper.writableDatabase
            ZungunDatabase.MIGRATION_1_2.migrate(database)
            ZungunDatabase.MIGRATION_2_3.migrate(database)
            val columns = database.query("PRAGMA table_info(operations)").use { cursor ->
                buildList { while (cursor.moveToNext()) add(cursor.getString(1)) }
            }
            assertTrue(columns.containsAll(listOf("lastError", "replayNonce", "maxPayloadBytes")))
            val tables = database.query("SELECT name FROM sqlite_master WHERE type='table'").use { cursor ->
                buildList { while (cursor.moveToNext()) add(cursor.getString(0)) }
            }
            assertTrue(tables.contains("transport_attempts"))
        } finally {
            helper.close()
            context.deleteDatabase(databaseName)
        }
    }
}
