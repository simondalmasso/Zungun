(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={me:null,conversations:[],current:null,lastSeq:0,socket:null,retry:null,pollTimer:null,busy:false};
const api=async(path,options={})=>{
  const headers=new Headers(options.headers||{});headers.set('accept','application/json');
  if(options.body!==undefined)headers.set('content-type','application/json');
  const response=await fetch(path,{credentials:'same-origin',...options,headers});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok){const error=new Error(data.error||('HTTP_'+response.status));error.status=response.status;error.code=data.error||('HTTP_'+response.status);throw error}
  setConnection('Conectado',true);return data;
};
function setConnection(label,connected){$('connectionState').textContent=label;$('connectionDot').parentElement.classList.toggle('connected',Boolean(connected));$('connectionDot').parentElement.classList.toggle('offline',!connected)}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),2100)}
function showError(id,error){const map={
  UNAUTHORIZED:'Tu sesión terminó. Entrá de nuevo.',
  IDENTITY_NOT_FOUND:'No encontramos ese código.',
  SELF_CONVERSATION_NOT_ALLOWED:'Ese es tu propio código.',
  PAIRING_CODE_INVALID:'Revisá el código e intentá otra vez.',
  RATE_LIMITED:'Esperá un momento e intentá de nuevo.',
  MESSAGE_BODY_INVALID:'Escribí un mensaje de hasta 2.000 caracteres.',
  FORBIDDEN:'No tenés acceso a esta conversación.'
};$(id).textContent=map[error.code]||((error.message==='Failed to fetch'||error.message==='Load failed')?'No se pudo conectar. Revisá tu conexión.':'No se pudo completar. Intentá de nuevo.')}
function openAuth(message=''){
  closeSocket();state.me=null;state.current=null;$('chatView').classList.add('hidden');$('authView').classList.remove('hidden');$('accountError').textContent=message;
}
function openApp(){
  $('authView').classList.add('hidden');$('chatView').classList.remove('hidden');$('myName').textContent=state.me.displayName;$('myCode').textContent=state.me.pairingCode;$('myAvatar').textContent=initial(state.me.displayName);loadConversations();
}
function initial(name){return Array.from(String(name||'z').trim())[0]?.toLocaleUpperCase()||'Z'}
function closeSocket(){if(state.retry){clearTimeout(state.retry);state.retry=null}if(state.socket){state.socket.onclose=null;try{state.socket.close()}catch{}state.socket=null}}
async function boot(){
  try{const data=await api('/api/v1/me');state.me=data.identity;openApp()}
  catch(error){if(error.status===401){openAuth();setConnection('Conectado',true)}else{openAuth('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');setConnection('Sin conexión',false)}}
}
$('accountForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;const name=$('displayName').value.trim();if(!name)return;
  state.busy=true;$('createAccount').disabled=true;$('accountError').textContent='';
  try{await api('/api/v1/identity',{method:'POST',body:JSON.stringify({displayName:name,client:'browser'})});const data=await api('/api/v1/me');state.me=data.identity;openApp()}
  catch(error){showError('accountError',error)}
  finally{state.busy=false;$('createAccount').disabled=false}
});
function renderConversations(){
  const root=$('conversationList');root.replaceChildren();
  if(!state.conversations.length){const empty=document.createElement('div');empty.className='list-empty';empty.textContent='Todavía no hay chats. Tocá + para empezar.';root.append(empty);return}
  for(const c of state.conversations){
    const button=document.createElement('button');button.type='button';button.className='conversation-item'+(state.current?.conversationId===c.conversationId?' active':'');
    const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=initial(c.peer.displayName);
    const copy=document.createElement('span');copy.className='conversation-copy';
    const title=document.createElement('strong');title.textContent=c.peer.displayName;
    const code=document.createElement('span');code.textContent=c.peer.pairingCode;
    copy.append(title,code);button.append(avatar,copy);button.addEventListener('click',()=>openConversation(c));root.append(button)
  }
}
async function loadConversations(){
  try{const data=await api('/api/v1/conversations');state.conversations=data.items||[];renderConversations();
    if(state.current){const updated=state.conversations.find(c=>c.conversationId===state.current.conversationId);if(!updated){state.current=null;showEmpty()}else state.current=updated}
  }catch(error){if(error.status===401)openAuth('Tu sesión terminó. Entrá de nuevo.');else setConnection('Sin conexión',false)}
}
$('newChat').addEventListener('click',togglePairForm);$('startChat').addEventListener('click',togglePairForm);
function togglePairForm(){const form=$('pairForm');form.classList.toggle('hidden');if(!form.classList.contains('hidden')){$('pairError').textContent='';$('pairCode').focus()}}
$('pairForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;const code=$('pairCode').value.trim().toUpperCase();if(!code)return;
  const button=$('pairForm').querySelector('button[type="submit"]');button.disabled=true;$('pairError').textContent='';
  try{const data=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({pairingCode:code})});$('pairCode').value='';$('pairForm').classList.add('hidden');await loadConversations();const conv=state.conversations.find(c=>c.conversationId===data.conversation.conversationId)||data.conversation;await openConversation(conv)}
  catch(error){showError('pairError',error)}
  finally{button.disabled=false}
});
$('copyCode').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(state.me.pairingCode);toast('Código copiado')}
  catch{toast('Tu código: '+state.me.pairingCode)}
});
$('signOut').addEventListener('click',async()=>{
  $('signOut').disabled=true;
  try{await api('/api/v1/session/revoke',{method:'POST',body:'{}'});state.me=null;state.current=null;state.conversations=[];openAuth();$('displayName').value='';toast('Sesión cerrada')}
  catch(error){showError('accountError',error)}
  finally{$('signOut').disabled=false}
});
function showEmpty(){closeSocket();state.current=null;$('conversationPane').classList.add('hidden');$('emptyChat').classList.remove('hidden');$('chatView').classList.remove('in-chat');renderConversations()}
async function openConversation(conversation){
  closeSocket();state.current=conversation;state.lastSeq=0;$('chatView').classList.add('in-chat');$('emptyChat').classList.add('hidden');$('conversationPane').classList.remove('hidden');
  $('chatTitle').textContent=conversation.peer.displayName;$('peerCode').textContent=conversation.peer.pairingCode;$('peerAvatar').textContent=initial(conversation.peer.displayName);$('messages').replaceChildren();
  const loading=document.createElement('div');loading.className='loading';loading.textContent='Cargando mensajes…';$('messages').append(loading);renderConversations();
  await poll(true);connectSocket();$('messageInput').focus()
}
$('backToChats').addEventListener('click',()=>{$('chatView').classList.remove('in-chat')});
function renderMessage(message){
  const id='message-'+message.messageId;let element=document.getElementById(id);const mine=message.senderId===state.me.userId;
  if(!element){element=document.createElement('article');element.id=id;element.className='message'+(mine?' mine':'');element.dataset.sequence=String(message.sequence||0);const body=document.createElement('div');body.className='message-text';body.textContent=message.body;const meta=document.createElement('div');meta.className='message-meta';const time=document.createElement('time');time.textContent=new Date(message.clientCreatedAtMs||message.acceptedAtMs||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(time);if(mine){const status=document.createElement('span');status.className='message-status';status.textContent=message.deliveredAtMs?'Entregado':'Enviado';meta.append(status)}element.append(body,meta);$('messages').append(element)}
  else if(mine){const status=element.querySelector('.message-status');if(status)status.textContent=message.deliveredAtMs?'Entregado':'Enviado'}
  state.lastSeq=Math.max(state.lastSeq,Number(message.sequence)||0);
  if(!mine&&!message.deliveredAtMs&&state.current)api('/api/v1/conversations/'+state.current.conversationId+'/messages/'+encodeURIComponent(message.messageId)+'/ack',{method:'POST',body:'{}'}).catch(()=>{});
  $('messages').scrollTop=$('messages').scrollHeight;
}
async function poll(initial=false){
  const current=state.current;if(!current)return;
  try{const after=initial?0:Math.max(0,state.lastSeq-5);const data=await api('/api/v1/conversations/'+current.conversationId+'/messages?after='+after);
    if(state.current?.conversationId!==current.conversationId)return;
    if(initial)$('messages').replaceChildren();
    if(!data.items?.length&&initial){const empty=document.createElement('div');empty.className='messages-empty';empty.textContent='Todavía no hay mensajes. Escribí el primero.';$('messages').append(empty)}
    for(const message of (data.items||[]))renderMessage(message);
    if(!initial&&!state.lastSeq&&!(data.items||[]).length){$('messages').replaceChildren();const empty=document.createElement('div');empty.className='messages-empty';empty.textContent='Todavía no hay mensajes. Escribí el primero.';$('messages').append(empty)}
    setConnection('Conectado',true)
  }catch(error){if(error.status===401)openAuth('Tu sesión terminó. Entrá de nuevo.');else setConnection('Reconectando',false)}
}
function connectSocket(){
  if(!state.current||!navigator.onLine)return;const conversationId=state.current.conversationId;const protocol=location.protocol==='https:'?'wss:':'ws:';
  try{const socket=new WebSocket(protocol+'//'+location.host+'/api/v1/conversations/'+conversationId+'/ws');state.socket=socket;
    socket.onopen=()=>{if(state.current?.conversationId!==conversationId){socket.close();return}setConnection('Conectado',true);poll(false)};
    socket.onmessage=event=>{if(event.data==='pong')return;try{const update=JSON.parse(event.data);
      if(update.type==='message')renderMessage(update.message);
      if(update.type==='delivery_ack'){const el=document.getElementById('message-'+update.messageId);const status=el?.querySelector('.message-status');if(status)status.textContent='Entregado'}
    }catch{}};
    socket.onclose=()=>{if(state.socket===socket){state.socket=null;if(state.current?.conversationId===conversationId)state.retry=setTimeout(connectSocket,3000)}};
    socket.onerror=()=>{setConnection('Reconectando',false)}
  }catch{state.retry=setTimeout(connectSocket,3000)}
}
$('sendForm').addEventListener('submit',async event=>{
  event.preventDefault();const body=$('messageInput').value.trim();const current=state.current;if(!body||!current)return;
  if(state.busy)return;state.busy=true;$('sendButton').disabled=true;$('sendError').textContent='';
  const id='msg_'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
  try{const data=await api('/api/v1/conversations/'+current.conversationId+'/messages',{method:'POST',body:JSON.stringify({messageId:id,body,clientCreatedAtMs:Date.now()})});
    if(state.current?.conversationId===current.conversationId)renderMessage(data.message);$('messageInput').value='';$('messageInput').focus();await loadConversations()
  }catch(error){showError('sendError',error)}
  finally{state.busy=false;$('sendButton').disabled=false}
});
window.addEventListener('online',()=>{setConnection('Conectando',false);poll();connectSocket()});
window.addEventListener('offline',()=>setConnection('Sin conexión',false));
state.pollTimer=setInterval(()=>{if(state.current)poll(false);else loadConversations()},4000);
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(location.protocol==='file:')setConnection('Abrí desde el enlace',false);
boot();
})();