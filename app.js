import {config} from './config.js';
import {localDate,addDays,weekStart,minutes,lessonTotals,lessonMiles,routeMiles,previousAims,validateBooking,splitTrack,extractGpxPoints,youtubeVideoId,skillLevels,drivingSkillGroups,escapeHtml as h} from './core.js';

const today=new Date();
const people=[{id:'p1',name:'Alex Morgan',email:'alex@example.com',colour:'#dcf2d0'},{id:'p2',name:'Jamie Taylor',email:'jamie@example.com',colour:'#dbeafa'},{id:'p3',name:'Sam Wilson',email:'sam@example.com',colour:'#f5e6ce'}];
const sampleLesson=(id,pupil,day,hour,duration)=>({id,pupil_id:pupil,starts_at:new Date(`${localDate(addDays(weekStart(today),day))}T${hour}:00:00`).toISOString(),ends_at:new Date(new Date(`${localDate(addDays(weekStart(today),day))}T${hour}:00:00`).getTime()+duration*3600000).toISOString(),status:'scheduled',paid:id==='l1',fee:80,pickup:{label:'Station car park',lat:51.4545,lng:-2.5879},dropoff:{label:'Station car park',lat:51.4545,lng:-2.5879},objectives:'Build confidence at roundabouts',improved:'',needs_work:'',other:'',next_aims:'',travel_before_minutes:20,travel_source:'manual'});
const state={demo:!config.supabaseUrl,role:'admin',view:'diary',week:weekStart(today),pupils:people,lessons:[sampleLesson('l1','p1',1,'09',2),sampleLesson('l2','p2',1,'12',1.5),sampleLesson('l3','p3',2,'10',2),sampleLesson('l4','p1',3,'14',2),sampleLesson('l5','p2',4,'09',2)],resources:[],links:[],videos:[],skills:[],activity:[],points:[],selected:null,busy:false,pupilPreview:null};
const samplePast={...sampleLesson('l0','p1',-5,'09',1.5),status:'completed',start_mileage:12400,end_mileage:12418.4,paid:true,objectives:'Junction approach and observation',improved:'Earlier mirror checks before slowing down.',needs_work:'Consistent approach speed at closed junctions.',other:'',next_aims:'Practise meeting traffic on narrow roads'};
samplePast.started_at=samplePast.starts_at;samplePast.ended_at=samplePast.ends_at;state.lessons.push(samplePast);
const sampleCoordinates=[[51.45451,-2.58793],[51.4549,-2.5875],[51.4554,-2.5869],[51.4559,-2.5862],[51.4564,-2.5855],[51.4568,-2.5848],[51.4565,-2.5841],[51.4561,-2.5835],[51.4556,-2.5828],[51.4551,-2.5822]];
state.points=sampleCoordinates.map(([lat,lng],i)=>({id:`sample-${i}`,lesson_id:'l0',lat,lng,accuracy:5,recorded_at:new Date(new Date(samplePast.started_at).getTime()+i*20000).toISOString()}));
let db=null,map=null,watchId=null,wakeLock=null,trackingLesson=null,trackingMessage='',pointQueue=[],syncTimer=null;
const $=selector=>document.querySelector(selector);
const pupil=id=>state.pupils.find(p=>p.id===id);
const dateLabel=(d,opts={day:'numeric',month:'short'})=>new Date(d).toLocaleDateString('en-GB',opts);
const clock=d=>new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:config.currency}).format(n||0);
const icon=name=>({diary:'▦',pupils:'◉',resources:'▤',progress:'↗'}[name]||'•');
function toast(message,error=false){ $('#toast').textContent=message;$('#toast').className=error?'show error':'show';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').className='',6500); }
function shell(){
 $('#app').innerHTML=`<aside class="sidebar">${config.name?`<span class="brand">${h(config.name)}</span>`:''}<div class="workspace-label">${state.role==='admin'?'INSTRUCTOR WORKSPACE':'PUPIL ACCOUNT'}</div><nav>${(state.role==='admin'?['diary','pupils','resources']:['diary','progress']).map(v=>`<button class="nav-item ${(state.view===v||v==='progress'&&state.view==='skills')?'selected':''}" data-view="${v}"><span>${icon(v)}</span>${v==='diary'?(state.role==='admin'?'Lesson diary':'My lessons'):v==='resources'?'Teaching library':v==='progress'?'My progress':'Pupils'}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="avatar">${state.role==='admin'?'IN':'AL'}</div><div><strong>${state.role==='admin'?'Instructor':'Pupil account'}</strong><small>${state.demo?'Sample workspace':'Private workspace'}</small></div></div></aside><main><div class="topbar"><span>${dateLabel(today,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</span><div>${state.demo&&!state.pupilPreview?'<span class="demo-pill">PREVIEW · SAMPLE DATA</span> <button class="text-button" id="switch-role">View as '+(state.role==='admin'?'pupil':'instructor')+'</button>':`${state.role==='admin'?'<button class="text-button" id="account-password">Password</button> ':''}<button class="text-button" id="logout">Sign out</button>`}</div></div>${state.pupilPreview?`<div class="pupil-preview-bar" role="status"><span>Viewing as <strong>${h(pupil(state.pupilId)?.name)}</strong></span><button id="exit-pupil-preview">Back to instructor view</button></div>`:''}<div id="content"></div></main>`;
 if(pointQueue.length){const pending=document.createElement('div');pending.className='notice warning';pending.innerHTML=`${pointQueue.length} route points are waiting to save. <button id="retry-sync">Retry saving</button>`;$('#content').before(pending);$('#retry-sync').onclick=()=>safely(async()=>{await flushPoints();render();toast('Route points saved.');});}
 $('#exit-pupil-preview')?.addEventListener('click',exitPupilPreview);
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();});
 $('#switch-role')?.addEventListener('click',()=>{state.role=state.role==='admin'?'pupil':'admin';state.view='diary';render();});
 $('#logout')?.addEventListener('click',signOut);
 $('#account-password')?.addEventListener('click',()=>safely(()=>passwordScreen(false)));
}
function previewPupil(id){
 if(state.role!=='admin'||!pupil(id))return;
 state.pupilPreview={view:state.view,progressPupil:state.progressPupil,pupilId:state.pupilId};
 $('#modal')?.close();state.role='pupil';state.pupilId=id;state.view='diary';state.selected=null;render();
}
function exitPupilPreview(){
 if(!state.pupilPreview)return;
 const previous=state.pupilPreview;$('#modal')?.close();state.pupilPreview=null;state.role='admin';state.view=previous.view;state.progressPupil=previous.progressPupil;state.pupilId=previous.pupilId;state.selected=null;render();
}
function visibleLessons(){return state.role==='admin'?state.lessons:state.lessons.filter(l=>l.pupil_id===(state.pupilId||'p1'));}
let progressMapRequest=0;
function render(){void trackPupilActivity();progressMapRequest++;if(map){map.remove();map=null;}shell();if(state.view==='diary')renderDiary();else if(state.view==='pupils')renderPupils();else if(state.view==='resources')renderResources();else if(state.view==='skills')renderSkills();else renderProgress(state.role==='admin'?state.progressPupil:(state.pupilId||'p1'));}
function renderDiary(){
 if(state.role==='pupil'){renderPupilLessons();return;}
 const lessons=visibleLessons().filter(l=>l.status!=='cancelled');
 const weekLessons=lessons.filter(l=>new Date(l.ends_at)>state.week&&new Date(l.starts_at)<addDays(state.week,7));
 const hours=weekLessons.reduce((n,l)=>n+minutes(l.starts_at,l.ends_at)/60,0);
 $('#content').innerHTML=`<div class="heading"><div><h1>Lesson diary</h1></div>${state.role==='admin'?'<button class="primary" id="book">＋ Book a lesson</button>':''}</div><div class="stats"><div><span>Lessons this week</span><strong>${weekLessons.length}<small>booked</small></strong></div><div><span>Driving time</span><strong>${hours.toFixed(1)}<small>hours planned</small></strong></div><div><span>${state.role==='admin'?'Awaiting payment':'Lesson payments'}</span><strong>${money(weekLessons.filter(l=>!l.paid).reduce((n,l)=>n+Number(l.fee),0))}<small>outstanding this week</small></strong></div></div><section class="diary-panel"><div class="calendar-toolbar"><div><h2>${dateLabel(state.week)} – ${dateLabel(addDays(state.week,6),{day:'numeric',month:'short',year:'numeric'})}</h2><span class="muted">${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ')}</span></div><div class="calendar-actions"><button id="previous" aria-label="Previous week">‹</button><button id="today">Today</button><button id="next" aria-label="Next week">›</button></div></div><div class="calendar-scroll"><div class="calendar"><div class="time-head"></div>${Array.from({length:7},(_,i)=>{const d=addDays(state.week,i);return `<div class="day-head ${localDate(d)===localDate(today)?'is-today':''}"><span>${dateLabel(d,{weekday:'short'})}</span><strong>${d.getDate()}</strong></div>`;}).join('')}<div class="time-column">${Array.from({length:24},(_,i)=>`<span style="top:${i*72}px">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${Array.from({length:7},(_,i)=>`<div class="day-column">${weekLessons.filter(l=>new Date(l.starts_at)<addDays(state.week,i+1)&&new Date(l.ends_at)>addDays(state.week,i)).map(l=>lessonCard(l,addDays(state.week,i))).join('')}</div>`).join('')}</div></div><footer class="calendar-legend"><span><i class="legend lesson"></i>Scheduled lesson</span><span><i class="legend travel"></i>Travel time</span><span>✓ Paid</span></footer></section>${state.demo?'<p class="preview-note">This preview uses fictional pupils. Changes last until you reload. Connect Supabase before entering real pupil information.</p>':''}`;
 $('#previous').onclick=()=>{state.week=addDays(state.week,-7);render();};$('#next').onclick=()=>{state.week=addDays(state.week,7);render();};$('#today').onclick=()=>{state.week=weekStart(today);render();};$('#book')?.addEventListener('click',()=>bookLesson());
 document.querySelectorAll('[data-lesson]').forEach(b=>b.onclick=()=>openLesson(b.dataset.lesson));
 const earliest=Math.min(8,...weekLessons.map(l=>new Date(l.starts_at).getHours()));$('.calendar-scroll').scrollTop=Math.max(0,earliest-1)*72;if(matchMedia('(max-width:750px)').matches&&today>=state.week&&today<addDays(state.week,7))$('.calendar-scroll').scrollLeft=((today.getDay()+6)%7)*150;
}
function renderPupilLessons(){
 const now=new Date(),lessons=visibleLessons();
 const active=lessons.filter(l=>l.status==='active');
 const next=lessons.filter(l=>l.status==='scheduled'&&new Date(l.ends_at)>now).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0];
 const previous=lessons.filter(l=>l.status==='completed'||l.status==='scheduled'&&new Date(l.ends_at)<=now||l.status==='cancelled'&&new Date(l.starts_at)<=now).sort((a,b)=>new Date(b.started_at||b.starts_at)-new Date(a.started_at||a.starts_at));
 $('#content').innerHTML=`<div class="heading"><h1>My lessons</h1></div><p class="help">Your instructor can see your account visits and last activity.</p><div class="pupil-lessons">${active.length?`<section aria-labelledby="current-lesson-title"><h2 id="current-lesson-title">Lesson in progress</h2><div class="list">${active.map(l=>pupilLessonRow(l)).join('')}</div></section>`:''}<section aria-labelledby="next-lesson-title"><h2 id="next-lesson-title">Next lesson</h2>${next?pupilLessonRow(next,true):'<div class="empty">No next lesson booked.</div>'}</section><section aria-labelledby="previous-lessons-title"><h2 id="previous-lessons-title">Previous lessons</h2><div class="list">${previous.map(l=>pupilLessonRow(l)).join('')||'<div class="empty">No previous lessons.</div>'}</div></section></div>`;
 document.querySelectorAll('[data-lesson]').forEach(b=>b.onclick=()=>openLesson(b.dataset.lesson));
}
function pupilLessonRow(l,upcoming=false){
 const start=l.status==='completed'?(l.started_at||l.starts_at):l.starts_at,end=l.status==='completed'?(l.ended_at||l.ends_at):l.ends_at;
 const date=dateLabel(start,{weekday:'long',day:'numeric',month:'long',year:'numeric'}),endDay=localDate(start)!==localDate(end)?`${dateLabel(end)} `:'';
 const status=l.status==='completed'?'Completed':l.status==='cancelled'?'Cancelled':l.status==='active'?'In progress':upcoming?'Booked':'Not marked completed';
 return `<button class="list-button pupil-lesson-row ${upcoming?'next-lesson-card':''}" data-lesson="${h(l.id)}"><span class="pupil-lesson-info"><strong>${h(date)}</strong><span>${clock(start)} – ${h(endDay)}${clock(end)}</span>${upcoming&&l.pickup?.label?`<span class="pupil-lesson-pickup">Pickup: ${h(l.pickup.label)}</span>`:''}<span class="pupil-lesson-meta">${status} · ${l.paid?'Paid':'Unpaid'}</span></span><span class="pupil-lesson-open">${upcoming?'View lesson':'View notes & resources'} <span aria-hidden="true">→</span></span></button>`;
}
function lessonCard(l,day){const start=Math.max(new Date(l.starts_at),day),end=Math.min(new Date(l.ends_at),addDays(day,1)),top=minutes(day,start)*1.2,height=minutes(start,end)*1.2,p=pupil(l.pupil_id);return `${l.travel_before_minutes&&localDate(l.starts_at)===localDate(day)?`<div class="travel-block" style="top:${top-l.travel_before_minutes*1.2}px;height:${l.travel_before_minutes*1.2}px"><span>${l.travel_before_minutes} min travel${l.travel_source==='manual'?' · allowance':l.travel_source==='review'?' · recheck':''}</span></div>`:''}<button class="lesson-card" data-lesson="${l.id}" style="top:${top}px;height:${height}px;--lesson-colour:${p?.colour||'#dceefa'}"><span class="lesson-time">${clock(l.starts_at)} – ${clock(l.ends_at)} <b>${l.paid?'✓':''}</b></span><strong>${h(p?.name||'Pupil')}</strong><span class="lesson-topic">${h(l.objectives||'Objectives to be added')}</span><span class="lesson-place">⌖ ${h(l.pickup.label)}</span>${l.status==='active'?'<span class="live-label">LESSON IN PROGRESS</span>':''}</button>`;}
function dialog(title,body){if(map){map.remove();map=null;}const el=$('#modal');el.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${h(title)}</h2><button type="button" id="close-dialog" aria-label="Close">✕</button></div><div class="dialog-body">${body}</div>`;$('#close-dialog').onclick=()=>el.close();if(!el.open)el.showModal();el.onclose=()=>{if(map){map.remove();map=null;}if(state.view==='progress')renderProgress(state.role==='admin'?state.progressPupil:(state.pupilId||'p1'));};}
async function safely(action){if(state.busy)return;state.busy=true;const buttons=[...document.querySelectorAll('dialog button[type=submit]:not(:disabled)')];buttons.forEach(b=>b.disabled=true);try{await action();}catch(e){toast(e.message||'Something went wrong. Please try again.',true);}finally{state.busy=false;buttons.forEach(b=>b.disabled=false);}}
async function allRows(table){let result=[],page=0;while(true){const {data,error}=await db.from(table).select('*').order('id').range(page*1000,page*1000+999);if(error)throw error;result.push(...data);if(data.length<1000)return result;page++;}}
async function reloadData(){if(state.demo)return;const [pupils,lessons,resources,links,videos,skills,activity]=await Promise.all(['pupils','lessons','resources','lesson_resources','lesson_videos','pupil_skill_ratings','pupil_activity'].map(allRows));Object.assign(state,{pupils,lessons,resources,links,videos,skills,activity});}
async function rpc(name,args){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
let activityRequestPending=false,activityAttemptAt=0;
async function trackPupilActivity(){
 if(state.demo||state.role!=='pupil'||state.pupilPreview||!state.pupilId||document.hidden||activityRequestPending||Date.now()-activityAttemptAt<30000)return;
 activityAttemptAt=Date.now();activityRequestPending=true;
 try{await rpc('record_pupil_activity',{});}catch{ /* Activity must never block pupil access; retry on later interaction. */ }
 finally{activityRequestPending=false;}
}
for(const event of ['pointerdown','keydown','scroll','visibilitychange'])document.addEventListener(event,()=>{void trackPupilActivity();},{passive:true,capture:true});
const activityDate=value=>value?`${dateLabel(value,{day:'numeric',month:'short',year:'numeric'})} at ${clock(value)}`:'Not recorded';
function activitySummary(id){
 if(state.role!=='admin')return '';
 const a=(state.activity||[]).find(x=>x.pupil_id===id);
 return `<div class="pupil-activity"><h3>Account activity</h3>${a?`<dl><div><dt>Sign-ins recorded</dt><dd>${Number(a.sign_in_count)}</dd></div><div><dt>Visits</dt><dd>${Number(a.visit_count)}</dd></div><div><dt>Last active</dt><dd>${h(activityDate(a.last_seen_at))}</dd></div></dl><p class="help">Tracked since ${h(activityDate(a.first_seen_at))}. A new visit starts after 30 minutes away or a new sign-in. Last active records page opens and interaction.</p>`:'<p class="help">No activity recorded yet. Tracking starts when the pupil uses the updated website.</p>'}</div>`;
}
function bindSkillButtons(){document.querySelectorAll('[data-skills]').forEach(b=>b.onclick=()=>safely(async()=>{await reloadData();state.progressPupil=b.dataset.skills;state.view='skills';render();}));}
function renderSkills(){
 const id=state.role==='admin'?state.progressPupil:(state.pupilId||'p1'),p=pupil(id);if(!p)return;
 const admin=state.role==='admin';let skillId=0;
 $('#content').innerHTML=`<div class="heading"><div><h1>Driving skills</h1>${admin?`<p>${h(p.name)}</p>`:''}</div><button id="back-from-skills">${admin?'Back to pupil':'Back to my progress'}</button></div><p class="help">27 DVSA skills · Instructor rating scale 0–4</p><div class="skill-scale">${skillLevels.map((label,i)=>`<span><b>${i}</b> ${h(label)}</span>`).join('')}</div><div class="skill-groups">${drivingSkillGroups.map(group=>`<section class="panel skill-group"><h2>${h(group.name)}</h2>${group.skills.map(name=>{const n=++skillId,r=(state.skills||[]).find(x=>x.pupil_id===id&&x.skill_id===n),rating=r?.rating??0;return `<div class="skill-row"><div><label id="skill-label-${n}" for="skill-${n}">${n}. ${h(name)}</label><p class="help" id="skill-status-${n}" role="status">${r?'Updated '+h(activityDate(r.updated_at)):''}</p></div>${admin?`<select id="skill-${n}" data-skill="${n}" aria-labelledby="skill-label-${n}">${skillLevels.map((label,i)=>`<option value="${i}" ${i===rating?'selected':''}>${i} — ${h(label)}</option>`).join('')}</select>`:`<span class="skill-rating rating-${rating}">${rating} — ${h(skillLevels[rating])}</span>`}</div>`;}).join('')}</section>`).join('')}</div><p class="help skill-source">Skill names: <a href="https://readytopass.campaign.gov.uk/driving-skills/" target="_blank" rel="noopener noreferrer">DVSA</a>, Crown copyright, <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">Open Government Licence v3.0</a>. Ratings use your instructor’s scale.</p>`;
 $('#back-from-skills').onclick=()=>{state.view='progress';render();};
 if(admin)document.querySelectorAll('[data-skill]').forEach(select=>select.onchange=async()=>{
  const n=Number(select.dataset.skill),old=(state.skills||[]).find(x=>x.pupil_id===id&&x.skill_id===n),expected=old?.rating??0,rating=Number(select.value),status=$('#skill-status-'+n);
  if(state.role!=='admin'){select.value=String(expected);return;}
  select.disabled=true;status.textContent='Saving…';
  try{
   const result=state.demo?{id:old?.id||crypto.randomUUID(),pupil_id:id,skill_id:n,rating,updated_at:new Date().toISOString()}:await rpc('set_pupil_skill',{p_pupil_id:id,p_skill_id:n,p_rating:rating,p_expected:expected});
   const saved=Array.isArray(result)?result[0]:result;
   state.skills=state.skills.filter(x=>!(x.pupil_id===id&&x.skill_id===n));state.skills.push(saved);status.textContent='Saved · '+activityDate(saved.updated_at);
  }catch(e){select.value=String(expected);status.textContent='Not saved: '+(e.message||'Please try again.');}
  finally{select.disabled=false;}
 });
}
let recoveryPending=false;
const recoveryKey=`diary-password-recovery:${config.supabaseUrl}`;
function rememberRecovery(value){
 recoveryPending=value;
 try{if(value)sessionStorage.setItem(recoveryKey,'1');else sessionStorage.removeItem(recoveryKey);}catch{}
}
function authError(error){
 if(error?.code==='invalid_credentials')return 'Email or password is incorrect.';
 if(error?.code==='email_not_confirmed')return 'Confirm your email before signing in. Open the confirmation email sent when you created your account.';
 if(error?.status===429||/rate limit/i.test(error?.message||''))return 'Too many attempts or emails. Wait before trying again. Email limits also apply to password reset and account confirmation.';
 if(error?.code==='otp_expired')return 'This email link has expired or has already been used. Request a new password reset link.';
 return error?.message||'Could not complete the request. Please try again.';
}
async function init(){
 if(state.demo){render();registerTools();return;}
 $('#app').innerHTML='<div class="loading">Loading…</div>';
 const fragment=new URLSearchParams(location.hash.slice(1));
 const linkError=fragment.has('error')?(fragment.get('error_code')==='otp_expired'?'This email link has expired or has already been used. Sign in with your password or request a new password reset link.':'This email link could not be used. Sign in or request a new password reset link.'):'';
 const recoveryLink=fragment.get('type')==='recovery';
 // Remove failed callback parameters; let Supabase consume successful callbacks.
 if(linkError){history.replaceState(null,'',location.pathname+location.search);rememberRecovery(false);}
 try{
  const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');
  db=createClient(config.supabaseUrl,config.supabasePublishableKey);
  // Keep this callback synchronous: Auth API calls inside it can deadlock.
  db.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')rememberRecovery(true);if(event==='SIGNED_OUT')rememberRecovery(false);});
  const {data:{session},error}=await db.auth.getSession();if(error)throw error;
  if(!session){rememberRecovery(false);authScreen(linkError);return;}
  try{recoveryPending=recoveryPending||sessionStorage.getItem(recoveryKey)==='1';}catch{}
  if(recoveryLink||recoveryPending){rememberRecovery(true);await passwordScreen(true);return;}
  await openWorkspace();
 }catch(e){authScreen(authError(e));}
}
async function openWorkspace(){
 try{
  await rpc('claim_pupil_account',{});
  state.role=(await rpc('is_instructor',{}))?'admin':'pupil';
  await reloadData();state.pupilPreview=null;if(state.role==='pupil'){state.pupilId=state.pupils[0]?.id;if(!state.pupilId){authScreen('Your account is not linked to a pupil yet. Ask your instructor for an access code.');return;}}
  render();registerTools();if(pointQueue.length){toast('Unsynced route points found. Open the active lesson and resume recording to retry saving.',true);}
 }catch(e){authScreen(`Could not open the diary: ${e.message}`);}
}
function passwordFields(){return '<label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label><p class="help">Use at least 8 characters.</p>';}
function checkPasswords(form){
 const password=form.elements.password.value;
 if(password.length<8)throw Error('Use at least 8 characters for your password.');
 if(password!==form.elements.confirm_password.value)throw Error('The passwords do not match.');
 return password;
}
function bindAuthForm(form,action){
 form.onsubmit=async e=>{
  e.preventDefault();
  const button=form.querySelector('button[type="submit"]'),result=form.querySelector('[role="status"]');
  if(button.disabled||!form.reportValidity())return;
  button.disabled=true;result.textContent='';result.className='help';
  try{await action(form,result);}catch(error){result.textContent=authError(error);result.className='error-message';}
  finally{button.disabled=false;}
 };
}
async function pupilAccess(body){
 const {data,error}=await db.functions.invoke('pupil-access',{body});
 if(error){let message='Could not complete the request. Please try again.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
 if(data?.error)throw Error(data.error);return data;
}
function authScreen(message='',mode='pupil',email=''){
 const pupilLogin=mode==='pupil',reset=mode==='reset';
 $('#app').innerHTML=`<div class="auth"><h1>${pupilLogin?'Pupil sign in':reset?'Set or reset password':'Instructor sign in'}</h1>${pupilLogin?'<p class="help">Use your email and the access code from your instructor.</p>':reset?'<p class="help">We will email you a link to choose your instructor password.</p>':''}${message?`<p class="error-message" role="alert">${h(message)}</p>`:''}<form id="sign-in"><label>Email address<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${h(email)}" required></label>${reset?'':pupilLogin?'<label>Access code<input name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required maxlength="40"></label>':'<label>Password<input name="password" type="password" autocomplete="current-password" required></label>'}<button type="submit" class="primary">${reset?'Send password reset email':'Sign in'}</button><p id="auth-result" role="status" class="help"></p></form>${pupilLogin?'<p class="help">If you have lost your code, ask your instructor for a new one.</p><button id="instructor-signin" class="text-button">Instructor sign in</button>':mode==='signin'?'<button id="forgot-password" class="text-button">Set or reset password</button><button id="pupil-signin" class="text-button">Pupil sign in</button>':'<button id="back-signin" class="text-button">Back to instructor sign in</button>'}<button id="clear-session" class="text-button">Use a different account</button></div>`;
 const form=$('#sign-in');
 bindAuthForm(form,async(form,result)=>{
  if(!db)throw Error('Sign-in is unavailable. Reload the page and try again.');
  const email=form.elements.email.value.trim(),redirect=location.origin+location.pathname;
  if(reset){
   const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:redirect});if(error)throw error;
   result.textContent='If an account exists for this email, a password reset link has been sent. Open the newest email once.';
  }else if(pupilLogin){
   const code=form.elements.code.value.replace(/[\s-]/g,'').toUpperCase();
   if(!/^[A-HJ-NP-Z2-9]{16}$/.test(code))throw Error('Enter the full access code given by your instructor.');
   const data=await pupilAccess({action:'login',email,code});
   const {error}=await db.auth.setSession(data.session);if(error)throw error;
   form.elements.code.value='';rememberRecovery(false);await openWorkspace();
  }else{
   const {error}=await db.auth.signInWithPassword({email,password:form.elements.password.value});if(error)throw error;
   form.elements.password.value='';rememberRecovery(false);await openWorkspace();
  }
 });
 $('#forgot-password')?.addEventListener('click',()=>authScreen('','reset',form.elements.email.value));
 $('#instructor-signin')?.addEventListener('click',()=>authScreen('','signin',form.elements.email.value));
 $('#pupil-signin')?.addEventListener('click',()=>authScreen('','pupil',form.elements.email.value));
 $('#back-signin')?.addEventListener('click',()=>authScreen('','signin',form.elements.email.value));
 $('#clear-session').onclick=()=>safely(signOut);
}
async function passwordScreen(recovery=false){
 const {data:{user},error}=await db.auth.getUser();if(error)throw error;
 if(!user){authScreen('Sign in or request a password reset link first.');return;}
 if(!(await rpc('is_instructor',{}))){rememberRecovery(false);await openWorkspace();toast('Ask your instructor to replace your access code.');return;}
 const body=`<form id="set-password" class="stack"><label>Email address<input type="email" name="email" autocomplete="username" value="${h(user.email||'')}" readonly></label>${passwordFields()}<button type="submit" class="primary">Save password</button><p role="status" class="help"></p></form>`;
 if(recovery){$('#app').innerHTML=`<div class="auth"><h1>Set password</h1>${body}<button id="cancel-recovery" class="text-button">Back to sign in</button></div>`;$('#cancel-recovery').onclick=()=>safely(signOut);}
 else dialog('Set password',body);
 bindAuthForm($('#set-password'),async(form,result)=>{
  const password=checkPasswords(form);
  const {error}=await db.auth.updateUser({password});if(error)throw error;
  form.elements.password.value='';form.elements.confirm_password.value='';rememberRecovery(false);
  if(recovery){await openWorkspace();toast('Password saved. Use your email and password next time.');}
  else{result.textContent='Password saved. Use your email and password next time.';}
 });
}
async function signOut(){if(trackingLesson||pointQueue.length){toast('Stop route recording and save its points before signing out.',true);return;}const result=await db?.auth.signOut();if(result?.error)throw result.error;rememberRecovery(false);location.reload();}
function renderPupils(){
 $('#content').innerHTML=`<div class="heading"><div><h1>Pupils</h1></div><div class="profile-actions"><button id="refresh-pupils">Refresh activity</button><button id="add-pupil" class="primary">＋ Add pupil</button></div></div><div class="cards">${state.pupils.map(p=>{const total=lessonTotals(state.lessons.filter(l=>l.pupil_id===p.id));return `<article class="panel"><div class="pupil-avatar" style="background:${h(p.colour)}">${h(p.name.split(' ').map(n=>n[0]).slice(0,2).join(''))}</div><h3>${h(p.name)}</h3><p class="muted">${h(p.email)}</p><div class="detail-metrics"><div><strong>${total.hours.toFixed(1)}</strong><span>hours driven</span></div><div><strong>${total.miles.toFixed(1)}</strong><span>miles driven</span></div></div>${activitySummary(p.id)}<div class="profile-actions"><button data-pupil="${p.id}">View lessons & progress</button><button data-skills="${p.id}">Driving skills</button><button data-preview-pupil="${p.id}">View as pupil</button><button data-manage-pupil="${p.id}" class="text-button">Email & access code</button></div></article>`;}).join('')||'<div class="empty">Add your first pupil to start booking lessons.</div>'}</div>`;
 $('#refresh-pupils').onclick=()=>safely(async()=>{await reloadData();renderPupils();toast('Activity refreshed.');});
 bindSkillButtons();
 $('#add-pupil').onclick=()=>{dialog('Add pupil',`<form id="pupil-form" class="stack"><label>Full name<input name="name" required maxlength="120"></label><label>Email address<input type="email" name="email" required></label><p class="help">After adding the pupil, open Email & access code to generate their sign-in code. Pupils can only view their own lessons and progress.</p><div class="dialog-actions"><button type="submit" class="primary">Add pupil</button></div></form>`);$('#pupil-form').onsubmit=e=>{e.preventDefault();safely(async()=>{const f=new FormData(e.target),p={name:f.get('name').trim(),email:f.get('email').trim().toLowerCase(),colour:['#dcf2d0','#dbeafa','#f5e6ce'][state.pupils.length%3]};if(!p.name)throw Error('Enter a name.');if(state.demo)state.pupils.push({...p,id:crypto.randomUUID()});else{const {error}=await db.from('pupils').insert(p);if(error)throw error;await reloadData();}$('#modal').close();render();toast('Pupil added.');});};};
 document.querySelectorAll('[data-preview-pupil]').forEach(b=>b.onclick=()=>previewPupil(b.dataset.previewPupil));
 document.querySelectorAll('[data-manage-pupil]').forEach(b=>b.onclick=()=>managePupil(b.dataset.managePupil));
 document.querySelectorAll('[data-pupil]').forEach(b=>b.onclick=()=>{state.view='progress';state.progressPupil=b.dataset.pupil;renderProgress(b.dataset.pupil);});
}
function managePupil(id){
 const p=state.pupils.find(x=>x.id===id);if(!p||state.role!=='admin')return;
 dialog(p.name,`<form id="pupil-access-form" class="stack"><label>Email address<input name="email" type="email" required maxlength="320" value="${h(p.email)}" autocomplete="off"></label><p class="help">Pupils use this email with their access code.</p><button type="submit" class="primary">Save email</button><p id="pupil-email-status" role="status" class="help"></p></form><h3 class="section-title">Access code</h3><p class="help">${p.access_issued_at?'A code has been issued. Generate a new one to replace it.':'Generate a code to give this pupil access.'} Codes work until you replace them. Replacing a code also disconnects the previous pupil login from their records.</p><button id="generate-pupil-code">${p.access_issued_at?'Generate new code':'Generate access code'}</button><div id="pupil-code-result" aria-live="polite"></div>`);
 const form=$('#pupil-access-form');
 const saveEmail=async()=>{
  if(!form.reportValidity())throw Error('Enter a valid email address.');const email=form.elements.email.value.trim().toLowerCase();
  if(email===p.email)return;
  if(state.demo){if(state.pupils.some(x=>x.id!==id&&x.email===email))throw Error('That email is already assigned to another pupil');p.email=email;}
  else{await rpc('edit_pupil_email',{p_id:id,p_email:email,p_expected_email:p.email});p.email=email;await reloadData();}
  $('#pupil-email-status').textContent='Email saved.';if($('#code-email'))$('#code-email').textContent=p.email;render();
 };
 form.onsubmit=e=>{e.preventDefault();safely(async()=>{try{await saveEmail();}catch(e){$('#pupil-email-status').textContent=e.message;throw e;}});};
 $('#generate-pupil-code').onclick=()=>safely(async()=>{
  const button=$('#generate-pupil-code');button.disabled=true;
  try{
   await saveEmail();
   const result=state.demo?{code:'DEMO-CODE-ONLY-2345',email:p.email}:await pupilAccess({action:'generate',pupil_id:id});
   if(state.demo)p.access_issued_at=new Date().toISOString();else await reloadData();render();
   $('#pupil-code-result').innerHTML=`<label class="section-title">${state.demo?'Sample code (preview only)':'New access code'}<input id="new-pupil-code" type="text" readonly value="${h(result.code)}" autocomplete="off"></label><p class="help">Give this code and <span id="code-email">${h(result.email)}</span> to the pupil. Copy it now; it is only shown here once. You can generate a replacement if needed.</p><button id="copy-pupil-code">Copy code</button><p id="copy-code-status" role="status" class="help"></p>`;
   $('#copy-pupil-code').onclick=async()=>{try{await navigator.clipboard.writeText(result.code);$('#copy-code-status').textContent='Code copied.';}catch{$('#new-pupil-code').select();$('#copy-code-status').textContent='Select and copy the code above.';}};
   button.textContent='Generate new code';
  }finally{button.disabled=false;}
 });
}
function locationFields(prefix,label,place){return `<div class="full"><label>${label}<div class="place-search"><input id="${prefix}-label" value="${h(place?.label||'')}" placeholder="Address or postcode" required autocomplete="off"><button type="button" id="${prefix}-find">Find</button></div></label><button type="button" id="${prefix}-map-pick" class="text-button">Select on map</button><div id="${prefix}-results"></div><p class="help" id="${prefix}-chosen">${place?'Location selected':'Enter the location, then search or select a point on the map.'}</p></div>`;}
async function mapRequest(body){if(state.demo)throw Error('Address search and road travel estimates become available when the map service is connected. Use the sample location buttons to try booking.');const {data,error}=await db.functions.invoke('maps',{body});if(error)throw Error('The map service is unavailable. Check its setup or use a manual travel allowance.');if(data.error)throw Error(data.error);return data;}
function bindLocation(prefix,places){$(`#${prefix}-map-pick`).onclick=()=>{const input=$(`#${prefix}-label`);if(!input.value.trim()){toast('Enter a label or address for this location.',true);return;}if(!window.L){toast('Map unavailable. Check your connection.',true);return;}const container=$(`#${prefix}-results`);container.innerHTML=`<div class="map" id="${prefix}-pick-map"></div><p class="help">Zoom in and tap the pickup or drop-off point.</p><button type="button" id="${prefix}-confirm-pin" disabled>Use selected point</button>`;if(map)map.remove();map=L.map(`${prefix}-pick-map`).setView(places[prefix]?[places[prefix].lat,places[prefix].lng]:[54,-2],places[prefix]?15:6);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);let selected=null,marker=null;map.on('click',e=>{selected={label:input.value.trim(),lat:e.latlng.lat,lng:e.latlng.lng};if(marker)marker.remove();marker=L.circleMarker(e.latlng,{radius:8,color:'#1e7847'}).addTo(map);$(`#${prefix}-confirm-pin`).disabled=false;});$(`#${prefix}-confirm-pin`).onclick=()=>{places[prefix]=selected;map.remove();map=null;container.innerHTML='';$(`#${prefix}-chosen`).textContent='✓ Location selected';$('#booking').dispatchEvent(new Event('input',{bubbles:true}));};};const input=$(`#${prefix}-label`);input.oninput=()=>{places[prefix]=null;$(`#${prefix}-chosen`).textContent='Select a result to confirm this location.';};$(`#${prefix}-find`).onclick=()=>safely(async()=>{if(input.value.trim().length<3)throw Error('Enter an address or postcode.');const features=state.demo?[{label:'Station car park (sample)',lat:51.4545,lng:-2.5879},{label:'College entrance (sample)',lat:51.465,lng:-2.59},{label:'Library (sample)',lat:51.447,lng:-2.6}]:(await mapRequest({action:'geocode',query:input.value})).places;const container=$(`#${prefix}-results`);container.innerHTML=features.map((f,i)=>`<button class="place-result" type="button" data-place="${i}">${h(f.label)}</button>`).join('')||'<p class="help">No matching locations found.</p>';container.querySelectorAll('button').forEach(b=>b.onclick=()=>{places[prefix]=features[Number(b.dataset.place)];input.value=places[prefix].label;container.innerHTML='';$(`#${prefix}-chosen`).textContent='✓ Location selected';});});}
function bookLesson(previous=null){
 if(!state.pupils.length){toast('Add a pupil first.');state.view='pupils';render();return;}
 const places={pickup:previous?.pickup||null,dropoff:previous?.dropoff||null};let quote=null;
 dialog('Book a lesson',`<form id="booking"><div class="form-grid">${locationFields('pickup','Pickup location',places.pickup)}${locationFields('dropoff','Drop-off location',places.dropoff)}<label>Pupil<select name="pupil_id">${state.pupils.map(p=>`<option value="${p.id}" ${previous?.pupil_id===p.id?'selected':''}>${h(p.name)}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required value="${localDate(previous?addDays(previous.starts_at,7):today)}"></label><label>Start time<input name="time" type="time" required value="${previous?clock(previous.starts_at):'09:00'}"></label><label>Duration (minutes)<input name="duration" type="number" min="15" max="480" step="15" value="120" required></label><label>Lesson price (${config.currency})<input name="fee" type="number" min="0" step="0.01" value="80" required></label><label>Travel allowance<select name="travel_mode"><option value="automatic">Calculate from road travel time</option><option value="manual" ${state.demo?'selected':''}>Enter manually</option></select></label><label>Minutes before<input name="before" type="number" min="0" max="480" value="20"></label><label>Minutes to next lesson<input name="after" type="number" min="0" max="480" value="20"></label><label class="full">Lesson objectives<textarea name="objectives"></textarea></label><p class="help full">Objectives carry forward from this pupil’s latest completed lesson. You can edit them.</p></div><div id="travel-result" class="notice">Confirm the locations, date and time, then check availability.</div><div class="dialog-actions"><button id="check-times" type="button">Check availability</button><button id="save-booking" type="submit" class="primary" disabled>Book lesson</button></div></form>`);
 bindLocation('pickup',places);bindLocation('dropoff',places);
 const form=$('#booking');let objectivesEdited=false;
 const candidate=()=>{const f=new FormData(form),start=new Date(`${f.get('date')}T${f.get('time')}`);return {pupil_id:f.get('pupil_id'),starts_at:start.toISOString(),ends_at:new Date(start.getTime()+Number(f.get('duration'))*60000).toISOString(),fee:Number(f.get('fee')),pickup:places.pickup,dropoff:places.dropoff,objectives:f.get('objectives')};};
 const fillAims=()=>{if(!form.elements.date.value||!form.elements.time.value)return;if(!objectivesEdited)form.elements.objectives.value=previousAims(state.lessons,form.elements.pupil_id.value,candidate().starts_at);};fillAims();form.elements.objectives.oninput=()=>objectivesEdited=true;
 form.oninput=e=>{if(e.target.name!=='objectives'){quote=null;$('#save-booking').disabled=true;$('#travel-result').textContent='Booking details changed. Check availability again.';}if(['pupil_id','date','time'].includes(e.target.name))fillAims();};
 const check=async()=>{if(!form.reportValidity())return;await reloadData();const c=candidate();if(!c.pickup||!c.dropoff)throw Error('Select both pickup and drop-off locations first.');const {prev,next}=validateBooking(c,state.lessons);const signature=JSON.stringify([c,form.elements.travel_mode.value,form.elements.before.value,form.elements.after.value]);let before=0,after=0,source=form.elements.travel_mode.value;
  if(source==='automatic'){if(prev)before=(await mapRequest({action:'directions',from:prev.dropoff,to:c.pickup})).minutes;if(next)after=(await mapRequest({action:'directions',from:c.dropoff,to:next.pickup})).minutes;}
  else{before=prev?Number(form.elements.before.value):0;after=next?Number(form.elements.after.value):0;}
  validateBooking(c,state.lessons,before,after);if(JSON.stringify([candidate(),form.elements.travel_mode.value,form.elements.before.value,form.elements.after.value])!==signature)throw Error('Booking details changed. Check availability again.');quote={...c,signature,before,after,source,previousId:prev?.id||null,nextId:next?.id||null};$('#travel-result').textContent=`Available. ${before} minutes from the previous lesson; ${after} minutes to the next.${source==='manual'?' Using your manual allowances.':' Road estimates include a 5-minute margin; traffic may vary.'}`;$('#save-booking').disabled=false;};
 $('#check-times').onclick=()=>safely(check);
 form.onsubmit=e=>{e.preventDefault();safely(async()=>{if(!quote)throw Error('Check availability first.');const c=candidate();if(JSON.stringify([{...c,objectives:quote.objectives},form.elements.travel_mode.value,form.elements.before.value,form.elements.after.value])!==quote.signature)throw Error('Booking details changed. Check availability again.');const args={p_pupil_id:c.pupil_id,p_starts_at:c.starts_at,p_ends_at:c.ends_at,p_pickup:c.pickup,p_dropoff:c.dropoff,p_fee:c.fee,p_objectives:c.objectives,p_before:quote.before,p_after:quote.after,p_source:quote.source,p_previous:quote.previousId,p_next:quote.nextId,p_inherited:!objectivesEdited};
  if(state.demo){validateBooking(c,state.lessons,quote.before,quote.after);state.lessons.push({...c,id:crypto.randomUUID(),status:'scheduled',paid:false,objectives_inherited:!objectivesEdited,travel_before_minutes:quote.before,travel_source:quote.source,improved:'',needs_work:'',other:'',next_aims:''});const next=state.lessons.find(l=>l.id===quote.nextId);if(next){next.travel_before_minutes=quote.after;next.travel_source=quote.source;}}
  else{await rpc('book_lesson',args);await reloadData();}state.week=weekStart(c.starts_at);state.view='diary';$('#modal').close();render();toast('Lesson booked.');});};
}
const noteFields=[['objectives','Lesson objectives'],['improved','What has improved'],['needs_work','What needs more work'],['other','Other'],['next_aims','Aims for next time']];
async function lessonPoints(id){if(state.demo)return state.points.filter(p=>p.lesson_id===id);let result=[],offset=0;while(true){const {data,error}=await db.from('route_points').select('*').eq('lesson_id',id).order('recorded_at').order('id').range(offset,offset+999);if(error)throw error;result.push(...data);if(data.length<1000)return result;offset+=1000;}}
let routeMapRequest=0;
function openLesson(id){
 const l=visibleLessons().find(l=>l.id===id);if(!l)return;void trackPupilActivity();state.selected=id;const admin=state.role==='admin';
 dialog(pupil(l.pupil_id)?.name||'Lesson',`<div class="row"><div><strong>${dateLabel(l.starts_at,{weekday:'long',day:'numeric',month:'long'})}</strong><p class="help">${clock(l.starts_at)} – ${clock(l.ends_at)} · ${h(l.status)}</p></div><span class="pill">${money(l.fee)} · ${l.paid?'Paid':'Unpaid'}</span></div><p class="help">Pickup: ${h(l.pickup.label)}<br>Drop-off: ${h(l.dropoff.label)}</p>${l.status==='completed'?`<div class="detail-metrics"><div><strong>${(minutes(l.started_at,l.ended_at)/60).toFixed(2)} hrs</strong><span>actual lesson time</span></div><div><strong>${lessonMiles(l).toFixed(2)} mi</strong><span>${l.route_distance_miles!=null?'GPS mileage (estimate)':`${l.start_mileage} → ${l.end_mileage}`}</span></div></div>`:''}${admin?`<div class="dialog-actions">${l.travel_source==='review'?'<button id="review-travel">Review travel time</button>':''}${l.status==='scheduled'?'<button id="start-lesson" class="primary lime">▶ Start lesson</button>':''}${l.status==='active'?'<button id="stop-lesson" class="primary">■ Stop lesson</button><button id="record-route">'+(trackingLesson===l.id?'Pause route recording':'Record route')+'</button>':''}${l.status!=='cancelled'?'<button id="edit-times">Edit lesson times</button>':''}<button id="payment">Mark as ${l.paid?'unpaid':'paid'}</button>${l.status==='scheduled'?'<button id="cancel-lesson" class="danger">Cancel lesson</button>':''}</div>`:''}${l.status==='active'?'<p class="route-status" id="route-status">'+h(trackingLesson===id?trackingMessage:'Route recording is not running on this device.')+'</p>':''}<form id="notes" class="stack">${noteFields.map(([key,label])=>admin?`<label>${label}<textarea name="${key}" maxlength="20000">${h(l[key])}</textarea></label>`:`<div><h3>${label}</h3><p class="read-note">${h(l[key]||'No notes added yet.')}</p></div>`).join('')}${admin?'<button type="submit" class="primary">Save lesson notes</button><span class="saved-line" id="notes-status" role="status"></span>':''}</form><h3 class="section-title" id="route-heading" style="scroll-margin-top:100px">Lesson route</h3><p class="help" id="route-summary">Loading saved route…</p><div id="lesson-map" class="map"></div>${admin&&l.status!=='cancelled'?'<label class="section-title">Upload a GPX route<input type="file" id="import-gpx" accept=".gpx,application/gpx+xml,application/xml,text/xml"></label><p class="help">Choose a recording, check the preview, then save it to this lesson. The full route is kept.</p><div id="route-import-panel" aria-live="polite"></div>':''}<h3 class="section-title">Lesson resources</h3><div id="lesson-resources" class="list"></div><div id="lesson-video-cards" class="lesson-video-cards"></div>${admin&&l.status!=='cancelled'?lessonResourceControls():''}${admin&&l.status==='completed'?'<div class="dialog-actions"><button id="next-lesson" class="primary lime">＋ Book next lesson</button></div>':''}`);
 const saveNotes=async()=>{if(state.role!=='admin')return;const f=new FormData($('#notes'));const changes=Object.fromEntries(noteFields.map(([key])=>[key,f.get(key)]));if(state.demo){l.objectives_inherited=l.objectives_inherited!==false&&l.objectives===changes.objectives;Object.assign(l,changes);}else{await rpc('save_lesson_notes',{p_id:id,p_notes:changes});await reloadData();}$('#notes-status').textContent='Saved. Your pupil can see these notes.';};
 $('#notes').onsubmit=e=>{e.preventDefault();if(admin)safely(saveNotes);};
 $('#edit-times')?.addEventListener('click',()=>safely(async()=>{await saveNotes();editLessonTimes(id);}));
 $('#review-travel')?.addEventListener('click',()=>safely(async()=>{await saveNotes();reviewTravel(id);}));
 $('#start-lesson')?.addEventListener('click',()=>safely(async()=>{await saveNotes();startForm(id);}));$('#stop-lesson')?.addEventListener('click',()=>safely(async()=>{await saveNotes();stopForm(id);}));
 $('#payment')?.addEventListener('click',()=>safely(async()=>{await saveNotes();if(state.demo)l.paid=!l.paid;else{await rpc('set_lesson_paid',{p_id:id,p_paid:!l.paid});await reloadData();}render();openLesson(id);}));
 $('#cancel-lesson')?.addEventListener('click',()=>{dialog('Cancel this lesson?',`<p>${h(pupil(l.pupil_id)?.name)} · ${dateLabel(l.starts_at)} at ${clock(l.starts_at)}</p><p class="help">The record and notes are kept. The time becomes available again.</p><div class="dialog-actions"><button id="keep-lesson">Keep lesson</button><button id="confirm-cancel" class="danger">Cancel lesson</button></div>`);$('#keep-lesson').onclick=()=>openLesson(id);$('#confirm-cancel').onclick=()=>safely(async()=>{if(state.demo)l.status='cancelled';else{await rpc('cancel_lesson',{p_id:id});await reloadData();}$('#modal').close();render();toast('Lesson cancelled.');});});
 $('#record-route')?.addEventListener('click',()=>safely(async()=>{await saveNotes();if(trackingLesson===id){await stopTracking();}else await startTracking(id);openLesson(id);}));
 $('#next-lesson')?.addEventListener('click',()=>safely(async()=>{await saveNotes();bookLesson(state.lessons.find(x=>x.id===id));}));
 $('#import-gpx')?.addEventListener('change',e=>{const file=e.target.files[0];if(file)void previewGpx(file,l);});
 void showSavedRoute(l).catch(e=>{if(state.selected===id&&$('#route-summary'))$('#route-summary').textContent='Could not load the saved route. Reopen the lesson to retry.';toast(e.message,true);});
 showLessonResources(id);bindLessonResourceControls(id);
}
function localDateTime(value){const d=new Date(value);return `${localDate(d)}T${[d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':')}`;}
function editLessonTimes(id){
 const l=state.lessons.find(x=>x.id===id);if(!l||l.status==='cancelled'||state.role!=='admin')return;
 const expected=Object.fromEntries(['starts_at','ends_at','started_at','ended_at','status'].map(key=>[key,l[key]??null]));
 const next=state.lessons.filter(x=>x.id!==id&&x.status!=='cancelled'&&new Date(x.starts_at)>=new Date(l.ends_at)).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0];
 const field=(key,label)=>`<label>${label}<input name="${key}" type="datetime-local" step="1" required value="${localDateTime(l[key])}"></label>`;
 dialog('Edit lesson times',`<form id="edit-times-form" class="stack"><h3>Booked times</h3><div class="form-grid">${field('starts_at','Booked start')}${field('ends_at','Booked finish')}</div>${l.started_at?`<h3>Recorded driving times</h3><p class="help">These times determine the pupil’s driving hours when the lesson is completed.</p><div class="form-grid">${field('started_at','Actual start')}${l.ended_at?field('ended_at','Actual finish'):''}</div>`:''}<div id="edit-travel" hidden><h3>Travel allowance</h3><p class="help">Check these allowances for the new booking time. Enter the minutes needed between lessons.</p><div class="form-grid"><label>Minutes from previous lesson<input name="before" type="number" min="0" max="480" step="1" required value="${l.travel_before_minutes||0}"></label><label>Minutes to next lesson<input name="after" type="number" min="0" max="480" step="1" required value="${next?.travel_before_minutes||0}"></label></div></div><p id="times-error" class="help" role="alert"></p><div class="dialog-actions"><button id="back-to-lesson" type="button">Back</button><button type="submit" class="primary">Save times</button></div></form>`);
 const form=$('#edit-times-form');
 const value=key=>form.elements[key]?Date.parse(form.elements[key].value)===Date.parse(localDateTime(l[key]))?l[key]:new Date(form.elements[key].value).toISOString():l[key]??null;
 const moved=()=>value('starts_at')!==l.starts_at||value('ends_at')!==l.ends_at;
 form.oninput=()=>{try{$('#edit-travel').hidden=!moved();}catch{}$('#times-error').textContent='';};
 $('#back-to-lesson').onclick=()=>openLesson(id);
 form.onsubmit=e=>{e.preventDefault();safely(async()=>{try{
  if(!form.reportValidity())return;
  const changes=Object.fromEntries(['starts_at','ends_at','started_at','ended_at'].map(key=>[key,value(key)]));
  if(minutes(changes.starts_at,changes.ends_at)<=0||minutes(changes.starts_at,changes.ends_at)>480)throw Error('The booked finish must be after the start, with a maximum of 8 hours.');
  if(changes.ended_at&&new Date(changes.ended_at)<new Date(changes.started_at))throw Error('The actual finish must be at or after the actual start.');
  if(l.status==='active'&&new Date(changes.started_at)>new Date())throw Error('The actual start cannot be in the future.');
  const scheduleChanged=moved();await reloadData();
  const before=Number(form.elements.before.value),after=Number(form.elements.after.value);
  const {prev,next}=scheduleChanged?validateBooking({id,...changes},state.lessons,before,after):{};
  if(state.demo){
   const oldNext=state.lessons.filter(x=>x.id!==id&&x.status!=='cancelled'&&new Date(x.starts_at)>=new Date(l.ends_at)).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0];
   Object.assign(l,changes);
   if(scheduleChanged){l.travel_before_minutes=prev?before:0;l.travel_source='manual';if(next){next.travel_before_minutes=after;next.travel_source='manual';}if(oldNext&&oldNext.id!==next?.id)oldNext.travel_source='review';}
  }else{await rpc('edit_lesson_times',{p_id:id,p_starts_at:changes.starts_at,p_ends_at:changes.ends_at,p_started_at:changes.started_at,p_ended_at:changes.ended_at,p_expected:expected,p_before:before,p_after:after,p_previous:prev?.id||null,p_next:next?.id||null});await reloadData();}
  state.week=weekStart(changes.starts_at);render();openLesson(id);toast('Lesson times saved.');
 }catch(error){if($('#times-error'))$('#times-error').textContent=error.message;throw error;}});};
}
function startForm(id){const l=state.lessons.find(x=>x.id===id);dialog('Start lesson',`<form id="start-form" class="stack"><label>Starting mileage<input type="number" name="mileage" min="0" step="0.1" required inputmode="decimal"></label><label><input type="checkbox" name="track">Record this device’s location</label><p class="notice">On iPhone, keep this page open and the screen on for route recording. It may pause when the phone locks or you switch apps. You can also import a route afterwards.</p><div class="dialog-actions"><button type="submit" class="primary lime">Start lesson</button></div></form>`);$('#start-form').onsubmit=e=>{e.preventDefault();safely(async()=>{const f=new FormData(e.target),m=Number(f.get('mileage'));if(state.lessons.some(x=>x.status==='active'&&x.id!==id))throw Error('Stop the current lesson before starting another.');if(state.demo){if(l.objectives_inherited!==false){const aims=previousAims(state.lessons,l.pupil_id,l.starts_at);if(aims)l.objectives=aims;}Object.assign(l,{status:'active',started_at:new Date().toISOString(),start_mileage:m});}else{await rpc('start_lesson',{p_id:id,p_mileage:m});await reloadData();}if(f.get('track'))await startTracking(id);render();openLesson(id);toast('Lesson started.');});};}
function stopForm(id){const l=state.lessons.find(x=>x.id===id);dialog('Stop lesson',`<form id="stop-form" class="stack"><p class="help">Starting mileage: ${l.start_mileage}</p><label>Ending mileage<input type="number" name="mileage" min="${l.start_mileage}" step="0.1" required inputmode="decimal"></label><div class="dialog-actions"><button type="submit" class="primary">Stop & complete lesson notes</button></div></form>`);$('#stop-form').onsubmit=e=>{e.preventDefault();safely(async()=>{const m=Number(new FormData(e.target).get('mileage'));if(m<l.start_mileage)throw Error('Ending mileage must be at least the starting mileage.');await stopTracking();if(state.demo)Object.assign(l,{status:'completed',ended_at:new Date().toISOString(),end_mileage:m});else{await rpc('finish_lesson',{p_id:id,p_mileage:m});await reloadData();}render();openLesson(id);toast('Lesson stopped. Add your notes and book the next lesson below.');});};}
function trackingStatus(message){trackingMessage=message;if($('#route-status'))$('#route-status').textContent=message;}
async function startTracking(id){
 if(!navigator.geolocation){toast('This browser does not support location recording.',true);return;}
 if(trackingLesson&&trackingLesson!==id)throw Error('Another lesson is recording on this device.');
 if(watchId!==null)return;trackingLesson=id;trackingStatus('Waiting for a location fix… Keep this page visible.');
 watchId=navigator.geolocation.watchPosition(position=>{const {latitude:lat,longitude:lng,accuracy}=position.coords;if(accuracy>100){trackingStatus('GPS accuracy is low. Waiting for a better fix…');return;}const p={id:crypto.randomUUID(),lesson_id:id,lat,lng,accuracy,recorded_at:new Date(position.timestamp).toISOString()};if(new Date(p.recorded_at)<new Date(state.lessons.find(l=>l.id===id)?.started_at))return;const last=pointQueue.at(-1);if(last&&new Date(p.recorded_at)-new Date(last.recorded_at)<3000)return;pointQueue.push(p);persistQueue();trackingStatus(`Recording · last fix ${clock(p.recorded_at)} · ±${Math.round(accuracy)} m · ${pointQueue.length} awaiting sync`);},e=>{trackingStatus(e.code===1?'Location permission was denied. Enable it in your browser settings, or import a route later.':`Location interrupted: ${e.message}. Keep the page open.`);if(e.code===1){navigator.geolocation.clearWatch(watchId);watchId=null;trackingLesson=null;clearInterval(syncTimer);wakeLock?.release().catch(()=>{});wakeLock=null;}},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 syncTimer=setInterval(()=>flushPoints().catch(e=>trackingStatus(`Route saved on this device; sync pending: ${e.message}`)),10000);
 try{wakeLock=await navigator.wakeLock?.request('screen');}catch{};
}
function persistQueue(){try{if(!state.demo)sessionStorage.setItem('pending-route-points',JSON.stringify(pointQueue));}catch{trackingStatus('Device storage is full. Keep this page open until points are synced.');}}
async function flushPoints(){if(flushPoints.running)return flushPoints.running;if(!pointQueue.length)return;const batch=pointQueue.slice(0,500);flushPoints.running=(async()=>{if(state.demo)state.points.push(...batch);else{const {error}=await db.from('route_points').upsert(batch,{onConflict:'id',ignoreDuplicates:true});if(error)throw error;}const ids=new Set(batch.map(p=>p.id));pointQueue=pointQueue.filter(p=>!ids.has(p.id));persistQueue();})();try{await flushPoints.running;}finally{flushPoints.running=null;}if(pointQueue.length)return flushPoints();}
async function stopTracking(){if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=null;clearInterval(syncTimer);try{await wakeLock?.release();}catch{}wakeLock=null;trackingLesson=null;await flushPoints();trackingStatus('Route recording stopped and points saved.');}
document.addEventListener('visibilitychange',()=>{if(trackingLesson){if(document.hidden)trackingStatus('Recording may be paused while this page is hidden.');else{trackingStatus('Page visible again. Waiting for GPS…');navigator.wakeLock?.request('screen').then(lock=>wakeLock=lock).catch(()=>{});}}});
window.addEventListener('beforeunload',e=>{if(trackingLesson||pointQueue.length){persistQueue();e.preventDefault();e.returnValue='';}});
function routePeriod(points){return `${dateLabel(points[0].recorded_at,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} – ${dateLabel(points.at(-1).recorded_at,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}`;}
async function showSavedRoute(lesson,success=''){
 const request=++routeMapRequest;
 const points=await lessonPoints(lesson.id);
 if(request!==routeMapRequest||state.selected!==lesson.id||!$('#lesson-map'))return;
 drawMap('lesson-map',points,false,lesson.pickup);
 $('#route-summary').textContent=points.length?`${success?success+' ':''}Saved route${lesson.route_distance_miles!=null?' · '+Number(lesson.route_distance_miles).toFixed(2)+' miles (GPS estimate)':''} · ${points.length} GPS points · ${routePeriod(points)}${lesson.route_file_name?' · '+lesson.route_file_name:''}`:'No route saved yet.';
}
async function previewGpx(file,lesson){
 const request=++routeMapRequest,panel=$('#route-import-panel');
 panel.textContent='Reading GPX file…';
 let parsed;
 try{
  if(file.size>15*1024*1024)throw Error('Please use a GPX file smaller than 15 MB.');
  parsed=extractGpxPoints(new DOMParser().parseFromString(await file.text(),'application/xml'));
  if(request!==routeMapRequest||state.selected!==lesson.id||!panel.isConnected)return;
  const {points,skipped}=parsed;
  const begins=Date.parse(lesson.started_at||lesson.starts_at),ends=Date.parse(lesson.ended_at||lesson.ends_at);
  const outside=points.some(p=>Date.parse(p.recorded_at)<begins||Date.parse(p.recorded_at)>ends);
  drawMap('lesson-map',points,false,lesson.pickup);
  $('#route-summary').textContent=`Preview · ${routeMiles(points).toFixed(2)} miles (GPS estimate) · ${points.length} GPS points · ${routePeriod(points)}`;
  panel.innerHTML=`<p><strong>${h(file.name)}</strong></p><p class="help">Save to ${h(pupil(lesson.pupil_id)?.name||'this pupil')} · ${dateLabel(lesson.starts_at,{day:'numeric',month:'short',year:'numeric'})} at ${clock(lesson.starts_at)}.</p>${outside?'<p class="notice warning">The recording extends outside the lesson time. Saving will attach the full route and calculate mileage from it. Check that the recording belongs to this lesson.</p>':''}${skipped?`<p class="notice warning">${skipped} invalid GPS points were skipped.</p>`:''}<p class="help">GPS mileage estimates distance between recorded points. Gaps over 90 seconds and separate track segments are not joined. GPS mileage replaces odometer mileage in the pupil’s totals for this lesson.</p>${lesson.status==='scheduled'?'<label><input type="checkbox" id="complete-from-gpx">Mark lesson completed using this recording’s start and finish times</label>':''}<div class="dialog-actions"><button type="button" id="cancel-route-import">Cancel</button><button type="button" class="primary" id="save-route-import">Save route to lesson</button></div><p class="help" role="status" id="route-save-status"></p>`;
  $('#cancel-route-import').onclick=()=>{panel.innerHTML='';$('#import-gpx').value='';void showSavedRoute(lesson).catch(e=>toast(e.message,true));};
  $('#save-route-import').onclick=async()=>{
   const save=$('#save-route-import'),cancel=$('#cancel-route-import'),input=$('#import-gpx'),status=$('#route-save-status');
   if(save.disabled)return;const complete=$('#complete-from-gpx')?.checked||false;const notesDraft=Object.fromEntries(new FormData($('#notes')));save.disabled=true;cancel.disabled=true;input.disabled=true;status.textContent='Saving route…';
   try{
    let inserted;if(complete&&Date.parse(points.at(-1).recorded_at)<=Date.parse(points[0].recorded_at))throw Error('The recording needs different start and finish times to complete the lesson.');
    if(state.demo){
     const known=new Set(state.points.filter(p=>p.lesson_id===lesson.id).map(p=>JSON.stringify([p.recorded_at,p.lat,p.lng])));
     const additions=points.filter(p=>{const key=JSON.stringify([p.recorded_at,p.lat,p.lng]);if(known.has(key))return false;known.add(key);return true;});
     state.points.push(...additions.map(p=>({...p,id:crypto.randomUUID(),lesson_id:lesson.id})));inserted=additions.length;lesson.route_distance_miles=routeMiles(state.points.filter(p=>p.lesson_id===lesson.id&&p.segment_id));if(complete)Object.assign(lesson,{status:'completed',started_at:points[0].recorded_at,ended_at:points.at(-1).recorded_at});
    }else{
     try{inserted=await rpc('save_gpx_lesson',{p_id:lesson.id,p_filename:file.name,p_points:points,p_complete:complete});}
     catch(error){if(/save_gpx_lesson|schema cache/.test(error.message||''))throw Error('The route upload database update is not installed yet. Apply the GPX mileage update, then retry.');throw error;}
    }
    if(!state.demo){await reloadData();Object.assign(lesson,state.lessons.find(l=>l.id===lesson.id));}
    lesson.route_file_name=file.name;lesson.route_imported_at=new Date().toISOString();
    const current=state.lessons.find(l=>l.id===lesson.id);if(current){current.route_file_name=file.name;current.route_imported_at=lesson.route_imported_at;}
    if(state.selected!==lesson.id||!panel.isConnected)return;
    panel.innerHTML='';input.value='';
    const message=complete?'Lesson completed. Route and GPS mileage saved.':inserted===0?'This route was already saved.':'Route and GPS mileage saved.';
    render();openLesson(lesson.id);for(const [key,value] of Object.entries(notesDraft))if($('#notes').elements[key])$('#notes').elements[key].value=value;
    try{await showSavedRoute(lesson,message);}catch{if($('#route-summary'))$('#route-summary').textContent='Route saved. Reopen the lesson to reload the map.';}
    toast(message);$('#route-heading')?.scrollIntoView({block:'start',behavior:'smooth'});
   }catch(error){if(status.isConnected){status.textContent=error.message||'The route could not be saved. Try again.';status.className='error-message';}}
   finally{save.disabled=false;cancel.disabled=false;input.disabled=false;}
  };
 }catch(error){
  if(request!==routeMapRequest||!panel.isConnected)return;
  panel.innerHTML=`<p class="error-message" role="alert">${h(error.message||'Could not read this GPX file.')}</p>`;
  $('#import-gpx').value='';
 }
}
function drawMap(target,points,fog=false,fallback=null){
 if(!window.L){$(`#${target}`).innerHTML='<div class="empty">The map could not load. Check your internet connection.</div>';return;}
 if(map)map.remove();map=L.map(target,{scrollWheelZoom:false}).setView(fallback?[fallback.lat,fallback.lng]:[54,-2],fallback?13:5);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 const segments=splitTrack(points);const coordinates=segments.flat().map(p=>[p.lat,p.lng]);
 if(coordinates.length)map.fitBounds(L.latLngBounds(coordinates).pad(.2),{maxZoom:19});else L.popup().setLatLng(map.getCenter()).setContent('No route recorded yet.').openOn(map);
 segments.forEach(segment=>{if(segment.length===1)L.circleMarker([segment[0].lat,segment[0].lng],{radius:4,color:'#32905d'}).addTo(map);else L.polyline(segment.map(p=>[p.lat,p.lng]),{color:'#246bc7',weight:4,opacity:.95}).addTo(map);});
 if(!fog&&coordinates.length){const ordered=segments.flat().sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at));const first=ordered[0],last=ordered.at(-1);L.circleMarker([first.lat,first.lng],{radius:7,color:'#fff',weight:2,fillColor:'#16824a',fillOpacity:1}).bindTooltip('Start').addTo(map);if(ordered.length>1)L.circleMarker([last.lat,last.lng],{radius:7,color:'#fff',weight:2,fillColor:'#142b36',fillOpacity:1}).bindTooltip('Finish').addTo(map);}
 if(fog){const Fog=L.Layer.extend({onAdd(m){this.m=m;this.canvas=L.DomUtil.create('canvas','fog-layer');this.canvas.style.pointerEvents='none';m.getPanes().overlayPane.appendChild(this.canvas);m.on('moveend zoomend resize',this.redraw,this);this.redraw();},onRemove(m){m.off('moveend zoomend resize',this.redraw,this);this.canvas.remove();},redraw(){const m=this.m,s=m.getSize(),c=this.canvas;c.width=s.x;c.height=s.y;L.DomUtil.setPosition(c,m.containerPointToLayerPoint([0,0]));const ctx=c.getContext('2d');ctx.fillStyle='rgba(14,30,41,.86)';ctx.fillRect(0,0,s.x,s.y);ctx.globalCompositeOperation='destination-out';ctx.lineWidth=24;ctx.lineCap='round';ctx.lineJoin='round';segments.forEach(segment=>{ctx.beginPath();segment.forEach((p,i)=>{const q=m.latLngToContainerPoint([p.lat,p.lng]);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();});ctx.globalCompositeOperation='source-over';}});new Fog().addTo(map);}
 const drawnMap=map;setTimeout(()=>{if(map===drawnMap){drawnMap.invalidateSize();if(coordinates.length)drawnMap.fitBounds(L.latLngBounds(coordinates).pad(.15),{maxZoom:19});}},100);
}
async function renderProgress(id){
 const request=++progressMapRequest;
 if(state.role==='admin')id=id||state.progressPupil;else id=state.pupilId||'p1';const p=pupil(id);if(!p)return;const lessons=state.lessons.filter(l=>l.pupil_id===id),totals=lessonTotals(lessons);
 $('#content').innerHTML=`<div class="heading"><div><h1>${state.role==='admin'?h(p.name):'My progress'}</h1></div>${state.role==='admin'?'<div class="profile-actions"><button id="profile-pupil-preview">View as pupil</button><button id="back-pupils">Back to pupils</button></div>':''}</div><div class="stats"><div><span>Driving hours</span><strong>${totals.hours.toFixed(1)}<small>hours driven</small></strong></div><div><span>Distance driven</span><strong>${totals.miles.toFixed(1)}<small>miles</small></strong></div><div><span>Lessons completed</span><strong>${lessons.filter(l=>l.status==='completed').length}</strong></div></div>${state.role==='admin'?activitySummary(id):''}<section class="panel skill-summary"><div><h2>Driving skills</h2><p>${(state.skills||[]).filter(r=>r.pupil_id===id&&r.rating===4).length} of 27 fully independent</p></div><button data-skills="${id}">${state.role==='admin'?'Grade driving skills':'View driving skills'}</button></section><section class="panel"><div class="row"><h2>Roads explored</h2><label class="fog-toggle"><input id="fog" type="checkbox" checked>Fog of war</label></div><p class="help">Recorded GPS routes. Gaps indicate missing location data.</p><div id="progress-map" class="map"></div></section><h2 class="section-title">Upcoming lessons</h2><div class="list">${lessons.filter(l=>l.status==='active'||l.status==='scheduled'&&new Date(l.ends_at)>=new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).map(progressLesson).join('')||'<div class="empty">No upcoming lessons.</div>'}</div><h2 class="section-title">Past lessons</h2><div class="list">${lessons.filter(l=>l.status==='completed'||l.status==='cancelled'||l.status==='scheduled'&&new Date(l.ends_at)<new Date()).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at)).map(progressLesson).join('')||'<div class="empty">Your completed lessons will appear here.</div>'}</div>`;
 bindSkillButtons();
 $('#profile-pupil-preview')?.addEventListener('click',()=>previewPupil(id));
 $('#back-pupils')?.addEventListener('click',()=>{state.view='pupils';render();});document.querySelectorAll('[data-lesson]').forEach(b=>b.onclick=()=>openLesson(b.dataset.lesson));
 try{const points=(await Promise.all(lessons.filter(l=>l.status==='completed').map(l=>lessonPoints(l.id)))).flat();if(request!==progressMapRequest||!$('#progress-map'))return;drawMap('progress-map',points,true);$('#fog').onchange=e=>drawMap('progress-map',points,e.target.checked);}catch(e){toast(e.message,true);}
}
function progressLesson(l){return `<button class="list-button" data-lesson="${l.id}"><span>${dateLabel(l.starts_at,{weekday:'short',day:'numeric',month:'long',year:'numeric'})} · ${clock(l.starts_at)}<small>${h(l.objectives||'Lesson')} · ${h(l.status)}</small></span><span>${l.paid?'✓ Paid':'Unpaid'} →</span></button>`;}
function renderResources(){
 const active=currentLesson();$('#content').innerHTML=`<div class="heading"><div><h1>Teaching library</h1><p>Images, diagrams and videos for your lessons.</p></div><button class="primary" id="upload">＋ Upload resource</button></div>${active?`<div class="notice">Current lesson: <strong>${h(pupil(active.pupil_id)?.name)}</strong> · ${clock(active.starts_at)}. Open a resource to add it to this lesson.</div>`:''}<div class="cards">${state.resources.map(r=>`<article class="panel"><div class="resource-file">${r.kind==='video'?'▷':'▧'}</div><h3>${h(r.title)}</h3><p class="muted">${h(r.kind)} · ${dateLabel(r.created_at)}</p><button data-resource="${r.id}">Open resource</button></article>`).join('')||'<div class="empty">No teaching resources uploaded.</div>'}</div>`;
 $('#upload').onclick=uploadResource;document.querySelectorAll('[data-resource]').forEach(b=>b.onclick=()=>safely(()=>openResource(b.dataset.resource)));
}
function currentLesson(){const active=state.lessons.filter(l=>l.status==='active');if(active.length===1)return active[0];const now=new Date(),scheduled=state.lessons.filter(l=>l.status==='scheduled'&&new Date(l.starts_at)<=now&&new Date(l.ends_at)>now);return scheduled.length===1?scheduled[0]:null;}
function uploadResource(){dialog('Upload teaching resource',`<form id="upload-form" class="stack"><label>Title<input name="title" required maxlength="180"></label><label>Image, diagram or video<input name="file" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" required></label><p class="help">PNG, JPG, WebP, MP4, WebM or MOV. Maximum 50 MB. MP4 works best across devices.</p><button type="submit" class="primary">Upload resource</button></form>`);$('#upload-form').onsubmit=e=>{e.preventDefault();safely(async()=>{const f=new FormData(e.target),file=f.get('file'),types=['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime'];if(!types.includes(file.type))throw Error('Please choose a supported image or video format.');if(file.size>50*1024*1024)throw Error('The maximum file size is 50 MB.');const resource={id:crypto.randomUUID(),title:f.get('title').trim(),kind:file.type.startsWith('video/')?'video':'image',mime_type:file.type,created_at:new Date().toISOString()};if(!resource.title)throw Error('Enter a title.');if(state.demo){resource.url=URL.createObjectURL(file);state.resources.push(resource);}else{resource.storage_path=`${resource.id}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const {error}=await db.storage.from('teaching-resources').upload(resource.storage_path,file,{contentType:file.type,upsert:false});if(error)throw error;const {error:rowError}=await db.from('resources').insert(resource);if(rowError){await db.storage.from('teaching-resources').remove([resource.storage_path]);throw rowError;}await reloadData();}$('#modal').close();render();toast('Resource uploaded.');});};}
async function resourceUrl(resource){if(state.demo)return resource.url;const {data,error}=await db.storage.from('teaching-resources').createSignedUrl(resource.storage_path,3600);if(error)throw error;return data.signedUrl;}
async function openResource(id,lessonId=null){const r=state.resources.find(x=>x.id===id);if(!r)throw Error('Resource unavailable.');const url=await resourceUrl(r);const current=currentLesson();dialog(r.title,`${r.kind==='video'?`<video class="resource-view" controls playsinline src="${h(url)}"></video>`:`<img class="resource-view" src="${h(url)}" alt="${h(r.title)}">`}${state.role==='admin'?`<div class="section-title"><label>Add to lesson<select id="resource-lesson"><option value="">Select a lesson</option>${state.lessons.filter(l=>l.status!=='cancelled').sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at)).map(l=>`<option value="${l.id}" ${(lessonId||current?.id)===l.id?'selected':''}>${h(pupil(l.pupil_id)?.name)} · ${dateLabel(l.starts_at)} ${clock(l.starts_at)}</option>`).join('')}</select></label><div class="dialog-actions"><button id="attach-resource" class="primary">Add to lesson</button></div><p class="help">The pupil will be able to open this resource from their lesson summary.</p></div>`:''}`);$('#attach-resource')?.addEventListener('click',()=>safely(async()=>{const lesson_id=$('#resource-lesson').value;if(!lesson_id)throw Error('Choose a lesson first.');if(state.links.some(x=>x.lesson_id===lesson_id&&x.resource_id===id)){toast('This resource is already attached.');return;}if(state.demo)state.links.push({id:crypto.randomUUID(),lesson_id,resource_id:id});else{const {error}=await db.from('lesson_resources').insert({lesson_id,resource_id:id});if(error)throw error;await reloadData();}toast('Resource added to lesson.');}));}
function lessonResourceControls(){return `<details class="lesson-resource-editor"><summary>＋ Pin a YouTube video</summary><form id="pin-youtube-form" class="stack"><label>YouTube link<input name="url" type="url" required maxlength="2048" placeholder="https://www.youtube.com/watch?v=…"></label><label>Title<input name="title" maxlength="180" placeholder="e.g. Roundabout positioning"></label><div id="youtube-preview"></div><button type="submit" class="primary">Pin video to lesson</button><p id="youtube-status" class="help" role="status"></p></form></details><details class="lesson-resource-editor"><summary>＋ Pin a library resource</summary><form id="pin-library-form" class="stack"><label>Teaching resource<select name="resource" required><option value="">Select a resource</option>${state.resources.map(r=>`<option value="${r.id}">${h(r.title)}</option>`).join('')}</select></label>${state.resources.length?'':'<p class="help">Upload images, diagrams or videos in the Teaching library first.</p>'}<button type="submit" class="primary" ${state.resources.length?'':'disabled'}>Pin resource to lesson</button><p id="library-pin-status" class="help" role="status"></p></form></details>`;}
function youtubeCard(video,editable=false){
 if(!/^[A-Za-z0-9_-]{11}$/.test(video.video_id))return '';
 return `<article class="lesson-video-card"><a class="youtube-watch" href="https://www.youtube.com/watch?v=${video.video_id}" target="_blank" rel="noopener noreferrer" aria-label="${h(video.title)} — watch on YouTube (opens a new tab)"><div class="youtube-thumbnail"><img src="https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="youtube-play" aria-hidden="true">▶</span><span class="youtube-badge">YouTube</span></div><div class="youtube-caption"><h4>${h(video.title)}</h4><span>Watch on YouTube ↗</span></div></a>${editable?`<button type="button" class="text-button unpin-video" data-unpin-video="${video.id}" aria-label="Unpin ${h(video.title)}">Unpin video</button>`:''}</article>`;
}
function bindThumbnails(root){root?.querySelectorAll('.youtube-thumbnail img').forEach(img=>img.onerror=()=>{img.hidden=true;});}
function showLessonResources(id){
 const links=state.links.filter(x=>x.lesson_id===id),videos=state.videos.filter(v=>v.lesson_id===id&&v.pinned).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
 $('#lesson-resources').innerHTML=links.map(link=>{const r=state.resources.find(r=>r.id===link.resource_id);return r?`<button data-resource="${r.id}" class="list-button">${h(r.title)} <span>Open →</span></button>`:'';}).join('')||(!videos.length?'<p class="help">No resources pinned yet.</p>':'');
 $('#lesson-resources').querySelectorAll('button').forEach(b=>b.onclick=()=>safely(()=>openResource(b.dataset.resource,id)));
 $('#lesson-video-cards').innerHTML=videos.map(v=>youtubeCard(v,state.role==='admin')).join('');bindThumbnails($('#lesson-video-cards'));
 $('#lesson-video-cards').querySelectorAll('[data-unpin-video]').forEach(b=>b.onclick=()=>safely(async()=>{
  if(state.demo)state.videos.find(v=>v.id===b.dataset.unpinVideo).pinned=false;else{await rpc('unpin_lesson_video',{p_id:b.dataset.unpinVideo});await reloadData();}
  if(state.selected===id&&$('#lesson-video-cards'))showLessonResources(id);toast('Video unpinned. Paste its link again to restore it.');
 }));
}
function bindLessonResourceControls(id){
 const form=$('#pin-youtube-form');if(!form)return;
 const preview=()=>{try{$('#youtube-preview').innerHTML=youtubeCard({video_id:youtubeVideoId(form.elements.url.value),title:form.elements.title.value.trim()||'YouTube video'});bindThumbnails($('#youtube-preview'));}catch{$('#youtube-preview').innerHTML='';}};
 form.oninput=preview;
 form.onsubmit=e=>{e.preventDefault();safely(async()=>{
  const result=$('#youtube-status');try{
   const video_id=youtubeVideoId(form.elements.url.value),title=form.elements.title.value.trim()||'YouTube video';
   if(state.demo){const existing=state.videos.find(v=>v.lesson_id===id&&v.video_id===video_id);if(existing)Object.assign(existing,{title,pinned:true});else state.videos.push({id:crypto.randomUUID(),lesson_id:id,video_id,title,pinned:true,created_at:new Date().toISOString()});}
   else{await rpc('pin_lesson_video',{p_lesson_id:id,p_video_id:video_id,p_title:title});await reloadData();}
   if(!form.isConnected)return;showLessonResources(id);form.reset();$('#youtube-preview').innerHTML='';result.textContent='Video pinned. Your pupil can see it in this lesson.';result.className='help';
  }catch(error){if(result.isConnected){result.textContent=error.message;result.className='error-message';}throw error;}
 });};
 const library=$('#pin-library-form');library.onsubmit=e=>{e.preventDefault();safely(async()=>{
  const resource_id=library.elements.resource.value;if(!resource_id)throw Error('Select a resource.');
  if(!state.links.some(l=>l.lesson_id===id&&l.resource_id===resource_id)){
   if(state.demo)state.links.push({id:crypto.randomUUID(),lesson_id:id,resource_id});else{const {error}=await db.from('lesson_resources').insert({lesson_id:id,resource_id});if(error)throw error;await reloadData();}
  }
  if(!library.isConnected)return;showLessonResources(id);$('#library-pin-status').textContent='Resource pinned. Your pupil can see it in this lesson.';
 });};
}

if(!state.demo){try{pointQueue=JSON.parse(sessionStorage.getItem('pending-route-points')||'[]');}catch{pointQueue=[];}}
init();

function registerTools(){
 const context=document.modelContext;if(!context?.registerTool)return;
 const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 const tools=[{name:'list_visible_lessons',title:'List lessons',description:'Read lessons visible to the signed-in account. Does not change records.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({lessons:visibleLessons().map(l=>({id:l.id,pupil:pupil(l.pupil_id)?.name,starts_at:l.starts_at,ends_at:l.ends_at,status:l.status,paid:l.paid}))})},{name:'open_lesson',title:'Open lesson',description:'Open a lesson record without starting the lesson or modifying it.',inputSchema:{type:'object',properties:{lesson_id:{type:'string'}},required:['lesson_id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{if(typeof input?.lesson_id!=='string'||!visibleLessons().some(l=>l.id===input.lesson_id))throw Error('Lesson not found or not accessible');openLesson(input.lesson_id);return {opened:input.lesson_id};}}];
 for(const tool of tools)try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
}

function reviewTravel(id){
 const lesson=state.lessons.find(l=>l.id===id);let previous;
 dialog('Review travel time',`<form id="travel-review" class="stack"><p class="help">The previous booking changed. Update the travel allowance into this lesson.</p><label>Travel allowance<select name="mode"><option value="automatic">Calculate road travel time</option><option value="manual" ${state.demo?'selected':''}>Enter manually</option></select></label><label>Minutes<input name="minutes" type="number" min="0" max="480" value="20" required></label><button class="primary" type="submit">Update travel time</button></form>`);
 $('#travel-review').onsubmit=e=>{e.preventDefault();safely(async()=>{const f=new FormData(e.target);await reloadData();previous=state.lessons.filter(l=>l.id!==id&&l.status!=='cancelled'&&new Date(l.ends_at)<=new Date(lesson.starts_at)).sort((a,b)=>new Date(b.ends_at)-new Date(a.ends_at))[0];const allowance=previous?(f.get('mode')==='automatic'?(await mapRequest({action:'directions',from:previous.dropoff,to:lesson.pickup})).minutes:Number(f.get('minutes'))):0;if(previous&&minutes(previous.ends_at,lesson.starts_at)<allowance)throw Error(`This needs ${allowance} minutes of travel. Cancel and rebook the lesson with enough time.`);if(state.demo){lesson.travel_before_minutes=allowance;lesson.travel_source=f.get('mode');}else{await rpc('update_travel_allowance',{p_id:id,p_previous:previous?.id||null,p_minutes:allowance,p_source:f.get('mode')});await reloadData();}render();openLesson(id);toast('Travel allowance updated.');});};
}
