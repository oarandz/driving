import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../core.js';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^init\(\);$/m,'');
function harness(){
 const nodes=new Map();
 function node(id){
  if(nodes.has(id))return nodes.get(id);
  const n={html:'',open:false,dataset:{},addEventListener(event,fn){this['on'+event]=fn;},close(){this.open=false;},showModal(){this.open=true;},querySelectorAll(){return [];}};
  Object.defineProperty(n,'innerHTML',{get(){return this.html;},set(html){this.html=html;for(const m of html.matchAll(/id="([^"]+)"/g))node('#'+m[1]);}});
  nodes.set(id,n);return n;
 }
 for(const id of ['#app','#content','#modal','#toast'])node(id);
 const document={querySelector:s=>nodes.get(s),querySelectorAll:()=>[],addEventListener(){}};
 const context=vm.createContext({...core,h:core.escapeHtml,config:{supabaseUrl:'',currency:'GBP'},document,window:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){},console});
 vm.runInContext(source+'\nglobalThis.testState=state; showSavedRoute=async()=>{}; showLessonResources=()=>{}; bindLessonResourceControls=()=>{};',context);
 return {context,state:context.testState,nodes,run:code=>vm.runInContext(code,context)};
}
function lesson(id,pupil_id,offset,status='scheduled'){
 const start=Date.now()+offset*86400000;
 return {id,pupil_id,starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString(),status,paid:true,fee:40,pickup:{label:'Station'},dropoff:{label:'Station'},objectives:'Practice',improved:'Mirror checks',needs_work:'',other:'',next_aims:'',...(status==='completed'?{started_at:new Date(start).toISOString(),ended_at:new Date(start+3600000).toISOString(),start_mileage:100,end_mileage:110}:{})};
}
test('pupil home selects nearest booking and orders all previous lessons newest first',()=>{
 const h=harness();h.state.role='pupil';h.state.pupilId='p2';h.state.lessons=[lesson('older','p2',-10,'completed'),lesson('later','p2',8),lesson('other-pupil','p1',1),lesson('latest','p2',-1,'completed'),lesson('next','p2',3),lesson('cancelled-future','p2',2,'cancelled'),lesson('unmarked','p2',-2),lesson('active','p2',0,'active')];
 h.run('render()');const html=h.nodes.get('#content').html;
 assert.match(html,/Next lesson/);assert.match(html,/data-lesson="next"/);assert.match(html,/Lesson in progress/);
 assert.doesNotMatch(html,/calendar|data-lesson="later"|other-pupil|cancelled-future/);
 assert.ok(html.indexOf('data-lesson="latest"')<html.indexOf('data-lesson="unmarked"'));
 assert.ok(html.indexOf('data-lesson="unmarked"')<html.indexOf('data-lesson="older"'));
 h.state.lessons=[];h.run('render()');assert.match(h.nodes.get('#content').html,/No next lesson booked/);assert.match(h.nodes.get('#content').html,/No previous lessons/);
});
test('instructor preview shows selected pupil read-only lessons and returns to instructor pupils page',()=>{
 const h=harness();h.state.view='pupils';h.state.lessons=[lesson('own','p2',-1,'completed'),lesson('other','p1',-1,'completed')];
 const before=JSON.stringify(h.state.lessons);h.run("previewPupil('p2')");
 assert.equal(h.state.role,'pupil');assert.equal(h.state.pupilId,'p2');assert.match(h.nodes.get('#app').html,/Viewing as <strong>Jamie Taylor/);assert.match(h.nodes.get('#app').html,/Back to instructor view/);
 assert.doesNotMatch(h.nodes.get('#content').html,/data-lesson="other"/);
 h.run("openLesson('own')");const detail=h.nodes.get('#modal').html;
 assert.match(detail,/Mirror checks/);assert.doesNotMatch(detail,/textarea|Save lesson notes|Mark as|Edit lesson times|Pin a YouTube/);
 h.nodes.get('#notes').onsubmit({preventDefault(){}});assert.equal(JSON.stringify(h.state.lessons),before);
 h.run("openLesson('other')");assert.equal(h.state.selected,'own');
 h.run('exitPupilPreview()');assert.equal(h.state.role,'admin');assert.equal(h.state.view,'pupils');assert.equal(h.state.pupilPreview,null);
 assert.match(h.nodes.get('#content').html,/data-preview-pupil="p2"/);assert.doesNotMatch(h.nodes.get('#app').html,/Back to instructor view/);
});
test('pupil accounts cannot enter instructor preview',()=>{
 const h=harness();h.state.role='pupil';h.state.pupilId='p1';h.run("previewPupil('p2');exitPupilPreview()");
 assert.equal(h.state.pupilId,'p1');assert.equal(h.state.role,'pupil');assert.equal(h.state.pupilPreview,null);
});

test('skill page has 27 instructor controls and pupil ratings are read-only and isolated',()=>{
 const h=harness();h.state.progressPupil='p2';h.state.view='skills';h.state.skills=[{id:'r1',pupil_id:'p2',skill_id:1,rating:4,updated_at:new Date().toISOString()},{id:'r2',pupil_id:'p1',skill_id:2,rating:3,updated_at:new Date().toISOString()}];
 h.run('render()');let html=h.nodes.get('#content').html;
 assert.equal([...html.matchAll(/data-skill="/g)].length,27);assert.match(html,/27\. Independent driving and using a sat nav/);
 h.run("previewPupil('p2')");h.state.view='skills';h.run('render()');html=h.nodes.get('#content').html;
 assert.doesNotMatch(html,/<select|data-skill=/);assert.match(html,/4 — Fully independent/);assert.doesNotMatch(html,/3 — Mostly independent/);
 assert.match(html,/0 — Not introduced/);assert.equal(h.run("activitySummary('p2')"),'');
});
test('activity recording excludes demo, instructor, preview and hidden pages; repeated interaction is throttled',async()=>{
 const h=harness();h.context.activityCalls=[];h.run("rpc=async name=>{activityCalls.push(name);}");
 h.state.role='pupil';h.state.pupilId='p1';await h.run('trackPupilActivity()');assert.equal(h.context.activityCalls.length,0);
 h.state.demo=false;h.state.role='admin';await h.run('trackPupilActivity()');assert.equal(h.context.activityCalls.length,0);
 h.state.role='pupil';h.state.pupilPreview={};await h.run('trackPupilActivity()');assert.equal(h.context.activityCalls.length,0);
 h.state.pupilPreview=null;h.context.document.hidden=true;await h.run('trackPupilActivity()');assert.equal(h.context.activityCalls.length,0);
 h.context.document.hidden=false;await h.run('trackPupilActivity()');await h.run('trackPupilActivity()');assert.equal(h.context.activityCalls.length,1);
 h.run('activityAttemptAt=0');await h.run('trackPupilActivity()');assert.equal(h.context.activityCalls.length,2);
});
