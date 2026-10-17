package com.zungun.runtime.receipt
import android.util.Base64
import org.json.JSONObject
import java.security.*
import java.security.spec.X509EncodedKeySpec

data class VerificationKey(val keyId:String,val publicKeyDerBase64:String,val validFromMs:Long,val validUntilMs:Long,val revokedAtMs:Long?)
object ReceiptVerifier {
 fun verify(payloadJson:String,payloadSha256:String,signatureBase64:String,keyId:String,algorithm:String,key:VerificationKey,nowMs:Long):Boolean {if(algorithm!="ECDSA_P256_SHA256"||key.keyId!=keyId||nowMs<key.validFromMs||nowMs>key.validUntilMs||(key.revokedAtMs!=null&&nowMs>=key.revokedAtMs))return false;val digest=MessageDigest.getInstance("SHA-256").digest(payloadJson.toByteArray()).joinToString(""){"%02x".format(it)};if(digest!=payloadSha256)return false;val pub=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(key.publicKeyDerBase64,Base64.NO_WRAP)));val verifier=Signature.getInstance("SHA256withECDSA");verifier.initVerify(pub);verifier.update(payloadJson.toByteArray());return verifier.verify(Base64.decode(signatureBase64,Base64.NO_WRAP)) }
 fun requireBusinessOutcome(payloadJson:String):String {val value=JSONObject(payloadJson).getString("applicationOutcome");require(value in setOf("EFFECT_APPLIED","NO_EFFECT","REJECTED"));return value}
}
