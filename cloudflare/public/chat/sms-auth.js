(function(root){
  'use strict';
  const PREFIX='ZUNGUN-SMS/2';
  const encoder=new TextEncoder();

  function encodeBase64UrlBytes(bytes){
    let binary='';
    for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decodeBase64UrlBytes(value){
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw new TypeError('SMS_AUTH_ENCODING_INVALID');
    const base=value.replace(/-/g,'+').replace(/_/g,'/');
    const binary=atob(base+'='.repeat((4-base.length%4)%4));
    return Uint8Array.from(binary,c=>c.charCodeAt(0));
  }
  function validateKey(key){
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw new TypeError('SMS_AUTH_KEY_REQUIRED');
    const bytes=decodeBase64UrlBytes(key);
    if(bytes.length!==32)throw new TypeError('SMS_AUTH_KEY_REQUIRED');
    return bytes;
  }
  function cryptoApi(){
    if(!root.crypto||!root.crypto.subtle||typeof root.crypto.getRandomValues!=='function')throw new Error('SMS_CRYPTO_UNAVAILABLE');
    return root.crypto;
  }
  async function importKey(key){
    return cryptoApi().subtle.importKey('raw',validateKey(key),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  }
  function validateMessage(message){
    if(!message||
      typeof message.conversationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(message.conversationId)||
      typeof message.messageId!=='string'||!/^msg_[A-Za-z0-9_-]{8,}$/.test(message.messageId)||
      !Number.isSafeInteger(message.clientCreatedAtMs)||
      typeof message.body!=='string'||!message.body.trim()||message.body.length>2000){
      throw new TypeError('SMS_ENVELOPE_INVALID');
    }
  }
  function decodeMessage(parts){
    if(parts.length!==6||parts[0]!==PREFIX||! /^[A-Za-z0-9_-]{1,128}$/.test(parts[1])||! /^msg_[A-Za-z0-9_-]{8,}$/.test(parts[2])||!parts[3]||!Number.isSafeInteger(Number(parts[3]))||! /^[A-Za-z0-9_-]{43}$/.test(parts[5])){
      !/^[A-Za-z0-9_-]{1,128}$/.test(parts[1])||
      !/^msg_[A-Za-z0-9_-]{8,}$/.test(parts[2])||
      !/^\\d+$/.test(parts[3])||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[5])){
      throw new TypeError('SMS_ENVELOPE_INVALID');
    }
    const clientCreatedAtMs=Number(parts[3]);
    if(!Number.isSafeInteger(clientCreatedAtMs))throw new TypeError('SMS_ENVELOPE_INVALID');
    let body;
    try{body=new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64UrlBytes(parts[4]))}
    catch{throw new TypeError('SMS_ENVELOPE_INVALID')}
    if(!body.trim()||body.length>2000)throw new TypeError('SMS_ENVELOPE_INVALID');
    return {conversationId:parts[1],messageId:parts[2],clientCreatedAtMs,body};
  }
  function generateKey(){
    return encodeBase64UrlBytes(cryptoApi().getRandomValues(new Uint8Array(32)));
  }
  async function encodeAuthenticatedEnvelope(message,key){
    validateMessage(message);
    const unsigned=[PREFIX,message.conversationId,message.messageId,String(message.clientCreatedAtMs),encodeBase64UrlBytes(encoder.encode(message.body))].join('|');
    const imported=await importKey(key);
    const signature=await cryptoApi().subtle.sign('HMAC',imported,encoder.encode(unsigned));
    return unsigned+'|'+encodeBase64UrlBytes(new Uint8Array(signature));
  }
  async function decodeAuthenticatedEnvelope(text,key){
    if(typeof text!=='string'||text.length>12000)throw new TypeError('SMS_ENVELOPE_INVALID');
    const parts=text.split('|');
    const message=decodeMessage(parts);
    const imported=await importKey(key);
    const valid=await cryptoApi().subtle.verify('HMAC',imported,decodeBase64UrlBytes(parts[5]),encoder.encode(parts.slice(0,5).join('|')));
    if(!valid)throw new Error('SMS_ENVELOPE_AUTH_FAILED');
    return message;
  }

  const api={generateKey,encodeAuthenticatedEnvelope,decodeAuthenticatedEnvelope,validateKey};
  root.ZungunSmsAuth=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
