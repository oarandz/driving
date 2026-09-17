import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// Public login endpoint. Management actions require a verified instructor JWT.
// Service credentials remain in the Edge Function environment, never in the website.
Deno.serve(async (request) => {
 const origin=Deno.env.get('ALLOWED_ORIGIN')||'';
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(!origin||request.headers.get('origin')!==origin)return reply({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),options);
 try{
  const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large'},413);
  const body=JSON.parse(raw);
  if(body.action==='login'){
   const email=String(body.email||'').trim().toLowerCase();
   const code=String(body.code||'').replace(/[\s-]/g,'').toUpperCase();
   const invalid=()=>reply({error:'Email or access code is incorrect. Ask your instructor if you need a new code.'},401);
   if(!email||email.length>320||!/^[A-HJ-NP-Z2-9]{16}$/.test(code))return invalid();
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email));
   const key=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
   const allowance=await admin.rpc('allow_pupil_code_attempt',{p_key:key});
   if(allowance.error)throw allowance.error;
   if(!allowance.data)return reply({error:'Too many attempts. Wait 15 minutes before trying again.'},429);
   const {data:p,error}=await admin.from('pupils').select('id,user_id,access_issued_at').eq('email',email).maybeSingle();
   if(error)throw error;if(!p?.user_id||!p.access_issued_at)return invalid();
   const account=await admin.auth.admin.getUserById(p.user_id);
   if(account.error||account.data.user?.app_metadata?.pupil_id!==p.id||account.data.user?.app_metadata?.managed_pupil!==true)return invalid();
   const client=createClient(url,anon,options);
   const result=await client.auth.signInWithPassword({email:account.data.user.email,password:'Diary-'+code});
   if(result.error||!result.data.session)return invalid();
   // Recheck the mapping in case the instructor reset the code during sign-in.
   const current=await admin.from('pupils').select('user_id,email').eq('id',p.id).single();
   if(current.error||current.data.user_id!==p.user_id||current.data.email!==email)return invalid();
   return reply({session:{access_token:result.data.session.access_token,refresh_token:result.data.session.refresh_token}});
  }
  if(body.action!=='generate')return reply({error:'Unknown action'},400);
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const client=createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
  const identity=await client.auth.getUser(token);
  if(identity.error||!identity.data.user)return reply({error:'Sign in first'},401);
  const role=await client.rpc('is_instructor');
  if(role.error||role.data!==true)return reply({error:'Instructor access required'},403);
  if(typeof body.pupil_id!=='string'||! /^[a-f0-9-]{36}$/i.test(body.pupil_id))return reply({error:'Pupil not found'},400);
  const {data:p,error}=await admin.from('pupils').select('id,email,user_id').eq('id',body.pupil_id).single();
  if(error||!p)return reply({error:'Pupil not found'},404);
  if(p.user_id){const instructor=await admin.from('instructors').select('user_id').eq('user_id',p.user_id).maybeSingle();if(instructor.error)throw instructor.error;if(instructor.data)return reply({error:'Instructor accounts cannot be managed as pupils'},400);}
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code=[...crypto.getRandomValues(new Uint8Array(16))].map(n=>alphabet[n%32]).join('');
  const created=await admin.auth.admin.createUser({email:`pupil-${crypto.randomUUID()}@login.invalid`,password:'Diary-'+code,email_confirm:true,app_metadata:{managed_pupil:true,pupil_id:p.id}});
  if(created.error||!created.data.user)throw created.error||Error('Account creation failed');
  const newId=created.data.user.id;
  const activated=await admin.rpc('activate_pupil_code',{p_id:p.id,p_user_id:newId,p_expected_user:p.user_id,p_expected_email:p.email});
  if(activated.error){await admin.auth.admin.updateUserById(newId,{ban_duration:'876000h'});return reply({error:'Pupil details changed or code activation failed. Reopen their details and try again.'},409);}
  // The old identity immediately loses RLS access when the link changes.
  // Retire only accounts created by this function; never alter the instructor.
  if(p.user_id){const old=await admin.auth.admin.getUserById(p.user_id);if(old.data?.user?.app_metadata?.managed_pupil===true&&old.data.user.app_metadata.pupil_id===p.id)await admin.auth.admin.updateUserById(p.user_id,{ban_duration:'876000h'});}
  return reply({code:code.match(/.{4}/g).join('-'),email:p.email});
 }catch{return reply({error:'Could not complete the request. Please try again.'},500);}
});
