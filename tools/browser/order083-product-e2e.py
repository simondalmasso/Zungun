from pathlib import Path
import json, os, time
from playwright.sync_api import sync_playwright, expect

origin=os.environ.get('ZUNGUN_ORIGIN','https://zungun.simondalmasso44.workers.dev').rstrip('/')
out=Path(os.environ.get('ORDER083_WEB_EVIDENCE','evidence/order083/web'));out.mkdir(parents=True,exist_ok=True)

def create_identity_api(ctx,name):
    r=ctx.request.post(origin+'/api/v1/identity',data={'displayName':name,'client':'android'})
    assert r.status==201,r.text();return r.json()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    desktop=browser.new_context(viewport={'width':1440,'height':1000})
    control=desktop.new_page();control.goto(origin+'/control',wait_until='networkidle')
    control.get_by_placeholder('Display name').fill('ORDER083 Control UI')
    control.get_by_role('button',name='Create identity').click();expect(control.get_by_text('Pairing code')).to_be_visible()
    field_ctx=browser.new_context(); field=create_identity_api(field_ctx,'ORDER083 Field UI')['identity']
    control.get_by_placeholder('Title').fill('UI field check')
    control.get_by_placeholder('Short description').fill('Created through the real Control UI')
    control.get_by_placeholder('Assignee pairing code').fill(field['pairingCode'])
    control_responses=[]
    control.on('response',lambda r: control_responses.append({'url':r.url,'status':r.status}) if '/api/v1/work-orders' in r.url else None)
    control.get_by_role('button',name='Create work order').click()
    try:
        expect(control.get_by_text('UI field check')).to_be_visible(timeout=15000)
    except Exception:
        (out/'control-create-debug.json').write_text(json.dumps({'createError':control.locator('#create-error').inner_text(),'responses':control_responses},indent=2)+'\n')
        control.screenshot(path=str(out/'control-create-failure.png'),full_page=True)
        raise
    control.screenshot(path=str(out/'control-desktop.png'),full_page=True)
    # Refresh survival.
    control.reload(wait_until='networkidle');expect(control.get_by_text('ORDER083 Control UI')).to_be_visible()
    # Error state must render without optimistic success.
    control.get_by_placeholder('Title').fill('Invalid target')
    control.get_by_placeholder('Assignee pairing code').fill('ZZZZZZZZ')
    control.get_by_role('button',name='Create work order').click();expect(control.locator('#create-error')).not_to_be_empty(timeout=10000)

    sender_ctx=browser.new_context(viewport={'width':1280,'height':900})
    sender=sender_ctx.new_page();sender.goto(origin+'/messages',wait_until='networkidle')
    sender.get_by_placeholder('Display name').fill('ORDER083 Sender UI');sender.get_by_role('button',name='Create identity').click();expect(sender.get_by_text('Pairing code')).to_be_visible()
    sender_code=sender.locator('#account .meta').inner_text().split()[-1]

    recipient_ctx=browser.new_context(viewport={'width':390,'height':844})
    recipient=recipient_ctx.new_page();recipient.goto(origin+'/messages',wait_until='networkidle')
    recipient.get_by_placeholder('Display name').fill('ORDER083 Recipient UI');recipient.get_by_role('button',name='Create identity').click();expect(recipient.get_by_text('Pairing code')).to_be_visible()
    recipient_code=recipient.locator('#account .meta').inner_text().split()[-1]
    recipient.screenshot(path=str(out/'messages-mobile-before.png'),full_page=True)

    sender.get_by_placeholder("Another person's pairing code").fill(recipient_code)
    sender.get_by_role('button',name='Start conversation').click();expect(sender.get_by_role('button',name='ORDER083 Recipient UI')).to_be_visible(timeout=10000)
    sender.get_by_role('button',name='ORDER083 Recipient UI').click();expect(sender.locator('#socket')).to_have_text('Realtime',timeout=15000)
    recipient.reload(wait_until='networkidle');expect(recipient.get_by_role('button',name='ORDER083 Sender UI')).to_be_visible(timeout=10000);recipient.get_by_role('button',name='ORDER083 Sender UI').click();expect(recipient.locator('#socket')).to_have_text('Realtime',timeout=15000)
    sender.get_by_placeholder('Message').fill('ORDER083 realtime hello')
    sender.get_by_role('button',name='Send').click();expect(recipient.get_by_text('ORDER083 realtime hello')).to_be_visible(timeout=15000)
    expect(sender.get_by_text('Delivered to recipient')).to_be_visible(timeout=15000)
    recipient.screenshot(path=str(out/'messages-mobile-delivered.png'),full_page=True)
    sender.screenshot(path=str(out/'messages-desktop-delivered.png'),full_page=True)

    for route, heading in [('/','Know what actually happened.'),('/developers','Durability without optimistic claims.'),('/ops','Inspect what supports the claim.')]:
        page=desktop.new_page();page.goto(origin+route,wait_until='networkidle');expect(page.get_by_role('heading',name=heading)).to_be_visible();page.close()
    browser.close()

result={'ok':True,'origin':origin,'desktop':True,'mobile390':True,'identityRefreshSurvival':True,'controlCreate':True,'errorState':True,'websocketRealtime':True,'recipientAckDelivery':True,'screenshots':['control-desktop.png','messages-mobile-before.png','messages-mobile-delivered.png','messages-desktop-delivered.png']}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
