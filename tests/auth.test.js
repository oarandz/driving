import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped handlers with a minimal DOM and an isolated Auth service.
// No requests, emails, passwords or account changes reach the live project.
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const authSource=app.slice(app.indexOf('let recoveryPending='),app.indexOf('function renderPupils(){'))
 .replace("const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');",'const createClient=()=>db;');
function harness({session=null,role='admin',linked=true,hash='',responses={}}={}){
 const nodes=new Map(),calls=[],storage=new Map();
 let rendered=0,listener;
 const node=()=>({textContent:'',className:'',disabled:false,addEventListener(event,handler){this['on'+event]=handler;}});
 function mount(html){
  for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set('#'+match[1],node());
  for(const match of html.matchAll(/<form id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)){
   const form=nodes.get('#'+match[1]);form.elements={};
   for(const input of match[2].matchAll(/<input\b([^>]+)>/g)){
    const name=/name="([^"]+)"/.exec(input[1])?.[1];
    if(name)form.elements[name]={value:/value="([^"]*)"/.exec(input[1])?.[1]||''};
   }
   form.button=node();form.result=node();form.reportValidity=()=>true;
   form.querySelector=selector=>selector.startsWith('button')?form.button:form.result;
  }
 }
 const root=node();Object.defineProperty(root,'innerHTML',{set(html){this.html=html;mount(html);},get(){return this.html;}});nodes.set('#app',root);
 const api={};
 for(const method of ['signInWithPassword','signUp','resetPasswordForEmail','updateUser','signOut'])api[method]=async(...args)=>{
  calls.push({method,args});if(responses[method])return typeof responses[method]==='function'?responses[method](...args):responses[method];
  return {data:{session:method==='signUp'?null:session},error:null};
 };
 api.getSession=async()=>({data:{session},error:null});
 api.getUser=async()=>({data:{user:session?.user||null},error:null});
 api.onAuthStateChange=fn=>{listener=fn;};
 const state={demo:false,pupils:linked?[{id:'p1'}]:[]};
 const context=vm.createContext({db:{auth:api},config:{supabaseUrl:'https://example.supabase.co'},state,
  URLSearchParams,location:{hash,origin:'https://example.github.io',pathname:'/driving/',search:'',reload(){calls.push({method:'reload'});}},
  history:{replaceState(...args){calls.push({method:'replaceState',args});}},
  sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
  $:selector=>nodes.get(selector),h:value=>String(value),
  rpc:async name=>{calls.push({method:name});return name==='is_instructor'?role==='admin':null;},reloadData:async()=>{},
  render:()=>rendered++,registerTools:()=>{},toast:message=>calls.push({method:'toast',message}),
  trackingLesson:null,pointQueue:[],safely:action=>action(),dialog:(_title,html)=>mount(html)});
 vm.runInContext(authSource,context);
 return {context,nodes,calls,state,storage,rendered:()=>rendered,event:event=>listener(event),
  async submit(selector,fields){const form=nodes.get(selector);for(const [k,v] of Object.entries(fields))form.elements[k].value=v;await form.onsubmit({preventDefault(){}});return form;}};
}
const credentials={email:'person@example.com',password:'test-only-password'};
test('password sign-in opens the existing instructor role without sending email',async()=>{
 const h=harness();h.context.authScreen('','signin');await h.submit('#sign-in',credentials);
 assert.equal(h.calls[0].method,'signInWithPassword');assert.equal(h.calls[0].args[0].email,credentials.email);
 assert.equal(h.state.role,'admin');assert.equal(h.rendered(),1);
 assert.equal(h.calls.some(c=>/signUp|resetPassword|Otp/.test(c.method)),false);
});
test('pupil sign-in retains pupil role and unlinked accounts cannot open the diary',async()=>{
 for(const linked of [true,false]){const h=harness({role:'pupil',linked});h.context.authScreen('','signin');await h.submit('#sign-in',credentials);
 assert.equal(h.state.role,'pupil');assert.equal(h.rendered(),linked?1:0);
 if(linked)assert.equal(h.state.pupilId,'p1');else assert.match(h.nodes.get('#app').html,/not linked/);}
});
test('invalid credentials stay on sign-in with an inline error and permit retry',async()=>{
 const h=harness({responses:{signInWithPassword:{error:{code:'invalid_credentials'}}}});h.context.authScreen('','signin');const form=await h.submit('#sign-in',credentials);
 assert.match(form.result.textContent,/Email or password is incorrect/);assert.equal(form.button.disabled,false);assert.equal(h.rendered(),0);
});
test('pupil sign-in uses the instructor code and never sends confirmation emails',async()=>{
 const h=harness({role:'pupil'});h.context.db.functions={invoke:async(name,args)=>{h.calls.push({method:name,args});return {data:{session:{access_token:'test-access',refresh_token:'test-refresh'}},error:null};}};
 h.context.db.auth.setSession=async session=>{h.calls.push({method:'setSession',session});return {error:null};};
 h.context.authScreen();assert.match(h.nodes.get('#app').html,/Access code/);assert.doesNotMatch(h.nodes.get('#app').html,/Create pupil account/);
 const form=await h.submit('#sign-in',{email:credentials.email,code:'abcd-efgh-jklm-npqr'});
 assert.equal(h.calls[0].method,'pupil-access');assert.equal(h.calls[0].args.body.code,'ABCDEFGHJKLMNPQR');assert.equal(h.calls[1].method,'setSession');assert.equal(h.rendered(),1);assert.equal(form.elements.code.value,'');
 assert.equal(h.calls.some(c=>['signUp','resetPasswordForEmail','signInWithPassword'].includes(c.method)),false);
});
test('short pupil codes are rejected before a network request',async()=>{
 const h=harness();h.context.authScreen();const form=await h.submit('#sign-in',{email:credentials.email,code:'1234'});
 assert.match(form.result.textContent,/full access code/);assert.equal(h.calls.length,0);
});
test('pupils cannot change their code through the instructor password screen',async()=>{
 const h=harness({role:'pupil',session:{user:{email:credentials.email}}});await h.context.passwordScreen(false);
 assert.equal(h.calls.some(c=>c.method==='updateUser'),false);assert.equal(h.rendered(),1);
});
test('password reset keeps the repository path and explains email rate limits',async()=>{
 const h=harness({responses:{resetPasswordForEmail:{error:{status:429}}}});h.context.authScreen('','reset');const form=await h.submit('#sign-in',{email:credentials.email});
 assert.equal(h.calls[0].args[1].redirectTo,'https://example.github.io/driving/');assert.match(form.result.textContent,/Wait before trying again/);assert.equal(form.button.disabled,false);
});
test('existing signed-in account can set a password without sending an email',async()=>{
 const h=harness({session:{user:{email:credentials.email}}});await h.context.passwordScreen(false);
 const form=await h.submit('#set-password',{password:credentials.password,confirm_password:credentials.password});
 const update=h.calls.find(c=>c.method==='updateUser');assert.equal(update.args[0].password,credentials.password);
 assert.match(form.result.textContent,/Password saved/);assert.equal(form.elements.password.value,'');assert.equal(h.rendered(),0);
});
test('recovery callback opens password entry before the diary, survives reload, clears on save',async()=>{
 const h=harness({session:{user:{email:credentials.email}},hash:'#type=recovery&access_token=synthetic'});await h.context.init();
 assert.match(h.nodes.get('#app').html,/Set password/);assert.equal(h.rendered(),0);assert.equal(h.storage.size,1);
 h.context.location.hash='';await h.context.init();assert.equal(h.rendered(),0);
 await h.submit('#set-password',{password:credentials.password,confirm_password:credentials.password});
 assert.equal(h.storage.size,0);assert.equal(h.rendered(),1);
});
test('expired callback is cleared and recovery cannot proceed without a session',async()=>{
 const h=harness({hash:'#error=access_denied&error_code=otp_expired'});await h.context.init();
 assert.match(h.nodes.get('#app').html,/expired or has already been used/);assert.equal(h.calls[0].method,'replaceState');
 await h.context.passwordScreen(true);assert.match(h.nodes.get('#app').html,/Sign in or request/);assert.equal(h.calls.some(c=>c.method==='updateUser'),false);
});
test('duplicate submit is blocked while a password request is pending',async()=>{
 let resolve;const h=harness({responses:{signInWithPassword:()=>new Promise(r=>{resolve=r;})}});h.context.authScreen('','signin');
 const first=h.submit('#sign-in',credentials);await h.submit('#sign-in',credentials);assert.equal(h.calls.length,1);
 resolve({error:{code:'invalid_credentials'}});await first;
});
test('failed password save keeps recovery active and displays the server error',async()=>{
 const h=harness({session:{user:{email:credentials.email}},hash:'#type=recovery',responses:{updateUser:{error:{message:'Please sign in again before changing your password.'}}}});await h.context.init();
 const form=await h.submit('#set-password',{password:credentials.password,confirm_password:credentials.password});
 assert.match(form.result.textContent,/sign in again/);assert.equal(h.storage.size,1);assert.equal(h.rendered(),0);assert.equal(form.button.disabled,false);
});
test('ordinary signed-in startup opens the diary without asking for a new password',async()=>{
 const h=harness({session:{user:{email:credentials.email}}});await h.context.init();assert.equal(h.rendered(),1);assert.equal(h.storage.size,0);
});
