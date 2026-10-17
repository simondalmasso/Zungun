import{api,ensureIdentity,nav,stateLabel}from'/common.js';
nav('messages');
let me=null,current=null,ws=null,lastSeq=0,conversations=[];
const convs=document.getElementById('conversations');
const msgs=document.getElementById('messages');
const socket=document.getElementById('socket');
const socketLabel=socket.querySelector('.connection-label');
const sendForm=document.getElementById('send');
const sendButton=sendForm.querySelector('.send-button');
const messageInput=sendForm.elements.body;
const hint=document.getElementById('composer-hint');
const search=document.getElementById('conversation-search');
const empty=document.getElementById('thread-empty');

function initials(name){return String(name||'Z').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'Z'}
function formatTime(ms){if(!Number.isFinite(Number(ms)))return'';return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(Number(ms)))}
function setSocket(label,state='offline'){socketLabel.textContent=label;socket.dataset.state=state}
function updateComposer(){const ready=Boolean(current&&me&&messageInput.value.trim());sendButton.disabled=!ready;hint.textContent=current?'Sent means durable server acceptance.':'Select a conversation to send.'}
function scrollToLatest(){requestAnimationFrame(()=>{msgs.scrollTop=msgs.scrollHeight})}
function showThread(){document.body.classList.add('conversation-open');document.getElementById('thread-pane').removeAttribute('aria-hidden')}
function showList(){document.body.classList.remove('conversation-open');document.getElementById('thread-pane').setAttribute('aria-hidden','true');search.focus({preventScroll:true})}
function renderConversationList(){
  const q=search.value.trim().toLocaleLowerCase();convs.innerHTML='';
  const visible=conversations.filter(c=>String(c.peer?.displayName||'').toLocaleLowerCase().includes(q));
  if(!visible.length){convs.innerHTML=`<div class="muted">${conversations.length?'No matching conversations.':'No conversations yet.'}</div>`;return}
  for(const c of visible){
    const b=document.createElement('button');b.type='button';b.className='conversation-row';b.dataset.conversationId=c.conversationId;
    b.setAttribute('aria-current',current?.conversationId===c.conversationId?'true':'false');b.setAttribute('aria-label',`Open conversation with ${c.peer.displayName}`);
    const a=document.createElement('span');a.className='avatar';a.textContent=initials(c.peer.displayName);
    const copy=document.createElement('span');copy.className='conversation-copy';
    const name=document.createElement('span');name.className='conversation-name';name.textContent=c.peer.displayName;
    const preview=document.createElement('span');preview.className='conversation-preview';preview.textContent=current?.conversationId===c.conversationId?'Open conversation':'Tap to open';
    copy.append(name,preview);const chevron=document.createElement('span');chevron.className='conversation-chevron';chevron.setAttribute('aria-hidden','true');chevron.textContent='›';
    b.append(a,copy,chevron);b.addEventListener('click',()=>open(c));convs.append(b)
  }
}
async function loadConvs(){
  if(!me){conversations=[];convs.innerHTML='<div class="notice">Create an identity to start messaging.</div>';return}
  try{const d=await api('/api/v1/conversations',{method:'GET',headers:{}});conversations=Array.isArray(d.items)?d.items:[];renderConversationList()}catch(e){convs.innerHTML='<div class="error">Could not load conversations.</div>';throw e}
}
function render(m){
  if(document.getElementById(`msg-${CSS.escape(m.messageId)}`))return;
  empty?.remove();
  const d=document.createElement('div');d.id=`msg-${m.messageId}`;d.className='message '+(m.senderId===me?.userId?'mine':'');
  const text=document.createElement('div');text.textContent=m.body;
  const s=document.createElement('small');
  const state=document.createElement('span');state.textContent=m.senderId===me?.userId?stateLabel(m.deliveredAtMs?'DELIVERED':'SENT'):'Delivered to this client';
  const time=document.createElement('span');time.className='message-time';time.textContent=formatTime(m.acceptedAtMs||m.clientCreatedAtMs);
  s.append(state,time);d.append(text,s);msgs.append(d);
  if(m.senderId!==me?.userId&&!m.deliveredAtMs&&current)api(`/api/v1/conversations/${current.conversationId}/messages/${encodeURIComponent(m.messageId)}/ack`,{method:'POST',body:'{}'}).catch(()=>{});
  lastSeq=Math.max(lastSeq,Number(m.sequence)||0);scrollToLatest()
}
async function poll(){if(!current)return;try{const d=await api(`/api/v1/conversations/${current.conversationId}/messages?after=${lastSeq}`,{method:'GET',headers:{}});d.items.forEach(render)}catch(e){console.error(e);setSocket('Reconnecting','polling')}}
function closeSocket(){if(ws){try{ws.close()}catch{}ws=null}}
function connect(){
  closeSocket();if(!current)return;const conversationId=current.conversationId;const protocol=location.protocol==='https:'?'wss:':'ws:';
  setSocket('Connecting','connecting');ws=new WebSocket(`${protocol}//${location.host}/api/v1/conversations/${conversationId}/ws`);
  ws.onopen=()=>{if(current?.conversationId!==conversationId)return;setSocket('Live','live');poll()};
  ws.onclose=()=>{if(current?.conversationId!==conversationId)return;setSocket('Reconnecting','polling');setTimeout(()=>current?.conversationId===conversationId&&connect(),2500)};
  ws.onerror=()=>{if(current?.conversationId===conversationId)setSocket('Reconnecting','polling')};
  ws.onmessage=e=>{if(e.data==='pong')return;try{const x=JSON.parse(e.data);if(x.type==='message')render(x.message);if(x.type==='delivery_ack'){const el=document.getElementById(`msg-${CSS.escape(x.messageId)}`);if(el){const label=el.querySelector('small span');if(label)label.textContent=stateLabel('DELIVERED')}}}catch{}}
}
async function open(c){
  current=c;lastSeq=0;msgs.innerHTML='';document.getElementById('chat-title').textContent=c.peer.displayName;document.getElementById('chat-subtitle').textContent='Application-level delivery acknowledgement';document.getElementById('chat-avatar').textContent=initials(c.peer.displayName);
  renderConversationList();showThread();updateComposer();await poll();connect();messageInput.focus({preventScroll:true})
}
window.addEventListener('zungun-identity',e=>{me=e.detail;loadConvs();updateComposer()});
window.addEventListener('zungun-signout',()=>{me=null;current=null;closeSocket();msgs.innerHTML='';setSocket('Offline','offline');showList();loadConvs();updateComposer()});
const initialMe=await ensureIdentity();if(initialMe&&!me){me=initialMe;await loadConvs()}updateComposer();
document.getElementById('pair').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),err=document.getElementById('pair-error');err.textContent='';try{const r=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({pairingCode:String(fd.get('code')).toUpperCase()})});form.reset();await loadConvs();await open(r.conversation)}catch(x){err.textContent=x.message}});
sendForm.addEventListener('submit',async e=>{
  e.preventDefault();const err=document.getElementById('send-error');err.textContent='';if(!current){err.textContent='Choose a conversation first.';return}
  const body=messageInput.value.trim();if(!body)return;const id=`msg_${crypto.randomUUID()}`;sendButton.disabled=true;sendForm.setAttribute('aria-busy','true');
  try{const r=await api(`/api/v1/conversations/${current.conversationId}/messages`,{method:'POST',body:JSON.stringify({messageId:id,body,clientCreatedAtMs:Date.now()})});render(r.message);sendForm.reset();messageInput.style.height='auto'}catch(x){err.textContent=x.message}finally{sendForm.removeAttribute('aria-busy');updateComposer();messageInput.focus({preventScroll:true})}
});
messageInput.addEventListener('input',()=>{messageInput.style.height='auto';messageInput.style.height=`${Math.min(messageInput.scrollHeight,124)}px`;updateComposer()});
messageInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!sendButton.disabled)sendForm.requestSubmit()}});
search.addEventListener('input',renderConversationList);document.getElementById('back-to-list').addEventListener('click',showList);
window.addEventListener('offline',()=>{closeSocket();setSocket('Offline','offline')});
window.addEventListener('online',()=>{if(current)connect()});
window.addEventListener('popstate',()=>{if(matchMedia('(max-width:720px)').matches&&document.body.classList.contains('conversation-open'))showList()});
setInterval(()=>{if(current)poll()},5000);
