package com.zungun.runtime.diagnostics
object SafeDiagnostics { private val sensitive=Regex("(?i)(authorization|bearer|password|private[_ -]?key|cookie|jwt)");fun event(code:String,operationId:String?,detail:String):Map<String,String?>{require(!sensitive.containsMatchIn(detail));return mapOf("code" to code,"operationId" to operationId,"detail" to detail)} }
