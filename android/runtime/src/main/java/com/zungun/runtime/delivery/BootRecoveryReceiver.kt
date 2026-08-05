package com.zungun.runtime.delivery
import android.content.*
import kotlinx.coroutines.*
class BootRecoveryReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){val pending=goAsync();CoroutineScope(SupervisorJob()+Dispatchers.IO).launch{try{CriticalOperationRuntime(context).recoverPending()}finally{pending.finish()}}}}
