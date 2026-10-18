package com.zungun.app

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.link.*
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import kotlinx.coroutines.*
import org.json.JSONObject
import java.security.MessageDigest

class MainActivity : ComponentActivity() {
    private lateinit var app: ZungunApplication
    private lateinit var container: LinearLayout
    private var messagesJob: Job? = null
    private var selectedConversation: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as ZungunApplication
        renderShell()
    }

    override fun onDestroy() {
        messagesJob?.cancel()
        super.onDestroy()
    }

    private fun renderShell() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(20))
            setBackgroundColor(bgColor())
        }
        val title = TextView(this).apply {
            text = "Zungun"
            textSize = 28f
            setTextColor(textColor())
            setTypeface(typeface, 1)
        }
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        fun navButton(label: String, click: () -> Unit): Button = Button(this).apply {
            text = label
            minHeight = dp(48)
            minWidth = dp(72)
            setOnClickListener { click() }
        }
        nav.addView(navButton("Field") { renderField() })
        nav.addView(navButton("Messages") { renderMessages() })
        nav.addView(navButton("Account") { renderAccount() })
        root.addView(title)
        root.addView(nav)

        val scroll = ScrollView(this)
        container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(22), 0, dp(40))
        }
        scroll.addView(container)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        if (app.sessions.identity() == null) renderAccount() else renderField()
    }

    private fun header(kicker: String, title: String, subtitle: String) {
        container.removeAllViews()
        container.addView(TextView(this).apply {
            text = kicker.uppercase()
            textSize = 12f
            setTextColor(mutedColor())
        })
        container.addView(TextView(this).apply {
            text = title
            textSize = 36f
            setTextColor(textColor())
            setTypeface(typeface, 1)
            setPadding(0, dp(6), 0, dp(8))
        })
        container.addView(TextView(this).apply {
            text = subtitle
            textSize = 17f
            setTextColor(mutedColor())
            setPadding(0, 0, 0, dp(18))
        })
    }

    private fun renderAccount() {
        messagesJob?.cancel()
        header("Account", "Your identity", "The pairing code can find you. It cannot authenticate as you.")
        val identity = app.sessions.identity()
        if (identity == null) {
            val name = EditText(this).apply { hint = "Display name"; maxLines = 1; minHeight = dp(48) }
            val create = Button(this).apply { text = "Create identity"; minHeight = dp(48) }
            val error = TextView(this).apply { setTextColor(Color.RED) }
            container.addView(name); container.addView(create); container.addView(error)
            create.setOnClickListener {
                val value = name.text.toString().trim()
                if (value.isBlank()) return@setOnClickListener
                lifecycleScope.launch {
                    create.isEnabled = false
                    try {
                        withContext(Dispatchers.IO) { app.api.createIdentity(value) }
                        app.installRuntime()
                        renderAccount()
                    } catch (e: Exception) { error.text = e.message }
                    finally { create.isEnabled = true }
                }
            }
        } else {
            container.addView(card("${identity.displayName}\nPairing code ${identity.pairingCode}", "Session token is encrypted at rest with Android Keystore."))
            container.addView(Button(this).apply {
                text = "Sign out / reset"; minHeight = dp(48)
                setOnClickListener { lifecycleScope.launch { withContext(Dispatchers.IO) { app.api.revoke() }; renderAccount() } }
            })
        }
    }

    private fun renderField() {
        messagesJob?.cancel()
        header("Field", "Assigned work", "Actions are saved locally first, then sent through Zungun Link. Uncertain results reconcile before retry.")
        if (app.sessions.identity() == null) { container.addView(card("Create an identity first", "Open Account to start.")); return }
        val refresh = Button(this).apply { text = "Refresh assignments"; minHeight = dp(48) }
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        container.addView(refresh); container.addView(list)

        fun load() {
            lifecycleScope.launch {
                refresh.isEnabled = false
                try {
                    val items = withContext(Dispatchers.IO) { app.api.assignedWorkOrders() }
                    list.removeAllViews()
                    if (items.length() == 0) list.addView(card("No assignments", "Control can assign work using your pairing code."))
                    for (i in 0 until items.length()) list.addView(workCard(items.getJSONObject(i), ::load))
                } catch (e: Exception) {
                    list.removeAllViews(); list.addView(card("Could not refresh", e.message ?: "Network error"))
                } finally { refresh.isEnabled = true }
            }
        }
        refresh.setOnClickListener { load() }
        load()
    }

    private fun workCard(work: JSONObject, reload: () -> Unit): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            setBackgroundColor(surfaceColor())
        }
        box.addView(TextView(this).apply { text = work.getString("title"); textSize = 20f; setTypeface(typeface, 1); setTextColor(textColor()) })
        box.addView(TextView(this).apply { text = work.optString("description"); setTextColor(mutedColor()) })
        val statusText = "${stateLabel(work.getString("status"))} · revision ${work.getInt("revision")}\nExpires ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(work.getLong("expiresAtMs")))}"
        box.addView(TextView(this).apply { text = statusText; textSize = 13f; setTextColor(mutedColor()) })
        if (work.getString("status") == "OPEN" && work.getLong("expiresAtMs") > System.currentTimeMillis()) {
            val note = EditText(this).apply { hint = "Short note"; maxLines = 3; minHeight = dp(48) }
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            val complete = Button(this).apply { text = "Complete"; minHeight = dp(48) }
            val fail = Button(this).apply { text = "Could not complete"; minHeight = dp(48) }
            actions.addView(complete); actions.addView(fail); box.addView(note); box.addView(actions)
            complete.setOnClickListener { enqueueField(work, "COMPLETE", note.text.toString(), reload) }
            fail.setOnClickListener {
                if (note.text.toString().trim().isBlank()) Toast.makeText(this, "A reason is required", Toast.LENGTH_SHORT).show()
                else enqueueField(work, "COULD_NOT_COMPLETE", note.text.toString(), reload)
            }
        }
        box.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { setMargins(0, dp(7), 0, dp(7)) }
        return box
    }

    private fun enqueueField(work: JSONObject, action: String, note: String, reload: () -> Unit) {
        lifecycleScope.launch {
            try {
                val operationId = withContext(Dispatchers.IO) {
                    val now = System.currentTimeMillis()
                    val payload = JSONObject()
                        .put("kind", "ZUNGUN_FIELD_ACTION_V1")
                        .put("workOrderId", work.getString("workOrderId"))
                        .put("expectedRevision", work.getInt("revision"))
                        .put("action", action)
                        .put("note", note.trim())
                        .toString().toByteArray()
                    val request = EnqueueRequest(
                        tenantId = "zungun-v1",
                        deviceId = app.sessions.deviceId(),
                        localSequence = app.sessions.nextSequence(),
                        scopeType = "WORK_ORDER",
                        scopeId = work.getString("workOrderId"),
                        workOrderId = work.getString("workOrderId"),
                        messageId = "field:${work.getString("workOrderId")}:$action",
                        messageCommitment = sha256(payload),
                        payload = payload,
                        contentType = "application/vnd.zungun.field-action+json",
                        policy = OperationPolicy(8, now, work.getLong("expiresAtMs"), 8, false, true, 64_000),
                    )
                    val profile = DeliveryProfileV2(
                        urgency = LinkUrgency.HIGH,
                        deadlineAtMs = work.getLong("expiresAtMs") - 30_000,
                        expiresAtMs = work.getLong("expiresAtMs"),
                        maxDelayMs = 30_000,
                        retryContract = LinkRetryContract.RECONCILE_BEFORE_RETRY,
                        idempotencyRequired = true,
                        semanticRevalidationRequired = true,
                        orderingKey = work.getString("workOrderId"),
                        dependencies = emptyList(),
                        payloadStrategy = LinkPayloadStrategy.FULL_ONLY,
                        maxImmediateBytes = 64_000,
                        allowMetered = true,
                        allowRoaming = true,
                        allowCongested = true,
                        heavyDataPolicy = "NONE",
                        activeProbeBudgetBytes = 0,
                        transportAllowlist = listOf("http"),
                        receiptRequirement = "APPLICATION_ACK",
                        evidenceRequirement = "VERIFIED_RECEIPT",
                    )
                    CriticalOperationRuntime(this@MainActivity).enqueue(request, profile)
                }
                Toast.makeText(this@MainActivity, "Saved on device · ${operationId.take(16)}…", Toast.LENGTH_LONG).show()
                delay(1200); reload()
            } catch (e: Exception) { Toast.makeText(this@MainActivity, e.message ?: "Could not save", Toast.LENGTH_LONG).show() }
        }
    }

    private fun renderMessages() {
        messagesJob?.cancel()
        header("Messages", "One-to-one text", "Sent is durable server acceptance. Delivered requires a persisted recipient ACK. No read receipt or presence.")
        if (app.sessions.identity() == null) { container.addView(card("Create an identity first", "Open Account to start.")); return }
        val client = MessengerClient(this)
        val pair = EditText(this).apply { hint = "Pairing code"; maxLines = 1; minHeight = dp(48) }
        val start = Button(this).apply { text = "Start conversation"; minHeight = dp(48) }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; addView(pair, LinearLayout.LayoutParams(0, -2, 1f)); addView(start) }
        val conversations = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val thread = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val compose = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val input = EditText(this).apply { hint = "Message"; maxLines = 4; minHeight = dp(48) }
        val send = Button(this).apply { text = "Send"; minHeight = dp(48) }
        compose.addView(input, LinearLayout.LayoutParams(0, -2, 1f)); compose.addView(send)
        container.addView(top); container.addView(conversations); container.addView(thread); container.addView(compose)

        suspend fun drawConversations() {
            val list = client.refreshConversations(); conversations.removeAllViews()
            for (c in list) conversations.addView(Button(this@MainActivity).apply {
                text = c[1]; minHeight = dp(48)
                setOnClickListener { selectedConversation = c[0]; lifecycleScope.launch { drawThread(client, thread, c[0]) } }
            })
        }
        start.setOnClickListener {
            lifecycleScope.launch {
                try { selectedConversation = client.createConversation(pair.text.toString()); pair.text.clear(); drawConversations(); selectedConversation?.let { drawThread(client, thread, it) } }
                catch (e: Exception) { Toast.makeText(this@MainActivity, e.message, Toast.LENGTH_LONG).show() }
            }
        }
        send.setOnClickListener {
            val conversationId = selectedConversation
            if (conversationId == null) { Toast.makeText(this, "Choose a conversation", Toast.LENGTH_SHORT).show(); return@setOnClickListener }
            val body = input.text.toString().trim(); if (body.isBlank()) return@setOnClickListener
            lifecycleScope.launch {
                try { client.send(conversationId, body); input.text.clear(); drawThread(client, thread, conversationId) }
                catch (e: Exception) { Toast.makeText(this@MainActivity, e.message, Toast.LENGTH_LONG).show() }
            }
        }
        messagesJob = lifecycleScope.launch {
            drawConversations()
            while (isActive) { selectedConversation?.let { runCatching { drawThread(client, thread, it) } }; delay(5_000) }
        }
    }

    private suspend fun drawThread(client: MessengerClient, thread: LinearLayout, conversationId: String) {
        val items = runCatching { client.sync(conversationId) }.getOrElse { client.local(conversationId) }
        thread.removeAllViews(); val me = app.sessions.identity()?.userId
        for (message in items) {
            val view = TextView(this).apply {
                text = "${message.body}\n${stateLabel(message.state)}"
                textSize = 16f; setTextColor(textColor()); setPadding(dp(14), dp(10), dp(14), dp(10))
                setBackgroundColor(if (message.senderId == me) accentSurfaceColor() else surfaceColor())
            }
            thread.addView(view, LinearLayout.LayoutParams(-1, -2).apply {
                setMargins(if (message.senderId == me) dp(50) else 0, dp(5), if (message.senderId == me) 0 else dp(50), dp(5))
            })
        }
    }

    private fun card(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(16)); setBackgroundColor(surfaceColor())
        addView(TextView(this@MainActivity).apply { text = title; textSize = 19f; setTypeface(typeface, 1); setTextColor(textColor()) })
        addView(TextView(this@MainActivity).apply { text = subtitle; setTextColor(mutedColor()) })
    }

    private fun stateLabel(state: String) = when (state) {
        "QUEUED" -> "Saved on device"; "SENT" -> "Sent to server"; "UNKNOWN" -> "Uncertain — checking"
        "DELIVERED" -> "Delivered to recipient"; "COMPLETED" -> "Confirmed"; "REJECTED" -> "Could not complete"
        "OPEN" -> "Open"; "EXPIRED" -> "Expired"; "CONFLICT" -> "Conflict"; else -> state
    }
    private fun isDark() = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
    private fun bgColor() = if (isDark()) Color.rgb(16,17,18) else Color.rgb(246,246,244)
    private fun surfaceColor() = if (isDark()) Color.rgb(31,32,34) else Color.WHITE
    private fun textColor() = if (isDark()) Color.rgb(243,243,239) else Color.rgb(20,20,20)
    private fun mutedColor() = if (isDark()) Color.rgb(178,178,178) else Color.DKGRAY
    private fun accentSurfaceColor() = if (isDark()) Color.rgb(45,55,88) else Color.rgb(226,232,255)
    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
