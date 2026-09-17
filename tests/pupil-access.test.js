import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../supabase/functions/pupil-access/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,'');
const pupilId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function harness({role=true,validToken=true,allowed=true,wrongCode=false,stale=false,activationError=false}={}){
 let handler;const calls=[];let id='old-user';
 const pupil={id:pupilId,email:'pupil@example.com',user_id:id,access_issued_at:'2026-09-17T09:00Z'};
 const authAdmin={
  getUserById:async uid=>({data:{user:{id:uid,email:uid+'@login.invalid',app_metadata:{managed_pupil:true,pupil_id:pupilId}}}}),
  createUser:async args=>{calls.push({action:'create',args});return {data:{user:{id:'new-user'}}};},
  updateUserById:async(...args)=>{calls.push({action:'ban',args});return {error:null};}
 };
 const admin={auth:{admin:authAdmin},rpc:async(name,args)=>{calls.push({action:name,args});if(name==='allow_pupil_code_attempt')return {data:allowed};if(activationError)return {error:{message:'stale'}};id='new-user';return {data:null};},from:table=>{
  let fields;const q={select:f=>{fields=f;return q;},eq:()=>q,maybeSingle:async()=>({data:table==='instructors'?null:pupil}),single:async()=>({data:fields==='user_id,email'?{user_id:stale?'replaced':id,email:pupil.email}:pupil})};return q;
 }};
 const client={auth:{getUser:async()=>validToken?{data:{user:{id:'instructor'}}}:{data:{user:null},error:{}},signInWithPassword:async args=>{calls.push({action:'login',args});return wrongCode?{error:{}}:{data:{session:{access_token:'test-access',refresh_token:'test-refresh'}}};}},rpc:async()=>({data:role})};
 vm.runInNewContext(source,{Deno:{env:{get:k=>({ALLOWED_ORIGIN:'https://example.github.io',SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[k]},serve:fn=>handler=fn},createClient:(_url,key)=>key==='service'?admin:client,Response,crypto:webcrypto,TextEncoder,Uint8Array});
 return {calls,request:async(body,origin='https://example.github.io')=>handler(new Request('https://test/functions/v1/pupil-access',{method:'POST',headers:{origin,authorization:'Bearer test'},body:JSON.stringify(body)}))};
}
test('code generation requires a verified instructor and does not modify accounts on denial',async()=>{
 for(const settings of [{role:false},{validToken:false}]){const h=harness(settings),r=await h.request({action:'generate',pupil_id:pupilId});assert.ok([401,403].includes(r.status));assert.equal(h.calls.length,0);}
});
test('code generation creates a random 80-bit credential and activates before retiring old login',async()=>{
 const h=harness(),r=await h.request({action:'generate',pupil_id:pupilId}),data=await r.json();
 assert.equal(r.status,200);assert.match(data.code,/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
 assert.equal(h.calls[0].action,'create');assert.equal(h.calls[0].args.password,'Diary-'+data.code.replaceAll('-',''));
 assert.equal(h.calls[1].action,'activate_pupil_code');assert.equal(h.calls[2].action,'ban');assert.equal(h.calls[2].args[0],'old-user');
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('failed activation retires only the new unused identity and never returns a code',async()=>{
 const h=harness({activationError:true}),r=await h.request({action:'generate',pupil_id:pupilId});assert.equal(r.status,409);assert.equal((await r.json()).code,undefined);assert.equal(h.calls.at(-1).args[0],'new-user');
});
test('pupil code login normalizes input and returns a session without exposing service credentials',async()=>{
 const h=harness(),r=await h.request({action:'login',email:' PUPIL@example.com ',code:'abcd-efgh-jklm-npqr'});assert.equal(r.status,200);
 assert.equal(h.calls.find(c=>c.action==='login').args.password,'Diary-ABCDEFGHJKLMNPQR');
 assert.deepEqual(await r.json(),{session:{access_token:'test-access',refresh_token:'test-refresh'}});
});
test('wrong code, stale mappings, attempt limit and disallowed origins fail closed',async()=>{
 for(const [settings,status] of [[{wrongCode:true},401],[{stale:true},401],[{allowed:false},429]]){
  const h=harness(settings),r=await h.request({action:'login',email:'pupil@example.com',code:'ABCDEFGHJKLMNPQR'});assert.equal(r.status,status);assert.equal((await r.json()).session,undefined);
  if(!settings.allowed&&settings.allowed!==undefined)assert.equal(h.calls.some(c=>c.action==='login'),false);
 }
 const h=harness();assert.equal((await h.request({action:'generate',pupil_id:pupilId},'https://wrong.example')).status,403);assert.equal(h.calls.length,0);
});
