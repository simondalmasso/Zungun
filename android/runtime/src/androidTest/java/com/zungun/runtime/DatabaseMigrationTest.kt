package com.zungun.runtime
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.framework.FrameworkSQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zungun.runtime.db.ZungunDatabase
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class)
class DatabaseMigrationTest {
 @Test fun migration1To2AddsDiagnosticColumnAndScopeIndex(){val context=InstrumentationRegistry.getInstrumentation().targetContext;val path=context.getDatabasePath("migration-order075.sqlite");path.delete();path.parentFile?.mkdirs();val raw=SQLiteDatabase.openOrCreateDatabase(path,null);raw.execSQL("CREATE TABLE operations (operationId TEXT NOT NULL PRIMARY KEY,idempotencyKey TEXT NOT NULL,tenantId TEXT NOT NULL,deviceId TEXT NOT NULL,scopeType TEXT NOT NULL,scopeId TEXT NOT NULL,workOrderId TEXT NOT NULL,messageId TEXT NOT NULL,messageCommitment TEXT NOT NULL,payload BLOB NOT NULL,contentType TEXT NOT NULL,priority INTEGER NOT NULL,createdAtMs INTEGER NOT NULL,expiresAtMs INTEGER NOT NULL,retryBudget INTEGER NOT NULL,attempts INTEGER NOT NULL,cancellationAllowed INTEGER NOT NULL,semanticRevalidationRequired INTEGER NOT NULL,state TEXT NOT NULL,updatedAtMs INTEGER NOT NULL)");val db=FrameworkSQLiteDatabase(raw);ZungunDatabase.MIGRATION_1_2.migrate(db);val columns=raw.rawQuery("PRAGMA table_info(operations)",null).use{cursor->buildList{while(cursor.moveToNext())add(cursor.getString(1))}};assertTrue(columns.contains("lastError"));val indexes=raw.rawQuery("PRAGMA index_list(operations)",null).use{cursor->buildList{while(cursor.moveToNext())add(cursor.getString(1))}};assertTrue(indexes.contains("index_operations_scopeId"));raw.close();path.delete()}
}
