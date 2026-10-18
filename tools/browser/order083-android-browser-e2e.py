from pathlib import Path
import json, os, subprocess, time
from playwright.sync_api import sync_playwright, expect
origin=os.environ.get('ZUNGUN_ORIGIN','https://zungun.simondalmasso44.workers.dev').rstrip('/')
out=Path(os.environ.get('ORDER083_ANDROID_BROWSER_EVIDENCE','evidence/order083/android-browser'));out.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[2]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);ctx=b.new_context(viewport={'width':390,'height':844});page=ctx.new_page();page.goto(origin+'/messages',wait_until='networkidle')
    page.get_by_placeholder('Display name').fill('ORDER083 Browser Android Bridge');page.get_by_role('button',name='Create identity').click();expect(page.get_by_text('Pairing code')).to_be_visible();code=page.locator('#account .meta').inner_text().split()[-1]
    env=dict(os.environ);env['JAVA_HOME']=env.get('JAVA_HOME_17_X64',env.get('JAVA_HOME',''))
    cmd=['android/gradle/bootstrap-gradle.sh','-p','android','--no-daemon','--stacktrace',':app:connectedDebugAndroidTest','-Pandroid.testInstrumentationRunnerArguments.class=com.zungun.app.Order083ProductionInstrumentedTest#messengerToBrowserPairingArgument',f'-Pandroid.testInstrumentationRunnerArguments.peerCode={code}']
    proc=subprocess.Popen(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    deadline=time.time()+150;opened=False
    while time.time()<deadline and proc.poll() is None:
        try:
            page.reload(wait_until='networkidle',timeout=10000)
            btn=page.get_by_role('button',name='ORDER083 Android Browser Bridge')
            if btn.count():
                btn.click();expect(page.locator('#socket')).to_have_text('Realtime',timeout=15000);opened=True;break
        except Exception: pass
        time.sleep(1)
    if not opened:
        proc.kill();output=proc.communicate()[0];raise RuntimeError('browser conversation not observed\n'+output[-5000:])
    expect(page.get_by_text('ORDER083 Android to browser')).to_be_visible(timeout=90000)
    page.screenshot(path=str(out/'android-to-browser-delivered.png'),full_page=True)
    output=proc.communicate(timeout=120)[0];(out/'android-test.log').write_text(output)
    if proc.returncode!=0: raise RuntimeError('Android bridge test failed\n'+output[-6000:])
    expect(page.get_by_text('Delivered to this client')).to_be_visible()
    b.close()
result={'ok':True,'origin':origin,'androidToBrowser':True,'websocketClient':True,'recipientAck':True,'visualArtifact':'android-to-browser-delivered.png'};(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
