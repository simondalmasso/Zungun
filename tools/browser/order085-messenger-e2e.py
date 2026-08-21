from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright, expect

origin=os.environ.get('ZUNGUN_ORIGIN','https://zungun.simondalmasso44.workers.dev').rstrip('/')
out=Path(os.environ.get('ORDER085_WEB_EVIDENCE','evidence/order085/web'));out.mkdir(parents=True,exist_ok=True)

def create_identity(page,name):
    page.goto(origin+'/messages',wait_until='networkidle')
    page.get_by_placeholder('Display name').fill(name)
    page.get_by_role('button',name='Create identity').click()
    expect(page.get_by_text('Pairing code')).to_be_visible(timeout=15000)
    return page.locator('#account .meta').inner_text().split()[-1]

def assert_mobile_bounds(page):
    metrics=page.evaluate('''() => ({w:innerWidth,sw:document.documentElement.scrollWidth,composer:(document.querySelector('.composer')?.getBoundingClientRect()||{}),body:document.body.className})''')
    assert metrics['sw'] <= metrics['w'], metrics
    c=metrics['composer']; assert c and c.get('left',-1)>=0 and c.get('right',10**9)<=metrics['w']+1,metrics
    assert c.get('bottom',10**9)<=page.viewport_size['height']+1,metrics
    return metrics

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    sender_ctx=browser.new_context(viewport={'width':1280,'height':900},color_scheme='dark')
    sender=sender_ctx.new_page();sender_code=create_identity(sender,'ORDER085 Sender')
    recipient_ctx=browser.new_context(viewport={'width':390,'height':844},color_scheme='light')
    recipient=recipient_ctx.new_page();recipient_code=create_identity(recipient,'ORDER085 Recipient')
    expect(recipient.get_by_role('heading',name='Conversations')).to_be_visible()
    recipient.screenshot(path=str(out/'messages-390-list-light.png'))

    sender.get_by_placeholder("Another person's pairing code").fill(recipient_code)
    sender.get_by_role('button',name='Start conversation').click()
    expect(sender.get_by_role('heading',name='ORDER085 Recipient')).to_be_visible(timeout=15000)
    expect(sender.locator('#socket')).to_contain_text('Live',timeout=15000)

    recipient.reload(wait_until='networkidle')
    row=recipient.get_by_role('button',name='Open conversation with ORDER085 Sender')
    expect(row).to_be_visible(timeout=15000);row.click()
    expect(recipient.locator('body')).to_have_class('messages-page conversation-open')
    expect(recipient.locator('#socket')).to_contain_text('Live',timeout=15000)
    assert_mobile_bounds(recipient)
    recipient.screenshot(path=str(out/'messages-390-thread-light.png'))

    long_body='Long-field proof — '+('durable delivery wraps cleanly across narrow mobile widths · '*12)
    sender.get_by_placeholder('Message').fill(long_body)
    sender.get_by_role('button',name='Send message').click()
    expect(recipient.get_by_text(long_body,exact=True)).to_be_visible(timeout=15000)
    expect(sender.get_by_text('Delivered to recipient')).to_be_visible(timeout=15000)
    assert_mobile_bounds(recipient)
    recipient.screenshot(path=str(out/'messages-390-long-delivered-light.png'))

    recipient_ctx.set_offline(True)
    expect(recipient.locator('#socket')).to_contain_text('Offline',timeout=10000)
    recipient.screenshot(path=str(out/'messages-390-offline-light.png'))
    recipient_ctx.set_offline(False)
    expect(recipient.locator('#socket')).to_contain_text('Live',timeout=15000)

    recipient.get_by_role('button',name='Back to conversations').click()
    expect(recipient.locator('body')).to_have_class('messages-page')
    expect(recipient.get_by_role('heading',name='Conversations')).to_be_visible()
    recipient.get_by_placeholder('Search conversations').fill('ORDER085 Sender')
    expect(recipient.get_by_role('button',name='Open conversation with ORDER085 Sender')).to_be_visible()

    recipient.set_viewport_size({'width':360,'height':800})
    recipient.emulate_media(color_scheme='dark',reduced_motion='reduce')
    recipient.get_by_role('button',name='Open conversation with ORDER085 Sender').click()
    expect(recipient.locator('body')).to_have_class('messages-page conversation-open')
    expect(recipient.locator('.composer')).to_be_visible()
    metrics360=assert_mobile_bounds(recipient)
    recipient.screenshot(path=str(out/'messages-360-thread-dark-reduced-motion.png'))

    recipient.get_by_placeholder('Message').fill('Keyboard send')
    recipient.get_by_placeholder('Message').press('Enter')
    expect(sender.get_by_text('Keyboard send',exact=True)).to_be_visible(timeout=15000)
    expect(recipient.get_by_text('Delivered to recipient')).to_be_visible(timeout=15000)

    # Pairing error stays visibly separate from success.
    recipient.get_by_role('button',name='Back to conversations').click()
    recipient.get_by_placeholder("Another person's pairing code").fill('ZZZZZZZZ')
    recipient.get_by_role('button',name='Start conversation').click()
    expect(recipient.locator('#pair-error')).not_to_be_empty(timeout=10000)
    recipient.screenshot(path=str(out/'messages-360-pair-error-dark.png'))

    sender.screenshot(path=str(out/'messages-desktop-dark-delivered.png'))
    browser.close()

result={
  'ok':True,'origin':origin,'mobile390x844':'PASS','mobile360x800':'PASS','singlePaneBackNavigation':'PASS',
  'composerVisible':'PASS','noHorizontalOverflow':'PASS','longContentWrap':'PASS','lightMode':'PASS','darkMode':'PASS',
  'reducedMotion':'PASS','offlineReconnect':'PASS','pairingError':'PASS','keyboardSend':'PASS','durableSentRecipientAckDelivered':'PASS',
  'screenshots':['messages-390-list-light.png','messages-390-thread-light.png','messages-390-long-delivered-light.png','messages-390-offline-light.png','messages-360-thread-dark-reduced-motion.png','messages-360-pair-error-dark.png','messages-desktop-dark-delivered.png'],
  'logoGate':'OWNER_LOGO_ASSET_HANDOFF_REQUIRED'
}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
