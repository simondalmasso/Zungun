package com.zungun.sample
import android.app.Activity
import android.os.Bundle
import android.widget.*
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.model.*
import kotlinx.coroutines.*
class MainActivity:Activity(){private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main);override fun onCreate(state:Bundle?){super.onCreate(state);val status=TextView(this).apply{text="Offline operation not queued"};val button=Button(this).apply{text="Queue work-order completion offline"};button.setOnClickListener{scope.launch{val now=System.currentTimeMillis();val id=CriticalOperationRuntime(this@MainActivity).enqueue(EnqueueRequest("tenant_demo","device_17",1,"SHIFT","shift_demo","WO-2841","msg_2841","sha256:demo","{\"action\":\"COMPLETE\"}".toByteArray(),"application/json",OperationPolicy(2,now,now+3_600_000,5,true,true,16_384)));status.text="Persisted and scheduled: $id\nProcess death and reboot recovery are enabled."}};setContentView(LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(32,32,32,32);addView(button);addView(status)})}override fun onDestroy(){scope.cancel();super.onDestroy()}}
