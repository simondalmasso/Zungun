package com.zungun.runtime.delivery
import com.zungun.runtime.db.OperationEntity
fun interface SemanticRevalidator { suspend fun validate(operation:OperationEntity):Result<Unit> }
