# PROVENANCE: RECONSTRUCTED_FROM_ORDER.
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

target = Path(sys.argv[1] if len(sys.argv) > 1 else '.generated/browser-kit/index.html')
html = target.read_text(encoding='utf-8')
routes = [
    '#/overview', '#/inbox', '#/operations/OP-DEMO-WO-2841-001',
    '#/operations/OP-DEMO-WO-2841-001/timeline', '#/operations/OP-DEMO-WO-2841-001/proof',
    '#/operations/OP-DEMO-WO-2841-001/decision', '#/integration',
]
passed = 0
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content(html, wait_until='load')
    for route in routes:
        page.evaluate('(route) => { location.hash = route; }', route)
        page.wait_for_timeout(20)
        active = page.locator('body').get_attribute('data-active-route')
        visible = page.locator(f'[data-route="{route}"]').evaluate('(el) => el.classList.contains("active")')
        if active != route or not visible:
            raise RuntimeError(f'route failed: {route}, active={active}, visible={visible}')
        passed += 1
    browser.close()
print(json.dumps({'ok': True, 'passed': passed, 'total': len(routes), 'browser': 'chromium', 'navigationMode': 'set_content_no_network'}))
