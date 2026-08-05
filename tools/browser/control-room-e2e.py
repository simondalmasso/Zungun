from pathlib import Path
import json
import os
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
env = dict(os.environ)
TOKENS = {
    'ingest': env.get('ZUNGUN_INGEST_TOKEN', 'browser-ingest-token-order076'),
    'reader': env.get('ZUNGUN_READER_TOKEN', 'browser-reader-token-order076'),
    'worker': env.get('ZUNGUN_WORKER_TOKEN', 'browser-worker-token-order076'),
    'reviewer': env.get('ZUNGUN_REVIEWER_TOKEN', 'browser-reviewer-token-order076'),
    'admin': env.get('ZUNGUN_ADMIN_TOKEN', 'browser-admin-token-order076'),
}
principals = [
    {'subject': role, 'token': token, 'roles': [role]}
    for role, token in TOKENS.items()
]
env['ZUNGUN_PRINCIPALS_JSON'] = json.dumps(principals, separators=(',', ':'))
env.setdefault('RECEIVER_DB', str(root / '.tmp' / 'control-room-e2e.sqlite'))
env.setdefault('RECEIVER_KEY_FILE', str(root / '.tmp' / 'control-room-e2e-key.json'))
env.setdefault('RECEIVER_PORT', '18788')
env.setdefault('RECEIVER_HOST', '127.0.0.1')
env.setdefault('ZUNGUN_RECEIVER_ID', 'receiver_local_1')
Path(env['RECEIVER_DB']).parent.mkdir(parents=True, exist_ok=True)
for candidate in [env['RECEIVER_DB'], env['RECEIVER_KEY_FILE']]:
    try:
        Path(candidate).unlink()
    except FileNotFoundError:
        pass
