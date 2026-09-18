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

test('detailed skills have 36 collapsed headings, 664 ratings and read-only pupil detail',()=>{
 const h=harness();h.state.progressPupil='p2';h.state.view='skills';h.state.detailSkills=[{id:'r1',pupil_id:'p2',category_id:1,item_id:1,rating:4,updated_at:new Date().toISOString()},{id:'r2',pupil_id:'p1',category_id:1,item_id:2,rating:3,updated_at:new Date().toISOString()}];
 h.state.skills=[{id:'old',pupil_id:'p2',skill_id:1,rating:2,updated_at:new Date().toISOString()}];
 h.run('render()');let html=h.nodes.get('#content').html;
 assert.equal([...html.matchAll(/data-detail-skill="/g)].length,664);assert.equal([...html.matchAll(/data-category="/g)].length,36);
 assert.doesNotMatch(html,/<details[^>]+ open/);assert.match(html,/skill-row skill-level-4/);assert.match(html,/<progress max="2656" value="4"/);assert.match(html,/36.12 Understanding that passing the test is not the end of learning/);
 assert.match(html,/Previous 27-skill ratings/);
 h.run("previewPupil('p2')");h.state.view='skills';h.run('render()');html=h.nodes.get('#content').html;
 assert.doesNotMatch(html,/<select|data-detail-skill=/);assert.match(html,/4 — Fully independent/);assert.doesNotMatch(html,/3 — Mostly independent/);
 assert.match(html,/0 — Not introduced/);assert.equal(h.run("activitySummary('p2')"),'');
});
test('lesson core skill pins preserve scores until explicitly updated',async()=>{
 const h=harness();h.context.crypto={randomUUID:()=>String(Math.random())};h.state.lessons=[lesson('complete','p2',-1,'completed')];h.state.detailSkills=[{pupil_id:'p2',category_id:1,item_id:1,rating:2}];
 await h.run("saveLessonSkillPin('complete',1)");assert.equal(h.state.skillPins[0].points,2);assert.equal(h.state.skillPins[0].item_count,16);
 h.state.detailSkills[0].rating=4;await h.run("saveLessonSkillPin('complete',1)");assert.equal(h.state.skillPins[0].points,2);
 await h.run("saveLessonSkillPin('complete',1,true)");assert.equal(h.state.skillPins[0].points,4);assert.equal(h.state.skillPins.length,1);
 h.state.role='pupil';h.state.pupilId='p2';await assert.rejects(h.run("saveLessonSkillPin('complete',1,true)"));
 h.run("openLesson('complete')");assert.match(h.nodes.get('#lesson-skills').html,/Saved score: 0.25 \/ 4/);assert.doesNotMatch(h.nodes.get('#lesson-skills').html,/Unpin|Update saved/);
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

test('AI skill review is private to instructor, retains drafts and validates matches',()=>{
 const h=harness();h.state.lessons=[lesson('complete','p2',-1,'completed')];h.state.skillReviews=[{lesson_id:'complete',summary:'Private instructor summary'}];
 h.run("openLesson('complete')");assert.match(h.nodes.get('#modal').html,/Private instructor summary/);assert.match(h.nodes.get('#modal').html,/Find relevant skills sends/);
 h.nodes.get('#skill-review-summary').value='Changed private draft';h.nodes.get('#skill-review-summary').oninput();h.run("openLesson('complete')");assert.match(h.nodes.get('#modal').html,/Changed private draft/);
 assert.throws(()=>h.run("normaliseSkillSuggestions([{skill_id:'1.17',reason:'Bad'}])"));assert.throws(()=>h.run("normaliseSkillSuggestions([{skill_id:'1.1',reason:'x'},{skill_id:'1.1',reason:'x'}])"));
 h.run("previewPupil('p2');openLesson('complete')");assert.doesNotMatch(h.nodes.get('#modal').html,/Private instructor|Changed private|skill-review|suggest-skills/);
});
test('reviewed ratings save only selected skills, are atomic in demo and exclude pupil preview',async()=>{
 const h=harness();h.context.crypto={randomUUID:()=>String(Math.random())};h.state.lessons=[lesson('complete','p2',-1,'completed')];
 h.state.detailSkills=[{pupil_id:'p2',category_id:9,item_id:6,rating:1},{pupil_id:'p2',category_id:19,item_id:10,rating:2}];
 const before=JSON.stringify(h.state.detailSkills);
 await assert.rejects(h.run("applySkillReview('complete',[{category_id:9,item_id:6,rating:2,expected:1},{category_id:19,item_id:10,rating:4,expected:0}])"));assert.equal(JSON.stringify(h.state.detailSkills),before);
 await h.run("applySkillReview('complete',[{category_id:9,item_id:6,rating:2,expected:1}])");assert.equal(h.state.detailSkills.find(r=>r.category_id===9).rating,2);assert.equal(h.state.detailSkills.find(r=>r.category_id===19).rating,2);
 h.run("previewPupil('p2')");await assert.rejects(h.run("applySkillReview('complete',[{category_id:9,item_id:6,rating:4,expected:2}])"));await assert.rejects(h.run("requestSkillSuggestions('complete','some driving summary')"));
});

test('review can pin individual skills with updated ratings and keep private summary out of pupil view',async()=>{
 const h=harness();h.context.crypto={randomUUID:()=>String(Math.random())};h.state.lessons=[lesson('complete','p2',-1,'completed')];
 await h.run("applySkillReview('complete',[{category_id:9,item_id:6,rating:2,expected:0}],[],[{category_id:9,item_id:6}])");
 assert.equal(h.state.detailPins[0].rating,2);assert.equal(h.state.detailPins[0].title,'Mirror checks before slowing');
 await h.run("applySkillReview('complete',[{category_id:9,item_id:6,rating:3,expected:2}],[],[{category_id:9,item_id:6}])");assert.equal(h.state.detailPins[0].rating,2);
 await h.run("applySkillReview('complete',[],[19],[{category_id:19,item_id:10}])");assert.equal(h.state.detailPins.length,2);assert.equal(h.state.skillPins.length,1);
 h.run("previewPupil('p2');openLesson('complete')");assert.match(h.nodes.get('#lesson-skills').html,/9.6 Mirror checks before slowing/);assert.match(h.nodes.get('#lesson-skills').html,/Saved rating: 2 — Often prompted/);assert.doesNotMatch(h.nodes.get('#lesson-skills').html,/Update saved|Unpin/);
 await assert.rejects(h.run("saveLessonDetailPin('complete',9,6,true)"));
});
