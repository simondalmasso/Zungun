import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { ReceiverDatabase } from './database.js';
import { PersistentReceiver } from './receiver.js';
import { TokenAuthorizer } from './auth.js';
import { LocalFileReceiptKeyProvider } from '../../../packages/security/src/receipts.js';

function send(response: ServerResponse,status:number,value:unknown,contentType='application/json; charset=utf-8'):void { const body=typeof value==='string'?value:JSON.stringify(value); response.writeHead(status,{'content-type':contentType,'content-length':Buffer.byteLength(body),'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'"}); response.end(body); }
async function bodyJson(request: IncomingMessage): Promise<unknown> { const chunks:any[]=[]; let size=0; for await (const chunk of request){size+=chunk.length;if(size>1_000_000)throw new Error('PAYLOAD_TOO_LARGE');chunks.push(chunk);} const text=Buffer.concat(chunks).toString('utf8'); return text?JSON.parse(text):{}; }
function pathParts(pathname:string):string[]{return pathname.split('/').filter(Boolean).map(decodeURIComponent);}
function mime(path:string):string { return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'} as Record<string,string>)[extname(path)] ?? 'application/octet-stream'; }

export function createReceiverServer(options:{databasePath:string;keyPath:string;apiToken:string;receiverId?:string;staticDir?:string}) {
  const database=new ReceiverDatabase(options.databasePath); const provider=new LocalFileReceiptKeyProvider(options.keyPath); const receiver=new PersistentReceiver(database,provider,options.receiverId); const auth=new TokenAuthorizer(options.apiToken);
  const staticDir=options.staticDir ?? resolve(fileURLToPath(new URL('../../../../apps/control-room/public/',import.meta.url)));
  const server=createServer(async(request: IncomingMessage,response: ServerResponse)=>{ try {
    const url=new URL(request.url ?? '/',`http://${request.headers.host ?? 'localhost'}`); const parts=pathParts(url.pathname);
    if(url.pathname==='/health')return send(response,200,{status:'ok'});
    if(url.pathname==='/ready')return send(response,200,{status:'ready',migrations:3});
    if(url.pathname.startsWith('/api/')) auth.authorize(request);
    if(request.method==='POST'&&url.pathname==='/api/v1/operations'){const payload=await bodyJson(request);return send(response,202,receiver.accept(payload,Date.now()));}
    if(request.method==='GET'&&url.pathname==='/api/v1/operations'){return send(response,200,{items:receiver.listOperations({q:url.searchParams.get('q')??'',state:url.searchParams.get('state')??'',limit:Number(url.searchParams.get('limit')??50),offset:Number(url.searchParams.get('offset')??0)})});}
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='operations'&&parts[3]&&request.method==='GET'&&parts.length===4)return send(response,200,receiver.getOperation(parts[3]));
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='operations'&&parts[3]&&parts[4]==='claim'&&request.method==='POST'){const b=await bodyJson(request) as any;return send(response,200,receiver.claim(parts[3],String(b.ownerId),Number(b.nowMs??Date.now()),Number(b.leaseMs??30000)));}
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='operations'&&parts[3]&&parts[4]==='effect'&&request.method==='POST'){const b=await bodyJson(request) as any;return send(response,200,receiver.recordEffect(parts[3],String(b.attemptId),Number(b.fencingToken),b.effect));}
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='operations'&&parts[3]&&parts[4]==='reconcile'&&request.method==='POST'){const b=await bodyJson(request) as any;return send(response,200,receiver.reconcile(parts[3],String(b.actorId),String(b.note??''),Number(b.nowMs??Date.now())));}
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='operations'&&parts[3]&&parts[4]==='cancel'&&request.method==='POST'){receiver.cancel(parts[3],Date.now());return send(response,204,'');}
    if(request.method==='GET'&&url.pathname==='/api/v1/completeness'){return send(response,200,receiver.completeness((url.searchParams.get('scopeType')??'SHIFT') as any,url.searchParams.get('scopeId')??'',Date.now()));}
    const requested=url.pathname==='/'?'index.html':url.pathname.slice(1); const safe=resolve(staticDir,requested); if(!safe.startsWith(resolve(staticDir))||!existsSync(safe))return send(response,404,{error:'NOT_FOUND'}); return send(response,200,readFileSync(safe),mime(safe));
  } catch(error){const message=error instanceof Error?error.message:'INTERNAL_ERROR';const status=message==='UNAUTHORIZED'?401:message==='OPERATION_NOT_FOUND'?404:['DUPLICATE_CONFLICT','REPLAY_DETECTED','APPLICATION_CONFLICT','LEASE_HELD'].includes(message)?409:message==='PAYLOAD_TOO_LARGE'?413:400;return send(response,status,{error:message});} });
  return {server,receiver,database,close:()=>new Promise<void>((resolveClose,reject)=>server.close((e:any)=>{database.close();e?reject(e):resolveClose();}))};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){ const port=Number(process.env.RECEIVER_PORT??process.env.PORT??8788); const host=process.env.RECEIVER_HOST??'127.0.0.1'; const dataDir=process.env.ZUNGUN_DATA_DIR??'.data'; const app=createReceiverServer({databasePath:process.env.RECEIVER_DB??join(dataDir,'receiver.sqlite'),keyPath:process.env.RECEIVER_KEY_FILE??join(dataDir,'receipt-key.json'),apiToken:process.env.RECEIVER_AUTH_TOKEN??process.env.ZUNGUN_API_TOKEN??'local-development-token-change-me',receiverId:process.env.ZUNGUN_RECEIVER_ID??'receiver_local_1'}); app.server.listen(port,host,()=>console.log(JSON.stringify({event:'receiver_started',port,production:false}))); }