server = subprocess.Popen(
    ['node', 'dist/services/receiver/src/server.js'],
    cwd=root,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
try:
    for _ in range(120):
        try:
            with urlopen('http://127.0.0.1:18788/ready', timeout=0.2) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(0.05)
    else:
        stdout, stderr = server.communicate(timeout=1)
        raise RuntimeError(f'receiver did not become ready\n{stdout}\n{stderr}')

    browser_path = next((path for path in [
        '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    ] if Path(path).exists()), None)
    if not browser_path:
        raise RuntimeError('chromium executable not found')

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=browser_path,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        page = browser.new_page()
        page.goto('http://127.0.0.1:18788/', wait_until='domcontentloaded')
        page.wait_for_selector('#authForm')

        def api(method, path, token, data=None):
            response = page.request.fetch(
                f'http://127.0.0.1:18788{path}',
                method=method,
                headers={
                    'authorization': f'Bearer {token}',
                    'content-type': 'application/json',
                },
                data=data,
            )
            if response.status >= 400:
                raise RuntimeError(f'{method} {path} failed: {response.status} {response.text()}')
            return response

        now_ms = int(time.time() * 1000)
        primary_operation = 'op_browser_e2e_076'
        api('POST', '/api/v1/scopes/declarations', TOKENS['admin'], {
            'scopeType': 'SHIFT',
            'scopeId': 'shift_browser_076',
            'declarationVersion': 1,
            'expectedReportingDeviceIds': ['browser_device'],
            'expectedOperationIds': [primary_operation],
            'expectedOperationCount': 1,
            'declaredAtMs': now_ms - 1000,
            'provenance': 'browser-e2e-dispatch-manifest',
            'previousManifestHash': None,
        })

        def payload(index):
            operation_id = primary_operation if index == 0 else f'op_browser_page_{index:02d}'
            scope_id = 'shift_browser_076' if index == 0 else 'shift_browser_pages'
            return {
                'protocol': 'zungun.operation.v1',
                'wireVersion': 1,
                'operationId': operation_id,
                'idempotencyKey': f'idem_{operation_id}',
                'tenantId': 'tenant_demo',
                'scopeType': 'SHIFT',
                'scopeId': scope_id,
                'workOrderId': f'WO-BROWSER-{index:02d}',
                'messageId': f'msg_browser_{index:02d}',
                'messageCommitment': f'sha256:browser{index:02d}',
                'payloadBase64': 'e30=',
                'contentType': 'application/json',
                'policy': {
                    'priority': 2,
                    'createdAtMs': now_ms - 1000 + index,
                    'expiresAtMs': now_ms + 3600000,
                    'retryBudget': 5,
                    'cancellationAllowed': True,
                    'semanticRevalidationRequired': True,
                    'maxPayloadBytes': 16384,
                },
                'replayNonce': f'nonce_browser_e2e_{index:02d}',
                'extensions': {'deviceId': 'browser_device', 'clientVersion': 'browser-order076'},
            }

        for index in range(26):
            api('POST', '/api/v1/operations', TOKENS['ingest'], payload(index))

        claim = api('POST', f'/api/v1/operations/{primary_operation}/claim', TOKENS['worker'], {
            'ownerId': 'browser-worker',
            'nowMs': now_ms,
            'leaseMs': 30000,
        }).json()
        api('POST', f'/api/v1/operations/{primary_operation}/effect', TOKENS['worker'], {
            'attemptId': claim['attemptId'],
            'fencingToken': claim['fencingToken'],
            'effect': {
                'outcome': 'EFFECT_APPLIED',
                'applicationAcknowledged': True,
                'applicationReference': 'erp:browser:076',
                'workOrderStatus': 'CLOSED',
                'result': {'ok': True},
                'occurredAtMs': now_ms + 1,
            },
        })

        page.fill('#token', TOKENS['reader'])
        page.locator('#authForm button[type=submit]').click()
        page.wait_for_function("document.querySelector('#observedCount').textContent === '26'")
        assert page.locator('#nextPage').is_enabled()
        # The target is intentionally older than the first 25-row page. Locate the exact
        # operation through the backend-backed query instead of assuming first-page visibility.
        page.fill('#query', primary_operation)
        page.wait_for_selector(f'[data-operation="{primary_operation}"]', timeout=15_000)
        assert page.locator('[data-operation]').count() == 1
        page.locator(f'[data-operation="{primary_operation}"]').click()
        page.wait_for_selector('.timeline', timeout=10_000)
        assert page.locator('h1').inner_text() == 'Control Room'
        assert page.get_by_text('Transport/receiver').count() == 1
        assert page.get_by_text('Business effect').count() >= 1
        assert page.get_by_text('SIGNED_RECEIPT').count() >= 1

        page.fill('#scopeId', 'shift_browser_076')
        page.locator('#scopeForm button[type=submit]').click()
        page.wait_for_function("document.querySelector('#completeState').textContent === 'YES'")
        assert '"completeWithinDeclaredScope": true' in page.locator('#scopeResult').inner_text()

        page.fill('#token', TOKENS['reviewer'])
        page.locator('#authForm button[type=submit]').click()
        page.fill('#query', primary_operation)
        page.wait_for_selector(f'[data-operation="{primary_operation}"]')
        page.locator(f'[data-operation="{primary_operation}"]').click()
        page.wait_for_selector('#reviewForm:not([hidden])')
        page.fill('#reviewNote', 'Evidence reviewed without generating application facts.')
        page.locator('#reviewForm button[type=submit]').click()
        page.wait_for_function("document.querySelector('#detailContent').innerText.includes('EFFECT_CONFIRMED')")
        page.fill('#resolutionRationale', 'Evidence-bound acknowledgement of the deterministic verdict.')
        page.locator('#resolutionForm button[type=submit]').click()
        page.wait_for_function("document.querySelector('#detailContent').innerText.includes('new_proof_hash')")

        page.fill('#token', TOKENS['admin'])
        page.locator('#authForm button[type=submit]').click()
        page.locator('[data-view="keys"]').click()
        page.wait_for_selector('[data-revoke]')
        initial_key_count = page.locator('[data-revoke]').count()
        page.locator('#rotateKey').click()
        page.wait_for_function(
            f"document.querySelectorAll('[data-revoke]').length === {initial_key_count + 1}"
        )

        page.click('#exportButton')
        browser.close()

    print(json.dumps({
        'ok': True,
        'views': ['operations', 'ambiguity', 'reconciliation', 'keys'],
        'backendPagination': True,
        'globalTotals': 26,
        'declaredCompleteness': True,
        'roleAwareActions': True,
        'manualResolution': True,
        'keyLifecycle': True,
        'backendConnected': True,
    }))
finally:
    server.terminate()
    try:
        server.wait(timeout=3)
    except subprocess.TimeoutExpired:
        server.kill()
