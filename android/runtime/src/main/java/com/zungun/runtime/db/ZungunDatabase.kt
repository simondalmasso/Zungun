package com.zungun.runtime.db
import android.content.Context
import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities=[OperationEntity::class,EvidenceEntity::class,ReceiptEntity::class],version=2,exportSchema=true)
abstract class ZungunDatabase:RoomDatabase(){abstract fun operations():OperationDao
 companion object {
  val MIGRATION_1_2=object:Migration(1,2){override fun migrate(db:SupportSQLiteDatabase){db.execSQL("ALTER TABLE operations ADD COLUMN lastError TEXT");db.execSQL("CREATE INDEX IF NOT EXISTS index_operations_scopeId ON operations(scopeId)")}}
  fun open(context:Context,name:String="zungun-critical-operations.db")=Room.databaseBuilder(context,ZungunDatabase::class.java,name).addMigrations(MIGRATION_1_2).build()
 }
}
