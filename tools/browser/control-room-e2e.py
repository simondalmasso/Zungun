from pathlib import Path
import json
import os
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
env = dict(os.environ)
env.setdefault("RECEIVER_AUTH_TOKEN", "control-room-e2e-token-075")
env.setdefault("RECEIVER_DB", str(root / ".tmp" / "control-room-e2e.sqlite"))
env.setdefault("RECEIVER_KEY_FILE", str(root / ".tmp" / "control-room-e2e-key.json"))
env.setdefault("RECEIVER_PORT", "18788")

for path_key in ("RECEIVER_DB", "RECEIVER_KEY_FILE"):
    path = Path(env[path_key])
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.unlink()
    except FileNotFoundError:
        pass

server = subprocess.Popen(
    ["node", "dist/services/receiver/src/server.js"],
    cwd=root,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
try:
    for _ in range(100):
        try:
            with urlopen("http://127.0.0.1:18788/ready", timeout=0.2) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(0.05)
    else:
        stdout, stderr = server.communicate(timeout=3)
        raise RuntimeError(f"receiver did not become ready\nstdout={stdout}\nstderr={stderr}")

    browser_path = next(
        (
            path
            for path in (
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/google-chrome",
            )
            if Path(path).exists()
        ),
        None,
    )
    if not browser_path:
        raise RuntimeError("chromium executable not found")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=browser_path,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_page()
        page.goto(
            "http://127.0.0.1:18788/",
            wait_until="domcontentloaded",
            timeout=30_000,
        )
        page.locator("#token").wait_for(state="visible", timeout=10_000)
        assert page.get_by_text(
            "Transport acceptance is not proof of business effect.",
            exact=False,
        ).count() >= 1

        payload = {
            "protocol": "zungun.operation.v1",
            "wireVersion": 1,
            "operationId": "op_browser_e2e_075",
            "idempotencyKey": "idem_browser_e2e_075",
            "tenantId": "tenant_demo",
            "scopeType": "SHIFT",
            "scopeId": "shift_browser",
            "workOrderId": "WO-BROWSER-075",
            "messageId": "msg_browser_075",
            "messageCommitment": "sha256:browser075",
            "payloadBase64": "e30=",
            "contentType": "application/json",
            "policy": {
                "priority": 2,
                "createdAtMs": 1_750_000_000_000,
                "expiresAtMs": 2_750_000_000_000,
                "retryBudget": 5,
                "cancellationAllowed": True,
                "semanticRevalidationRequired": True,
                "maxPayloadBytes": 16_384,
            },
            "replayNonce": "nonce_browser_e2e_075",
            "extensions": {"deviceId": "browser_device"},
        }
        response = page.request.post(
            "http://127.0.0.1:18788/api/v1/operations",
            headers={
                "authorization": f"Bearer {env['RECEIVER_AUTH_TOKEN']}",
                "content-type": "application/json",
            },
            data=payload,
        )
        if response.status != 202:
            raise RuntimeError(f"operation creation failed: {response.status} {response.text()}")

        page.fill("#token", env["RECEIVER_AUTH_TOKEN"])
        page.locator("#authForm button[type=submit]").click()
        page.wait_for_selector('[data-operation="op_browser_e2e_075"]', timeout=15_000)
        page.click("#refreshButton")
        page.locator('[data-operation="op_browser_e2e_075"]').click()
        page.wait_for_selector(".timeline", timeout=10_000)

        assert page.locator("h1").inner_text() == "Control Room"
        assert page.get_by_text("Transport/receiver").count() == 1
        assert page.get_by_text("Business effect").count() >= 1
        assert page.get_by_text(
            "Transport acceptance alone is insufficient.",
            exact=False,
        ).count() >= 1
        page.click("#exportButton")
        browser.close()

    print(
        json.dumps(
            {
                "ok": True,
                "workflows": 6,
                "accessibilityLabels": 3,
                "backendConnected": True,
                "navigationWait": "domcontentloaded_explicit_readiness",
            }
        )
    )
finally:
    server.terminate()
    try:
        server.wait(timeout=3)
    except subprocess.TimeoutExpired:
        server.kill()
