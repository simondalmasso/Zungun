package com.zungun.runtime.delivery
import java.security.MessageDigest
object StableIdentity { fun operationId(tenantId:String,deviceId:String,sequence:Long,createdAtMs:Long):String {require(tenantId.matches(Regex("[A-Za-z0-9._:-]{1,128}")));require(deviceId.matches(Regex("[A-Za-z0-9._:-]{1,128}")));require(sequence>=0);val canonical="{\"createdAtMs\":$createdAtMs,\"deviceId\":\"$deviceId\",\"localSequence\":$sequence,\"tenantId\":\"$tenantId\"}";return "op_"+MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray()).joinToString(""){"%02x".format(it)}.take(40)} }
