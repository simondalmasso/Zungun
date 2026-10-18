from pathlib import Path
import json
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
import uuid

from playwright.sync_api import sync_playwright, expect

origin = os.environ.get("ZUNGUN_ORIGIN", "https://zungun.simondalmasso44.workers.dev").rstrip("/")
out = Path(os.environ.get("ORDER085_WEB_EVIDENCE", "evidence/order085/web"))
out.mkdir(parents=True, exist_ok=True)
pilot_token = os.environ.get("ZUNGUN_PILOT_TOKEN", "")
run_tag = uuid.uuid4().hex[:8]


def route_smoke():
    results = {}
    for route_path in ("/", "/messages", "/control", "/developers", "/ops"):
        request = urllib.request.Request(
            origin + route_path,
            headers={"User-Agent": "Zungun-ORDER085-E2E/1.0"},
        )
        parsed = urllib.parse.urlparse(origin)
        ssl_context = ssl._create_unverified_context() if parsed.hostname in ('127.0.0.1', 'localhost') else None
        with urllib.request.urlopen(request, timeout=20, context=ssl_context) as response:
            results[route_path] = response.status
            assert response.status == 200, {"path": route_path, "status": response.status}
    (out / "route-smoke.json").write_text(json.dumps(results, indent=2) + "\n")


def create_identity(page, name):
    page.goto(origin + "/messages", wait_until="networkidle")
    page.get_by_placeholder("Display name").fill(name)
    page.get_by_role("button", name="Create identity").click()
    expect(page.locator("#account .meta")).to_be_visible(timeout=15000)
    pairing_text = page.locator("#account .meta").inner_text()
    match = re.search(r"Pairing code\s+([A-Z2-9]{6,12})", pairing_text, re.IGNORECASE)
    assert match, f"PAIRING_CODE_NOT_RENDERED: {pairing_text!r}"
    return match.group(1).upper()


def assert_mobile_bounds(page):
    metrics = page.evaluate("""() => ({
      w: innerWidth,
      sw: document.documentElement.scrollWidth,
      composer: (document.querySelector('.composer')?.getBoundingClientRect() || {}),
      send: (document.querySelector('.send-button')?.getBoundingClientRect() || {}),
      back: (document.querySelector('.mobile-back')?.getBoundingClientRect() || {}),
      body: document.body.className
    })""")
    assert metrics["sw"] <= metrics["w"], metrics
    composer = metrics["composer"]
    assert composer and composer.get("left", -1) >= 0, metrics
    assert composer.get("right", 10**9) <= metrics["w"] + 1, metrics
    assert composer.get("bottom", 10**9) <= page.viewport_size["height"] + 1, metrics
    send = metrics["send"]
    assert send and send.get("width", 0) >= 40 and send.get("height", 0) >= 40, metrics
    if metrics["w"] <= 720:
        back = metrics["back"]
        assert back and back.get("width", 0) >= 40 and back.get("height", 0) >= 40, metrics
    return {key: metrics[key] for key in ("w", "sw", "body")}


def inject_one_durable_accept_fault(page, message_id):
    response = page.request.post(
        origin + "/api/v1/_order083/faults",
        headers={"x-zungun-order083-key": pilot_token},
        data={"subjectId": message_id, "faultType": "DROP_AFTER_DURABLE_ACCEPT"},
        timeout=15000,
    )
    assert response.ok, f"FAULT_SEED_FAILED:{response.status}:{response.text()}"


