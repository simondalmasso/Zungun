package com.zungun.runtime

import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zungun.runtime.db.ZungunDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DatabaseMigrationTest {
    @Test fun migration1To3AddsOperationalDeliveryState() { withDatabase("migration-order076.sqlite",1,::createV1Operations){database->ZungunDatabase.MIGRATION_1_2.migrate(database);ZungunDatabase.MIGRATION_2_3.migrate(database);assertTrue(columns(database,"operations").containsAll(listOf("lastError","replayNonce","maxPayloadBytes")));assertTrue(tables(database).contains("transport_attempts"))} }
    @Test fun migration3To5AddsWitnessAndLinkWithoutDroppingExistingOperation() { withDatabase("migration-order081.sqlite",3,::createV3Operations){database->database.execSQL("INSERT INTO operations(operationId) VALUES('op-existing')");ZungunDatabase.MIGRATION_3_4.migrate(database);ZungunDatabase.MIGRATION_4_5.migrate(database);val expected=setOf("witness_evidence","link_operation_state","link_observations","transmission_plans","deferred_objects","operation_dependencies","link_transfer_checkpoints","link_prefetch_hints");assertTrue(tables(database).containsAll(expected));assertTrue(columns(database,"link_operation_state").containsAll(listOf("profileHash","automaticRetryBlocked","nextEligibilityAtMs")));assertEquals(1,database.query("SELECT COUNT(*) FROM operations WHERE operationId='op-existing'").use{it.moveToFirst();it.getInt(0)});assertEquals(0,database.query("PRAGMA foreign_key_check").use{it.count})} }
    private fun withDatabase(name:String,version:Int,create:(SupportSQLiteDatabase)->Unit,test:(SupportSQLiteDatabase)->Unit){val context=InstrumentationRegistry.getInstrumentation().targetContext;context.deleteDatabase(name);val configuration=SupportSQLiteOpenHelper.Configuration.builder(context).name(name).callback(object:SupportSQLiteOpenHelper.Callback(version){override fun onCreate(db:SupportSQLiteDatabase)=create(db);override fun onUpgrade(db:SupportSQLiteDatabase,oldVersion:Int,newVersion:Int)=Unit}).build();val helper=FrameworkSQLiteOpenHelperFactory().create(configuration);try{test(helper.writableDatabase)}finally{helper.close();context.deleteDatabase(name)}}
    private fun createV1Operations(db:SupportSQLiteDatabase){db.execSQL("""CREATE TABLE operations (operationId TEXT NOT NULL PRIMARY KEY,idempotencyKey TEXT NOT NULL,tenantId TEXT NOT NULL,deviceId TEXT NOT NULL,scopeType TEXT NOT NULL,scopeId TEXT NOT NULL,workOrderId TEXT NOT NULL,messageId TEXT NOT NULL,messageCommitment TEXT NOT NULL,payload BLOB NOT NULL,contentType TEXT NOT NULL,priority INTEGER NOT NULL,createdAtMs INTEGER NOT NULL,expiresAtMs INTEGER NOT NULL,retryBudget INTEGER NOT NULL,attempts INTEGER NOT NULL,cancellationAllowed INTEGER NOT NULL,semanticRevalidationRequired INTEGER NOT NULL,state TEXT NOT NULL,updatedAtMs INTEGER NOT NULL)""")}
    private fun createV3Operations(db:SupportSQLiteDatabase){db.execSQL("CREATE TABLE operations (operationId TEXT NOT NULL PRIMARY KEY)")}
    private fun tables(db:SupportSQLiteDatabase):Set<String> = db.query("SELECT name FROM sqlite_master WHERE type='table'").use{cursor->buildSet{while(cursor.moveToNext())add(cursor.getString(0))}}
    private fun columns(db:SupportSQLiteDatabase,table:String):Set<String> = db.query("PRAGMA table_info($table)").use{cursor->buildSet{while(cursor.moveToNext())add(cursor.getString(1))}}
}
