package com.zungun.runtime.db
import androidx.room.*

@Dao
interface OperationDao {
 @Insert(onConflict=OnConflictStrategy.ABORT) suspend fun insert(operation:OperationEntity)
 @Query("SELECT * FROM operations WHERE operationId=:id") suspend fun get(id:String):OperationEntity?
 @Query("SELECT * FROM operations WHERE state NOT IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED') ORDER BY priority DESC,createdAtMs ASC") suspend fun pending():List<OperationEntity>
 @Query("UPDATE operations SET state=:next,lastError=:error,updatedAtMs=:atMs,attempts=:attempts WHERE operationId=:id AND state=:expected") suspend fun transition(id:String,expected:String,next:String,error:String?,atMs:Long,attempts:Int):Int
 @Query("UPDATE operations SET state='CANCELLED',updatedAtMs=:atMs WHERE operationId=:id AND cancellationAllowed=1 AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED')") suspend fun cancel(id:String,atMs:Long):Int
 @Insert suspend fun evidence(value:EvidenceEntity)
 @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun receipt(value:ReceiptEntity)
 @Query("SELECT * FROM evidence WHERE operationId=:id ORDER BY occurredAtMs,id") suspend fun evidenceFor(id:String):List<EvidenceEntity>
}
