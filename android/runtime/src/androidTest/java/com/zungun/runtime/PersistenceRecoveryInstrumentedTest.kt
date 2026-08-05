package com.zungun.runtime
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.model.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class)
class PersistenceRecoveryInstrumentedTest {
 @Test fun offlineEnqueueSurvivesRuntimeRecreationAndRecovery()=runBlocking{val context=ApplicationProvider.getApplicationContext<android.content.Context>();WorkManagerTestInitHelper.initializeTestWorkManager(context,Configuration.Builder().setExecutor(SynchronousExecutor()).build());val name="process-recovery-order075.sqlite";context.deleteDatabase(name);var db=ZungunDatabase.open(context,name);var runtime=CriticalOperationRuntime(context,db);val now=System.currentTimeMillis();val id=runtime.enqueue(EnqueueRequest("tenant","device",1,"SHIFT","shift","WO-1","msg-1","sha256:message","{}".toByteArray(),"application/json",OperationPolicy(2,now,now+3600000,5,true,true,16384)),now);assertNotNull(db.operations().get(id));db.close();db=ZungunDatabase.open(context,name);runtime=CriticalOperationRuntime(context,db);assertEquals(id,db.operations().get(id)?.operationId);assertEquals(1,runtime.recoverPending());db.close();context.deleteDatabase(name)}
}
