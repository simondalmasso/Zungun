package com.zungun.app

import android.content.Context
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSessionStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("zungun-order083", Context.MODE_PRIVATE)
    val endpoint: String get() = "https://zungun.simondalmasso44.workers.dev"

    data class Identity(val userId:String,val displayName:String,val pairingCode:String)

    fun identity(): Identity? {
        val userId=prefs.getString("user_id",null)?:return null
        return Identity(userId,prefs.getString("display_name","")?:"",prefs.getString("pairing_code","")?:"")
    }
    fun saveIdentity(identity:Identity, token:String){
        prefs.edit().putString("user_id",identity.userId).putString("display_name",identity.displayName).putString("pairing_code",identity.pairingCode).putString("token_enc",encrypt(token)).apply()
    }
    fun token():String?=prefs.getString("token_enc",null)?.let{runCatching{decrypt(it)}.getOrNull()}
    fun clear(){prefs.edit().clear().apply()}
    fun nextSequence():Long{ synchronized(this){val next=prefs.getLong("sequence",0L)+1;prefs.edit().putLong("sequence",next).commit();return next} }
    fun deviceId():String=prefs.getString("device_id",null)?:run{val androidId=Settings.Secure.getString(context.contentResolver,Settings.Secure.ANDROID_ID);val value="device_${androidId?.takeIf{it.isNotBlank()}?:randomHex(12)}";prefs.edit().putString("device_id",value).apply();value}

    private fun key():SecretKey{
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(KEY_ALIAS,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").run{
            init(KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generateKey()
        }
    }
    private fun encrypt(value:String):String{val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());val blob=cipher.iv+cipher.doFinal(value.toByteArray());return Base64.encodeToString(blob,Base64.NO_WRAP)}
    private fun decrypt(value:String):String{val blob=Base64.decode(value,Base64.NO_WRAP);val iv=blob.copyOfRange(0,12);val data=blob.copyOfRange(12,blob.size);val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,iv));return String(cipher.doFinal(data))}
    private fun randomHex(n:Int)=ByteArray(n).also{SecureRandom().nextBytes(it)}.joinToString(""){"%02x".format(it)}
    companion object{private const val KEY_ALIAS="zungun-order083-session"}
}
