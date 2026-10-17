package com.zungun.sample

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var status: TextView
    private var lastOperationId: String? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val endpoint = intent.getStringExtra("zungunEndpoint") ?: "http://10.0.2.2:8788"
        val token = intent.getStringExtra("zungunToken") ?: ""
        val receiverId = intent.getStringExtra("zungunReceiverId") ?: "receiver_local_1"
        if (token.isNotBlank()) (application as SampleApplication).saveAndInstall(endpoint, token, receiverId)

        status = TextView(this).apply { text = "No operation queued" }
        val queue = Button(this).apply {
            text = "Queue durable work-order completion"
            setOnClickListener { queueOperation() }
        }
        val refresh = Button(this).apply {
            text = "Refresh local durable state"
            setOnClickListener { refreshState() }
        }
        val cancel = Button(this).apply {
            text = "Cancel pending operation"
            setOnClickListener {
                val id = lastOperationId ?: return@setOnClickListener
                scope.launch {
                    val cancelled = CriticalOperationRuntime(this@MainActivity).cancel(id, System.currentTimeMillis())
                    status.text = "cancelled=$cancelled operationId=$id"
                }
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(queue)
            addView(refresh)
            addView(cancel)
            addView(status)
        })
        if (intent.getBooleanExtra("autoQueue", false)) queueOperation()
    }

    private fun queueOperation() {
        scope.launch {
            val now = System.currentTimeMillis()
            val operationId = CriticalOperationRuntime(this@MainActivity).enqueue(
                EnqueueRequest(
                    tenantId = "tenant_demo",
                    deviceId = "device_17",
                    localSequence = intent.getLongExtra("localSequence", now),
                    scopeType = "SHIFT",
                    scopeId = "shift_demo",
                    workOrderId = "WO-2841",
                    messageId = "msg_$now",
                    messageCommitment = "sha256:sample_$now",
                    payload = "{\"action\":\"COMPLETE\"}".toByteArray(),
                    contentType = "application/json",
                    policy = OperationPolicy(2, now, now + 3_600_000, 8, true, true, 16_384),
                ),
                now,
            )
            lastOperationId = operationId
            status.text = "Persisted and scheduled: $operationId"
        }
    }

    private fun refreshState() {
        val id = lastOperationId ?: return
        scope.launch {
            val detail = withContext(Dispatchers.IO) {
                val database = ZungunDatabase.open(this@MainActivity)
                try {
                    val operation = database.operations().get(id)
                    val attempts = database.operations().attemptsFor(id)
                    val receipt = database.operations().receiptFor(id)
                    Triple(operation, attempts.size, receipt)
                } finally {
                    database.close()
                }
            }
            status.text = "operationId=$id state=${detail.first?.state} attempts=${detail.second} receipt=${detail.third?.receiptId ?: "none"}"
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
