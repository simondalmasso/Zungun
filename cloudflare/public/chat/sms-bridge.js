(function(root){
  'use strict';
  const PREFIX='ZUNGUN-SMS/1';
  const CONFIG_KEY='zungun-sms-bridge-v1';

  function encodeBase64Url(text){
    const bytes=new TextEncoder().encode(String(text));
    let binary='';
    for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decodeBase64Url(value){
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]*$/.test(value))throw new TypeError('SMS_ENVELOPE_BODY_INVALID');
    const base=value.replace(/-/g,'+').replace(/_/g,'/');
    const binary=atob(base+'='.repeat((4-base.length%4)%4));
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  function encodeEnvelope(message){
    if(!message||typeof message.conversationId!=='string'||!message.conversationId||typeof message.messageId!=='string'||!/^msg_[A-Za-z0-9_-]{8,}$/.test(message.messageId)||!Number.isSafeInteger(message.clientCreatedAtMs)||typeof message.body!=='string'||!message.body.trim()||message.body.length>2000)throw new TypeError('SMS_ENVELOPE_INVALID');
    return [PREFIX,message.conversationId,message.messageId,String(message.clientCreatedAtMs),encodeBase64Url(message.body)].join('|');
  }
  function decodeEnvelope(text){
    if(typeof text!=='string'||text.length>12000)throw new TypeError('SMS_ENVELOPE_INVALID');
    const parts=text.split('|');
    if(parts.length!==5||parts[0]!==PREFIX||!parts[1]||!/^msg_[A-Za-z0-9_-]{8,}$/.test(parts[2])||!/^\d+$/.test(parts[3]))throw new TypeError('SMS_ENVELOPE_INVALID');
    const clientCreatedAtMs=Number(parts[3]);
    if(!Number.isSafeInteger(clientCreatedAtMs))throw new TypeError('SMS_ENVELOPE_INVALID');
    const body=decodeBase64Url(parts[4]);
    if(!body.trim()||body.length>2000)throw new TypeError('SMS_ENVELOPE_INVALID');
    return {conversationId:parts[1],messageId:parts[2],clientCreatedAtMs,body};
  }
  function normalizeGatewayUrl(value){
    let url;
    try{url=new URL(String(value).trim())}catch{throw new TypeError('SMS_GATEWAY_URL_INVALID')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new TypeError('SMS_GATEWAY_URL_INVALID');
    return url.href.replace(/\/$/,'');
  }
  function isAmbiguous(error){
    return !error||!Number.isFinite(Number(error.status))||Number(error.status)===0||Number(error.status)>=500;
  }
  function createClient({fetchImpl,storage}={}){
    const request=fetchImpl||(typeof fetch==='function'?fetch.bind(root):null);
    const store=storage||(root.localStorage);
    if(!request||!store)throw new TypeError('SMS_BRIDGE_DEPENDENCY_MISSING');
    function readConfig(){
      try{const value=JSON.parse(store.getItem(CONFIG_KEY)||'null');return value&&typeof value==='object'?value:null}catch{return null}
    }
    function saveConfig(config){
      const gatewayUrl=normalizeGatewayUrl(config&&config.gatewayUrl);
      const username=String(config&&config.username||'');
      const password=String(config&&config.password||'');
      if(!username||!password)throw new TypeError('SMS_GATEWAY_CREDENTIALS_REQUIRED');
      store.setItem(CONFIG_KEY,JSON.stringify({gatewayUrl,username,password}));
      return {gatewayUrl,username};
    }
    function clearConfig(){store.removeItem(CONFIG_KEY)}
    async function send({phoneNumber,message}){
      const config=readConfig();
      if(!config)throw new Error('SMS_BRIDGE_NOT_CONFIGURED');
      if(typeof phoneNumber!=='string'||!/^\+[1-9]\d{7,14}$/.test(phoneNumber))throw new TypeError('SMS_PHONE_E164_REQUIRED');
      const text=encodeEnvelope(message);
      const gatewayMessageId=message.messageId.replace(/^msg_/,'');
      if(gatewayMessageId.length>36)throw new TypeError('SMS_GATEWAY_MESSAGE_ID_TOO_LONG');
      const headers=new Headers({'content-type':'application/json','accept':'application/json'});
      headers.set('authorization','Basic '+btoa(unescape(encodeURIComponent(config.username+':'+config.password))));
      let response;
      try{
        response=await request(config.gatewayUrl+'/messages',{method:'POST',mode:'cors',credentials:'omit',headers,body:JSON.stringify({id:gatewayMessageId,textMessage:{text},phoneNumbers:[phoneNumber],withDeliveryReport:true})});
      }catch(error){const ambiguous=new Error('SMS_SEND_UNKNOWN');ambiguous.code='SMS_SEND_UNKNOWN';ambiguous.cause=error;throw ambiguous}
      let data={};try{data=await response.json()}catch{}
      if(!response.ok){const error=new Error('SMS_GATEWAY_HTTP_'+response.status);error.status=response.status;error.code=data.error||error.message;error.ambiguous=isAmbiguous(error);throw error}
      return {state:'ACCEPTED_BY_GATEWAY',gatewayResponse:data,deliveryConfirmed:false,messageId:message.messageId,gatewayMessageId:data.id||gatewayMessageId};
    }
    return {readConfig,saveConfig,clearConfig,send};
  }
  function acceptIncoming({incoming,expectedPhoneNumber,conversationId,storage}){
    if(!incoming||incoming.type!=='SMS'||typeof incoming.sender!=='string'||typeof incoming.contentPreview!=='string')throw new TypeError('SMS_INCOMING_INVALID');
    if(!/^\+[1-9]\d{7,14}$/.test(expectedPhoneNumber||'')||incoming.sender!==expectedPhoneNumber)throw new Error('SMS_SENDER_NOT_AUTHORIZED');
    const message=decodeEnvelope(incoming.contentPreview);
    if(message.conversationId!==conversationId)throw new Error('SMS_CONVERSATION_MISMATCH');
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw new TypeError('SMS_BRIDGE_STORAGE_REQUIRED');
    const key=CONFIG_KEY+':received:'+conversationId;
    let ids=[];try{const parsed=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(parsed))ids=parsed.filter(id=>typeof id==='string')}catch{}
    if(ids.includes(message.messageId))return {accepted:false,reason:'DUPLICATE',messageId:message.messageId};
    ids.push(message.messageId);if(ids.length>500)ids=ids.slice(-500);
    storage.setItem(key,JSON.stringify(ids));
    return {accepted:true,message};
  }
  const api={encodeEnvelope,decodeEnvelope,normalizeGatewayUrl,isAmbiguous,createClient,acceptIncoming,configKey:CONFIG_KEY};
  root.ZungunSmsBridge=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
