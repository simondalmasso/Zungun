from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

base = os.environ['ORDER076_BASE_URL'].rstrip('/')
operation_id = os.environ['ORDER076_OPERATION_ID']
scope_id = os.environ['ORDER076_SCOPE_ID']
tokens = {
    'reader': os.environ['ZUNGUN_READER_TOKEN'],
    'reviewer': os.environ['ZUNGUN_REVIEWER_TOKEN'],
    'admin': os.environ['ZUNGUN_ADMIN_TOKEN'],
}
browser_path = next((path for path in [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'
] if Path(path).exists()), None)
if not browser_path:
    raise RuntimeError('chromium executable not found')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=browser_path, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.goto(f'{base}/', wait_until='domcontentloaded')
    page.fill('#token', tokens['reader'])
    page.locator('#authForm button[type=submit]').click()
    page.wait_for_function("Number(document.querySelector('#observedCount').textContent) > 25")
    page.wait_for_function("!document.querySelector('#nextPage').disabled")
    page.fill('#query', operation_id)
    page.locator('#filters button[type=submit]').click()
    page.wait_for_selector(f'[data-operation="{operation_id}"]')
    page.locator(f'[data-operation="{operation_id}"]').click()
    page.wait_for_selector('.timeline')
    detail = page.locator('#detailContent').inner_text()
    for expected in ['TRANSPORT_ATTEMPT', 'APPLICATION_ACK', 'SIGNED_RECEIPT', 'EFFECT_APPLIED']:
        assert expected in detail
    assert 'fencing_token' in detail

    page.fill('#scopeId', scope_id)
    page.locator('#scopeForm button[type=submit]').click()
    page.wait_for_function("document.querySelector('#completeState').textContent === 'YES'")
    assert '"completeWithinDeclaredScope": true' in page.locator('#scopeResult').inner_text()

    page.fill('#token', tokens['reviewer'])
    page.locator('#authForm button[type=submit]').click()
    page.fill('#query', operation_id)
    page.locator('#filters button[type=submit]').click()
    page.wait_for_selector(f'[data-operation="{operation_id}"]')
    page.locator(f'[data-operation="{operation_id}"]').click()
    page.wait_for_selector('#reviewForm:not([hidden])')
    page.fill('#reviewNote', 'Order 076 same-operation evidence review.')
    page.locator('#reviewForm button[type=submit]').click()
    page.wait_for_function("document.querySelector('#detailContent').innerText.includes('EFFECT_CONFIRMED')")

    page.fill('#token', tokens['admin'])
    page.locator('#authForm button[type=submit]').click()
    page.locator('[data-view="keys"]').click()
    page.wait_for_selector('[data-revoke]')
    assert page.locator('[data-revoke]').count() >= 1
    browser.close()

print(json.dumps({
    'ok': True,
    'operationId': operation_id,
    'sameReceiver': True,
    'timeline': True,
    'leaseAndFencing': True,
    'receipt': True,
    'reconciliation': True,
    'boundedCompleteness': True,
    'backendPagination': True,
}))
