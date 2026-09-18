import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {detailedSkillGroups} from '../core.js';
const source=readFileSync(new URL('../supabase/functions/suggest-skills/index.ts',import.meta.url),'utf8').replace(/^import .*\n/m,'');
const lesson='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',summary='Needed reminders to check mirrors before slowing down.';
const valid={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({suggestions:[{skill_id:'9.6',reason:'Mirror checks before slowing needed reminders.'}]})}]}]};
function harness({role=true,token=true,key='private-test-key',allowance=true,lessonError=false,result=valid,http=200,failFetch=false}={}){
 let handler;const calls=[],client={auth:{getUser:async()=>({data:{user:token?{id:'instructor'}:null}})},rpc:async(name,args)=>{calls.push({name,args});return name==='is_instructor'?{data:role}:lessonError?{error:{}}:{data:allowance};}};
 const context=vm.createContext({Deno:{env:{get:k=>({ALLOWED_ORIGIN:'https://example.github.io',OPENAI_API_KEY:key,SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public'})[k]},serve:fn=>handler=fn},createClient:()=>client,Response,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});if(failFetch)throw Object.assign(new Error('test'),{name:'TimeoutError'});return new Response(JSON.stringify(result),{status:http});}});
 vm.runInContext(source,context);
 return {calls,context,request:(body={lesson_id:lesson,summary},origin='https://example.github.io',authorization='Bearer test')=>handler(new Request('https://test/functions/v1/suggest-skills',{method:'POST',headers:{origin,authorization},body:JSON.stringify(body)}))};
}
test('AI server catalog exactly matches all 664 detailed skills',()=>{
 const h=harness();assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(catalog)',h.context)),detailedSkillGroups);
});
test('AI suggestions require allowed origin, instructor JWT, configured key and request allowance',async()=>{
 for(const [settings,status] of [[{role:false},403],[{token:false},401],[{key:''},503],[{allowance:false},429],[{lessonError:true},400]]){
  const h=harness(settings),r=await h.request();assert.equal(r.status,status);assert.equal(h.calls.some(c=>c.url),false);
 }
 for(const [origin,auth] of [['https://evil.example','Bearer test'],['https://example.github.io','']]){const h=harness();assert.ok((await h.request(undefined,origin,auth)).status>=400);assert.equal(h.calls.length,0);}
});
test('AI uses Responses structured output, no storage, bounded input and no grade writes',async()=>{
 const h=harness(),r=await h.request();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).suggestions[0].skill_id,'9.6');
 const request=h.calls.find(c=>c.url),body=JSON.parse(request.options.body);
 assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.model,'gpt-4.1-mini-2025-04-14');assert.equal(body.input[0].content,summary);
 assert.deepEqual(h.calls.filter(c=>c.name).map(c=>c.name),['is_instructor','reserve_skill_suggestion']);assert.doesNotMatch(request.options.body,/aaaaaaaa-aaaa|private-test-key/);
 for(const text of ['', 'short','a'.repeat(6001)]){const other=harness();assert.equal((await other.request({lesson_id:lesson,summary:text})).status,400);assert.equal(other.calls.some(c=>c.url),false);}
});
test('AI rejects hallucinated IDs, duplicates, invalid output, refusal and incomplete responses',async()=>{
 for(const suggestions of [[{skill_id:'99.1',reason:'Bad'}],[{skill_id:'1.17',reason:'Bad'}],[{skill_id:'9.6',reason:'x'},{skill_id:'9.6',reason:'x'}],[{skill_id:'9.6',reason:3}],null]){
  const result={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({suggestions})}]}]},h=harness({result});assert.equal((await h.request()).status,502);
 }
 assert.equal((await harness({result:{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}}).request()).status,422);
 assert.equal((await harness({result:{...valid,status:'incomplete'}}).request()).status,502);
 const h=harness({result:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"suggestions":[]}'}]}]}});assert.deepEqual(await (await h.request()).json(),{suggestions:[]});
});
test('AI returns useful upstream failure messages without exposing secrets',async()=>{
 for(const [settings,pattern] of [[{http:401},/API key/],[{http:429},/billing limit/],[{http:500},/unavailable/],[{failFetch:true},/timed out/]]){
  const r=await harness(settings).request(),text=await r.text();assert.ok(r.status>=400);assert.match(text,pattern);assert.doesNotMatch(text,/private-test-key/);
 }
});
