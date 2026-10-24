(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={me:null,conversations:[],current:null,lastSeq:0,socket:null,retry:null,pollTimer:null,busy:false,drainingOutbox:false,transportMode:window.ZungunOutbox.readTransportMode(window),outbox:window.ZungunOutbox.createStore(window.localStorage),activeRequests:new Set()};
const api=async(path,options={})=>{
  if(!window.ZungunOutbox.canUseInternetApi(state.transportMode)){
    const error=new Error('Internet API disabled by selected transport mode');error.code='TRANSPORT_DISABLED';throw error;
  }
  const headers=new Headers(options.headers||{});headers.set('accept','application/json');
  if(options.body!==undefined)headers.set('content-type','application/json');
  const controller=new AbortController();state.activeRequests.add(controller);
  try{
    const response=await fetch(path,{credentials:'same-origin',...options,signal:controller.signal,headers});
    let data={};try{data=await response.json()}catch{}
    if(!window.ZungunOutbox.canUseInternetApi(state.transportMode)){
      const error=new Error('Internet API disabled by selected transport mode');error.code='TRANSPORT_DISABLED';throw error;
    }
    if(!response.ok){const error=new Error(data.error||('HTTP_'+response.status));error.status=response.status;error.code=data.error||('HTTP_'+response.status);throw error}
    setConnection('Conectado',true);return data;
  }finally{state.activeRequests.delete(controller)}
};
function setConnection(label,connected){const status=window.ZungunOutbox.connectionStatusForMode(state.transportMode,label,connected);$('connectionState').textContent=status.label;$('connectionDot').parentElement.classList.toggle('connected',Boolean(status.connected));$('connectionDot').parentElement.classList.toggle('offline',!status.connected)}
function renderTransportMode(){const satellite=state.transportMode==='SATELLITE_ONLY';const unknown=state.transportMode!=='INTERNET'&&!satellite;const button=$('transportMode');button.textContent=satellite?'Mensajes: satélite exclusivo':unknown?'Transporte bloqueado':'Mensajes: Internet';button.setAttribute('aria-pressed',String(satellite));button.title=satellite?'Modo estricto: la PWA no hace llamadas API ni abre WebSocket; los mensajes quedan locales porque no hay adaptador satelital verificado.':unknown?'Estado de transporte desconocido: el tráfico de chat está bloqueado. Tocá para habilitar Internet explícitamente.':'Los mensajes y la sincronización usan Internet.';button.classList.toggle('satellite-active',satellite||unknown);if(satellite)setConnection('Modo satelital exclusivo · tráfico de chat terrestre bloqueado',false);else if(unknown)setConnection('Transporte no verificado',false)}
$('transportMode').addEventListener('click',()=>{const next=state.transportMode==='SATELLITE_ONLY'?'INTERNET':'SATELLITE_ONLY';if(!window.ZungunOutbox.persistTransportMode(window,next)){toast('No se pudo guardar el modo; no se cambió');return}state.transportMode=next;if(next==='SATELLITE_ONLY'){closeSocket();for(const request of state.activeRequests)request.abort();state.activeRequests.clear();}renderTransportMode();if(next==='SATELLITE_ONLY')toast('Modo estricto: llamadas API y WebSocket desactivados');else{toast('Internet activado');boot();drainOutbox()}});
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
  $('authView').classList.add('hidden');$('chatView').classList.remove('hidden');$('myName').textContent=state.me.displayName;$('myCode').textContent=state.me.pairingCode;$('myAvatar').textContent=initial(state.me.displayName);if(window.ZungunOutbox.canUseInternetApi(state.transportMode)){loadConversations();drainOutbox()}else{renderConversations();setConnection('Satélite no verificado · datos locales',false)}
}
function initial(name){return Array.from(String(name||'z').trim())[0]?.toLocaleUpperCase()||'Z'}
function closeSocket(){if(state.retry){clearTimeout(state.retry);state.retry=null}if(state.socket){state.socket.onclose=null;try{state.socket.close()}catch{}state.socket=null}}
async function boot(){
  if(!window.ZungunOutbox.canUseInternetApi(state.transportMode)){openAuth('Modo satélite exclusivo: sin verificación de sesión por Internet. Volvé a activar Internet para cargar tu cuenta.');setConnection('Satélite no verificado · sin tráfico API',false);return}
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
  if(!window.ZungunOutbox.canUseInternetApi(state.transportMode))return;
  try{const data=await api('/api/v1/conversations');if(state.transportMode!=='INTERNET')return;state.conversations=data.items||[];renderConversations();
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
  if(!window.ZungunOutbox.canUseInternetApi(state.transportMode)){toast('Modo estricto: no se puede cargar el historial por Internet');return}
  closeSocket();state.current=conversation;state.lastSeq=0;$('chatView').classList.add('in-chat');$('emptyChat').classList.add('hidden');$('conversationPane').classList.remove('hidden');
  $('chatTitle').textContent=conversation.peer.displayName;$('peerCode').textContent=conversation.peer.pairingCode;$('peerAvatar').textContent=initial(conversation.peer.displayName);$('messages').replaceChildren();
  const loading=document.createElement('div');loading.className='loading';loading.textContent='Cargando mensajes…';$('messages').append(loading);renderConversations();
  await poll(true);restoreOutboxMessages();connectSocket();drainOutbox();$('messageInput').focus()
}
$('backToChats').addEventListener('click',()=>{$('chatView').classList.remove('in-chat')});
function messageStatus(message, element){
  if(message.deliveryState==='QUEUED')return message.transport==='SATELLITE_ONLY'?'Satélite no verificado · pendiente':'En cola';
  if(message.deliveryState==='SENDING')return 'Enviando';
  if(message.deliveryState==='FAILED')return 'No enviado';
  if(message.deliveredAtMs||element?.dataset.deliveryState==='DELIVERED')return 'Entregado';
  return 'Enviado';
}
function renderMessage(message){
  const id='message-'+message.messageId;const mine=message.senderId===state.me.userId;
  if(mine&&Number(message.sequence)>0)state.outbox.remove(message.messageId,state.me.userId);
  let element=document.getElementById(id);
  if(!element){
    $('messages').querySelectorAll('.messages-empty,.loading').forEach(el=>el.remove());
    element=document.createElement('article');element.id=id;element.className='message'+(mine?' mine':'');element.dataset.sequence=String(message.sequence||0);
    const body=document.createElement('div');body.className='message-text';body.textContent=message.body;
    const meta=document.createElement('div');meta.className='message-meta';
    const time=document.createElement('time');time.textContent=new Date(message.clientCreatedAtMs||message.acceptedAtMs||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    meta.append(time);
    if(mine){const status=document.createElement('span');status.className='message-status';status.textContent=messageStatus(message,element);meta.append(status)}
    element.append(body,meta);$('messages').append(element);
  }else if(mine){
    const status=element.querySelector('.message-status');if(status)status.textContent=messageStatus(message,element);
    element.dataset.sequence=String(Math.max(Number(element.dataset.sequence)||0,Number(message.sequence)||0));
  }
  if(mine){
    if(message.deliveryState)element.dataset.deliveryState=message.deliveryState;
    else if(message.deliveredAtMs)element.dataset.deliveryState='DELIVERED';
    else if(!element.dataset.deliveryState||element.dataset.deliveryState==='QUEUED'||element.dataset.deliveryState==='SENDING')element.dataset.deliveryState='SENT';
  }
  state.lastSeq=Math.max(state.lastSeq,Number(message.sequence)||0);
  if(!mine&&!message.deliveredAtMs&&state.current)api('/api/v1/conversations/'+state.current.conversationId+'/messages/'+encodeURIComponent(message.messageId)+'/ack',{method:'POST',body:'{}'}).catch(()=>{});
  $('messages').scrollTop=$('messages').scrollHeight;
}
function restoreOutboxMessages(){
  if(!state.me||!state.current)return;
  for(const item of state.outbox.list(state.me.userId,state.current.conversationId)){
    renderMessage({messageId:item.messageId,senderId:item.userId,body:item.body,clientCreatedAtMs:item.clientCreatedAtMs,sequence:0,deliveryState:item.state,transport:item.transport||'INTERNET'});
  }
}
function queueMessage(conversation,message,transport='INTERNET'){
  try{
    const item=state.outbox.enqueue({userId:state.me.userId,conversationId:conversation.conversationId,messageId:message.messageId,body:message.body,clientCreatedAtMs:message.clientCreatedAtMs,queuedAtMs:Date.now(),state:'QUEUED',transport});
    if(state.current?.conversationId===conversation.conversationId)renderMessage({...item,senderId:item.userId,sequence:0,deliveryState:item.state});
    $('messageInput').value='';$('messageInput').focus();$('sendError').textContent='';
    if(transport==='SATELLITE_ONLY'){setConnection('Satélite no verificado',false);toast('Pendiente: no hay ruta satelital verificada')}else{setConnection(navigator.onLine?'Reintentando':'Sin conexión',false);toast('Mensaje guardado para enviar')}
    return true;
  }catch(error){
    $('sendError').textContent=error.message==='OUTBOX_FULL'?'Hay demasiados mensajes pendientes. Conectate para liberar espacio.':'No se pudo guardar el mensaje en este dispositivo.';
    return false;
  }
}
async function drainOutbox(){
  if(state.drainingOutbox||!state.me||!navigator.onLine||state.transportMode==='SATELLITE_ONLY')return;
  state.drainingOutbox=true;
  try{
    for(const item of state.outbox.pending(state.me.userId,'INTERNET')){
      if(!window.ZungunOutbox.canSendInternet(state.transportMode,navigator.onLine,item.transport))break;
      state.outbox.mark(item.messageId,state.me.userId,'SENDING');
      if(state.current?.conversationId===item.conversationId)renderMessage({...item,senderId:item.userId,sequence:0,deliveryState:'SENDING'});
      try{
        if(!window.ZungunOutbox.canSendInternet(state.transportMode,navigator.onLine,item.transport)){state.outbox.mark(item.messageId,state.me.userId,'QUEUED');break}
        const data=await api('/api/v1/conversations/'+item.conversationId+'/messages',{method:'POST',body:JSON.stringify({messageId:item.messageId,body:item.body,clientCreatedAtMs:item.clientCreatedAtMs})});
        state.outbox.remove(item.messageId,state.me.userId);
        if(state.current?.conversationId===item.conversationId)renderMessage(data.message);
      }catch(error){
        if(error.status===401){
          state.outbox.mark(item.messageId,state.me.userId,'QUEUED');
          if(state.current?.conversationId===item.conversationId)renderMessage({...item,senderId:item.userId,sequence:0,deliveryState:'QUEUED'});
          openAuth('Tu sesión terminó. Entrá de nuevo.');break;
        }
        if(window.ZungunOutbox.isRetryableError(error)){
          const attempts=(Number(item.attempts)||0)+1;
          const delay=error.status===429?60000:Math.min(60000,1000*Math.pow(2,Math.min(attempts,6)));
          state.outbox.mark(item.messageId,state.me.userId,'QUEUED',error.code||'NETWORK_ERROR',Date.now()+delay);
          if(state.current?.conversationId===item.conversationId)renderMessage({...item,senderId:item.userId,sequence:0,deliveryState:'QUEUED'});
          setConnection(navigator.onLine?'Reintentando':'Sin conexión',false);break;
        }
        state.outbox.mark(item.messageId,state.me.userId,'FAILED',error.code||'DELIVERY_FAILED');
        if(state.current?.conversationId===item.conversationId)renderMessage({...item,senderId:item.userId,sequence:0,deliveryState:'FAILED'});
      }
    }
  }finally{state.drainingOutbox=false}
}
async function poll(initial=false){
  const current=state.current;if(!current||!window.ZungunOutbox.canUseInternetApi(state.transportMode))return;
  try{const after=initial?0:Math.max(0,state.lastSeq-5);const data=await api('/api/v1/conversations/'+current.conversationId+'/messages?after='+after);
    if(state.transportMode!=='INTERNET'||state.current?.conversationId!==current.conversationId)return;
    if(initial)$('messages').replaceChildren();
    if(!data.items?.length&&initial){const empty=document.createElement('div');empty.className='messages-empty';empty.textContent='Todavía no hay mensajes. Escribí el primero.';$('messages').append(empty)}
    for(const message of (data.items||[]))renderMessage(message);
    if(!initial&&!state.lastSeq&&!(data.items||[]).length&&!state.outbox.list(state.me.userId,current.conversationId).length){$('messages').replaceChildren();const empty=document.createElement('div');empty.className='messages-empty';empty.textContent='Todavía no hay mensajes. Escribí el primero.';$('messages').append(empty)}
    setConnection('Conectado',true)
  }catch(error){if(error.status===401)openAuth('Tu sesión terminó. Entrá de nuevo.');else setConnection('Reconectando',false)}
}
function connectSocket(){
  if(!state.current||!navigator.onLine||!window.ZungunOutbox.canUseInternetApi(state.transportMode))return;const conversationId=state.current.conversationId;const protocol=location.protocol==='https:'?'wss:':'ws:';
  try{const socket=new WebSocket(protocol+'//'+location.host+'/api/v1/conversations/'+conversationId+'/ws');state.socket=socket;
    socket.onopen=()=>{if(state.transportMode!=='INTERNET'||state.current?.conversationId!==conversationId){socket.close();return}setConnection('Conectado',true);poll(false)};
    socket.onmessage=event=>{if(state.transportMode!=='INTERNET'||event.data==='pong')return;try{const update=JSON.parse(event.data);
      if(update.type==='message')renderMessage(update.message);
      if(update.type==='delivery_ack'){const el=document.getElementById('message-'+update.messageId);const status=el?.querySelector('.message-status');if(status)status.textContent='Entregado'}
    }catch{}};
    socket.onclose=()=>{if(state.socket===socket){state.socket=null;if(state.transportMode==='INTERNET'&&state.current?.conversationId===conversationId)state.retry=setTimeout(connectSocket,3000)}};
    socket.onerror=()=>{setConnection('Reconectando',false)}
  }catch{state.retry=setTimeout(connectSocket,3000)}
}
$('sendForm').addEventListener('submit',async event=>{
  event.preventDefault();const body=$('messageInput').value.trim();const current=state.current;if(!body||!current)return;
  if(state.busy)return;state.busy=true;$('sendButton').disabled=true;$('sendError').textContent='';
  const message={messageId:'msg_'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)),body,clientCreatedAtMs:Date.now()};
  try{
    if(state.transportMode==='SATELLITE_ONLY'){queueMessage(current,message,'SATELLITE_ONLY');return}
    if(!navigator.onLine){queueMessage(current,message,'INTERNET');return}
    try{
      const data=await api('/api/v1/conversations/'+current.conversationId+'/messages',{method:'POST',body:JSON.stringify(message)});
      if(state.current?.conversationId===current.conversationId)renderMessage(data.message);
      $('messageInput').value='';$('messageInput').focus();await loadConversations();
    }catch(error){
      if(window.ZungunOutbox.isRetryableError(error)){queueMessage(current,message,'INTERNET')}
      else{showError('sendError',error)}
    }
  }finally{state.busy=false;$('sendButton').disabled=false}
});
window.addEventListener('online',()=>{if(state.transportMode!=='INTERNET')return;setConnection('Conectando',false);drainOutbox();if(state.current){poll();connectSocket()}else loadConversations()});
window.addEventListener('offline',()=>setConnection('Sin conexión',false));
state.pollTimer=setInterval(()=>{if(state.transportMode!=='INTERNET')return;if(state.current)poll(false);else loadConversations();drainOutbox()},4000);
if(state.transportMode==='INTERNET'&&'serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(location.protocol==='file:')setConnection('Abrí desde el enlace',false);
renderTransportMode();boot();
})();