route_smoke()
assert pilot_token, "ZUNGUN_PILOT_TOKEN_REQUIRED_FOR_AMBIGUOUS_OUTCOME_REGRESSION"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
    sender_ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        color_scheme="dark",
        ignore_https_errors=True,
    )
    sender = sender_ctx.new_page()
    recipient_ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        color_scheme="light",
        ignore_https_errors=True,
    )
    recipient = recipient_ctx.new_page()
    sender_name = f"ORDER085 Sender {run_tag}"
    recipient_name = f"ORDER085 Recipient {run_tag}"
    sender_code = create_identity(sender, sender_name)
    recipient_code = create_identity(recipient, recipient_name)

    expect(recipient.get_by_role("heading", name="Conversations")).to_be_visible()
    recipient.screenshot(path=str(out / "messages-390-list-light.png"))

    sender.get_by_placeholder("Another person's pairing code").fill(recipient_code)
    sender.get_by_role("button", name="Start conversation").click()
    try:
        expect(sender.get_by_role("heading", name=recipient_name)).to_be_visible(timeout=15000)
    except AssertionError as exc:
        pair_error = sender.locator("#pair-error").inner_text().strip()
        sender_state = sender.locator("#conversations").inner_text().strip()
        raise AssertionError(
            f"PAIRING_UI_FAILED: error={pair_error!r}; conversations={sender_state!r}"
        ) from exc
    expect(sender.locator("#socket")).to_contain_text("Live", timeout=15000)

    recipient.reload(wait_until="networkidle")
    row = recipient.get_by_role("button", name=f"Open conversation with {sender_name}")
    expect(row).to_be_visible(timeout=15000)
    row.click()
    expect(recipient.locator("body")).to_have_class("messages-page conversation-open")
    expect(recipient.locator("#socket")).to_contain_text("Live", timeout=15000)
    expect(recipient).to_have_url(re.compile(r"/messages#conversation$"))
    assert recipient.evaluate("history.state?.zungunMessagesPane") == "thread", (
        "MOBILE_THREAD_MUST_CREATE_HISTORY_ENTRY"
    )

    # Browser Back must restore the inbox without trapping the user or reloading the app.
    recipient.go_back()
    expect(recipient.locator("body")).to_have_class("messages-page")
    expect(recipient.get_by_role("heading", name="Conversations")).to_be_visible()
    assert recipient.evaluate("location.hash") == "", "BROWSER_BACK_DID_NOT_RESTORE_INBOX"
    row = recipient.get_by_role("button", name=f"Open conversation with {sender_name}")
    row.click()
    expect(recipient.locator("body")).to_have_class("messages-page conversation-open")
    recipient.wait_for_timeout(350)
    assert_mobile_bounds(recipient)
    recipient.screenshot(path=str(out / "messages-390-thread-light.png"))

    viewport_matrix = [
        (360, 800, "dark", "reduce", "messages-360-thread-dark-reduced-motion.png"),
        (412, 915, "light", "no-preference", "messages-412-thread-light.png"),
        (768, 1024, "dark", "no-preference", "messages-768-thread-dark.png"),
    ]
    viewport_results = []
    for width, height, scheme, motion, screenshot in viewport_matrix:
        recipient.set_viewport_size({"width": width, "height": height})
        recipient.emulate_media(color_scheme=scheme, reduced_motion=motion)
        expect(recipient.locator(".composer")).to_be_visible()
        recipient.wait_for_timeout(350)
        viewport_results.append(assert_mobile_bounds(recipient))
        recipient.screenshot(path=str(out / screenshot))

    sender.screenshot(path=str(out / "messages-1440-thread-dark.png"))
    sender.emulate_media(color_scheme="light", reduced_motion="no-preference")
    sender.screenshot(path=str(out / "messages-1440-thread-light.png"))
    sender.set_viewport_size({"width": 1280, "height": 900})
    sender.emulate_media(color_scheme="dark", reduced_motion="no-preference")

    recipient.set_viewport_size({"width": 412, "height": 915})
    recipient.emulate_media(color_scheme="light", reduced_motion="no-preference")
    long_body = "Long-field proof — " + ("durable delivery wraps cleanly across narrow mobile widths · " * 12)
    sender.get_by_placeholder("Message").fill(long_body)
    sender.get_by_role("button", name="Send message").click()
    expect(recipient.get_by_text(long_body, exact=True)).to_be_visible(timeout=15000)
    expect(sender.get_by_text("Delivered to recipient", exact=False)).to_be_visible(timeout=15000)
    expect(recipient.get_by_text(long_body, exact=True)).to_have_count(1)
    assert_mobile_bounds(recipient)
    recipient.screenshot(path=str(out / "messages-412-long-delivered-light.png"))

    # Send while the recipient client is offline. Durable SENT is not relabelled as DELIVERED.
    recipient_ctx.set_offline(True)
    expect(recipient.locator("#socket")).to_contain_text("Offline", timeout=10000)
    offline_body = "ORDER085 recipient offline while sender durable-accepts " + run_tag
    sender.get_by_placeholder("Message").fill(offline_body)
    sender.get_by_role("button", name="Send message").click()
    expect(sender.get_by_text(offline_body, exact=True)).to_be_visible(timeout=15000)
    offline_bubble = sender.locator("[id^='msg-msg_']").filter(has_text=offline_body)
    expect(offline_bubble).to_contain_text("Sent to server", timeout=10000)
    recipient.screenshot(path=str(out / "messages-412-offline-light.png"))
    recipient_ctx.set_offline(False)
    expect(recipient.locator("#socket")).to_contain_text("Live", timeout=15000)
    expect(recipient.get_by_text(offline_body, exact=True)).to_be_visible(timeout=15000)
    expect(sender.get_by_text("Delivered to recipient", exact=False).last).to_be_visible(timeout=15000)
    expect(recipient.get_by_text(offline_body, exact=True)).to_have_count(1)

    # Force the real Worker to durably accept one message and lose its POST response.
    # Block the first reconciliation GET, observe UNKNOWN, then retry with the same ID.
    fixed_uuid = uuid.uuid4().hex
    message_id = "msg_" + fixed_uuid
    sender.evaluate(
        """(id) => {
          const native = crypto.randomUUID.bind(crypto);
          Object.defineProperty(crypto, 'randomUUID', {
            configurable: true,
            value: () => {
              if (window.__order085ForcedUuid) {
                const next = window.__order085ForcedUuid;
                window.__order085ForcedUuid = null;
                return next;
              }
              return native();
            }
          });
          window.__order085ForcedUuid = id;
        }""",
        fixed_uuid,
    )
    inject_one_durable_accept_fault(sender, message_id)
    blocked = {"remaining": 2, "calls": 0}
    reconcile_pattern = re.compile(
        rf".*/api/v1/conversations/[^/]+/messages/{re.escape(message_id)}$"
    )

    def drop_first_reconcile(route, request):
        if request.method == "GET" and blocked["remaining"] > 0:
            blocked["remaining"] -= 1
            blocked["calls"] += 1
            route.abort("failed")
        else:
            route.continue_()

    sender.route(reconcile_pattern, drop_first_reconcile)
    ambiguous_body = "ORDER085 ambiguous durable-acceptance recovery " + run_tag
    sender.get_by_placeholder("Message").fill(ambiguous_body)
    sender.get_by_role("button", name="Send message").click()
    expect(sender.get_by_text("Uncertain — checking", exact=False)).to_be_visible(timeout=15000)
    expect(sender.get_by_text(ambiguous_body, exact=True)).to_be_visible(timeout=15000)
    assert blocked["calls"] == 1, "EXPECTED_INITIAL_RECONCILIATION_TO_BE_INTERRUPTED"
    sender.reload(wait_until="networkidle")
    expect(sender.locator("body")).to_have_class("messages-page conversation-open")
    expect(sender.get_by_role("heading", name=recipient_name)).to_be_visible(timeout=15000)
    expect(sender.get_by_text("Uncertain — checking", exact=False)).to_be_visible(timeout=15000)
    expect(sender.get_by_role("button", name="Retry same message safely")).to_be_enabled(timeout=10000)
    assert blocked["calls"] == 2, "PENDING_MESSAGE_MUST_SURVIVE_REFRESH_AND_RECONCILE"
    sender.unroute(reconcile_pattern)
    retry = sender.get_by_role("button", name="Retry same message safely")
    expect(retry).to_be_enabled(timeout=10000)
    retry.click()
    expect(recipient.get_by_text(ambiguous_body, exact=True)).to_be_visible(timeout=15000)
    expect(sender.get_by_text("Delivered to recipient", exact=False).last).to_be_visible(timeout=15000)
    expect(sender.get_by_text(ambiguous_body, exact=True)).to_have_count(1)
    expect(recipient.get_by_text(ambiguous_body, exact=True)).to_have_count(1)
    diagnostic = sender.request.get(
        origin + "/api/v1/_order083/diagnostics/" + message_id,
        headers={"x-zungun-order083-key": pilot_token},
        timeout=15000,
    )
    assert diagnostic.ok, (
        f"AMBIGUOUS_DIAGNOSTICS_FAILED:{diagnostic.status}:{diagnostic.text()}"
    )
    diagnostic_body = diagnostic.json()
    assert diagnostic_body["messageCount"] == 1, diagnostic_body
    assert diagnostic_body["deliveryAckCount"] == 1, diagnostic_body
    recipient.set_viewport_size({"width": 360, "height": 800})
    recipient.emulate_media(color_scheme="dark", reduced_motion="reduce")
    recipient.screenshot(path=str(out / "messages-360-ambiguous-reconciled-dark.png"))

    # Refresh must restore the active conversation without duplicating durable messages.
    recipient.reload(wait_until="networkidle")
    expect(recipient.locator("body")).to_have_class("messages-page conversation-open")
    expect(recipient.get_by_role("heading", name=sender_name)).to_be_visible(timeout=15000)
    expect(recipient.get_by_text(ambiguous_body, exact=True)).to_be_visible(timeout=15000)
    expect(recipient.get_by_text(ambiguous_body, exact=True)).to_have_count(1)

    # Keyboard send and invalid-pairing feedback are also production-visible acceptance.
    recipient.set_viewport_size({"width": 360, "height": 800})
    recipient.emulate_media(color_scheme="dark", reduced_motion="reduce")
    keyboard_body = "Keyboard send " + run_tag
    recipient.get_by_placeholder("Message").fill(keyboard_body)
    recipient.get_by_placeholder("Message").press("Enter")
    expect(sender.get_by_text(keyboard_body, exact=True)).to_be_visible(timeout=15000)
    expect(recipient.get_by_text("Delivered to recipient", exact=False).last).to_be_visible(timeout=15000)
    recipient.get_by_role("button", name="Back to conversations").click()
    expect(recipient.locator("body")).to_have_class("messages-page")
    expect(recipient.get_by_role("heading", name="Conversations")).to_be_visible()
    recipient.get_by_placeholder("Search conversations").fill(sender_name)
    expect(
        recipient.get_by_role("button", name=f"Open conversation with {sender_name}")
    ).to_be_visible()

    recipient.get_by_placeholder("Another person's pairing code").fill("ZZZZZZZZ")
    recipient.get_by_role("button", name="Start conversation").click()
    expect(recipient.locator("#pair-error")).not_to_be_empty(timeout=10000)
    recipient.screenshot(path=str(out / "messages-360-pair-error-dark.png"))

    result = {
        "ok": True,
        "origin": origin,
        "routes200": ["/", "/messages", "/control", "/developers", "/ops"],
        "mobile390x844": "PASS",
        "mobile360x800": "PASS",
        "mobile412x915": "PASS",
        "tablet768x1024": "PASS",
        "desktop1440x900": "PASS",
        "browserBackReturnsToInbox": "PASS",
        "singlePaneBackNavigation": "PASS",
        "composerVisibleAndTouchSized": "PASS",
        "noHorizontalOverflow": "PASS",
        "longContentWrap": "PASS",
        "lightMode": "PASS",
        "darkMode": "PASS",
        "reducedMotion": "PASS",
        "offlineAcceptanceAndReconnectDelivery": "PASS",
        "ambiguousDurableAcceptReconciledWithStableMessageId": "PASS",
        "ambiguousLogicalMessageCount": 1,
        "ambiguousDeliveryAckCount": 1,
        "refreshPreservesServerHistory": "PASS",
        "keyboardSend": "PASS",
        "pairingError": "PASS",
        "ownerLogoGate": "BLOCKED_CANONICAL_BINARY_NOT_INTEGRATED",
        "screenshots": [
            "messages-390-list-light.png",
            "messages-390-thread-light.png",
            "messages-360-thread-dark-reduced-motion.png",
            "messages-412-thread-light.png",
            "messages-768-thread-dark.png",
            "messages-1440-thread-dark.png",
            "messages-1440-thread-light.png",
            "messages-412-long-delivered-light.png",
            "messages-412-offline-light.png",
            "messages-360-ambiguous-reconciled-dark.png",
            "messages-360-pair-error-dark.png",
        ],
        "viewportMetrics": viewport_results,
    }
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    browser.close()
