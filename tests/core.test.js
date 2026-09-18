import test from 'node:test';
import assert from 'node:assert/strict';
import {previousAims,validateBooking,lessonTotals,lessonMiles,routeMiles,splitTrack,weekStart,localDate,skillProgress,detailSkillProgress,detailedSkillGroups} from '../core.js';
const lesson=(id,start,end,extra={})=>({id,pupil_id:'a',starts_at:`2026-09-16T${start}:00Z`,ends_at:`2026-09-16T${end}:00Z`,status:'scheduled',...extra});
test('objectives come from latest earlier completed lesson for the same pupil',()=>{
 const lessons=[lesson('1','08:00','09:00',{status:'completed',next_aims:'Mirrors'}),lesson('2','09:00','10:00',{status:'completed',next_aims:'Roundabouts'}),lesson('3','10:00','11:00',{status:'completed',next_aims:'Wrong pupil',pupil_id:'b'}),lesson('4','16:00','17:00',{status:'completed',next_aims:'Future'})];
 assert.equal(previousAims(lessons,'a','2026-09-16T12:00:00Z'),'Roundabouts');assert.equal(previousAims(lessons,'none','2026-09-16T12:00:00Z'),'');
});
test('booking rejects overlapping lessons and insufficient travel on both sides',()=>{
 const lessons=[lesson('1','09:00','10:00'),lesson('2','12:00','13:00')];
 assert.throws(()=>validateBooking(lesson('n','09:30','10:30'),lessons),/overlaps/);
 assert.throws(()=>validateBooking(lesson('n','10:10','11:00'),lessons,20,20),/at least 20/);
 assert.throws(()=>validateBooking(lesson('n','10:30','11:50'),lessons,20,20),/following lesson/);
 assert.equal(validateBooking(lesson('n','10:20','11:40'),lessons,20,20).next.id,'2');
});
test('cancelled lessons do not block a booking and exact boundaries are allowed',()=>{
 const existing=[lesson('1','09:00','10:00',{status:'cancelled'}),lesson('2','11:00','12:00')];
 assert.doesNotThrow(()=>validateBooking(lesson('n','09:00','11:00'),existing));
 assert.throws(()=>validateBooking(lesson('n','11:00','10:00'),existing),/end must/);
});
test('totals use actual completed lesson duration and odometer miles',()=>{
 const totals=lessonTotals([lesson('a','09:00','11:00',{status:'completed',started_at:'2026-09-16T09:05:00Z',ended_at:'2026-09-16T10:35:00Z',start_mileage:100,end_mileage:121.5}),lesson('b','12:00','14:00')]);
 assert.equal(totals.hours,1.5);assert.equal(totals.miles,21.5);
});
test('route gaps and different lessons are not joined; low accuracy fixes are omitted',()=>{
 const point=(time,lesson_id='a',accuracy=5)=>({recorded_at:`2026-09-16T09:${time}Z`,lesson_id,lat:51,lng:-2,accuracy});
 const segments=splitTrack([point('00:00'),point('00:10'),point('00:20','a',200),point('03:00'),point('03:10','b')]);
 assert.deepEqual(segments.map(s=>s.length),[2,1,1]);
});
test('calendar weeks start on Monday, including Sunday',()=>{
 assert.equal(localDate(weekStart(new Date(2026,8,20))),'2026-09-14');
});

test('GPS mileage uses point distances, skips recording gaps and never joins separate tracks',()=>{
 const p=(lng,seconds,segment_id='a')=>({lat:0,lng,segment_id,recorded_at:new Date(Date.UTC(2026,0,1,0,0,seconds)).toISOString()});
 const oneDegreeMiles=111195.0802335329/1609.344;
 assert.ok(Math.abs(routeMiles([p(0,0),p(1,60)])-oneDegreeMiles)<0.000001);
 assert.equal(routeMiles([p(0,0),p(1,91)]),0);
 assert.equal(routeMiles([p(0,0),p(1,60,'b')]),0);
 assert.equal(routeMiles([p(0,0),p(1,0)]),0);
 assert.equal(routeMiles([p(0,0)]),0);
});
test('GPS mileage replaces rather than adds to odometer miles in completed pupil totals',()=>{
 const log={status:'completed',started_at:'2026-09-16T09:00Z',ended_at:'2026-09-16T11:00Z',start_mileage:100,end_mileage:130,route_distance_miles:27.25};
 assert.equal(lessonTotals([log]).miles,27.25);
 assert.equal(lessonTotals([{...log,start_mileage:null,end_mileage:null}]).miles,27.25);
 assert.equal(lessonMiles({...log,route_distance_miles:0}),0);
 assert.equal(lessonTotals([{...log,status:'scheduled'}]).miles,0);
 assert.equal(lessonMiles({...log,route_distance_miles:null}),30);
});

test('skill progress uses all 108 available points and only the selected pupil',()=>{
 const grades=rating=>Array.from({length:27},(_,i)=>({pupil_id:'a',skill_id:i+1,rating}));
 assert.deepEqual(skillProgress([],'a'),{points:0,maximum:108,percent:0});
 assert.equal(skillProgress(grades(2),'a').percent,50);
 assert.equal(skillProgress(grades(4),'a').percent,100);
 const almost=grades(4);almost[26].rating=3;
 assert.equal(skillProgress(almost,'a').percent,99.1);
 assert.equal(skillProgress([...grades(4),{pupil_id:'b',skill_id:1,rating:4}],'b').percent,3.7);
 assert.equal(skillProgress(grades(4).slice(0,1),'a').points,4);
});

test('detailed syllabus includes all 664 items and progress cannot round up to completion early',()=>{
 assert.equal(detailedSkillGroups.length,36);assert.equal(detailedSkillGroups.reduce((n,g)=>n+g.skills.length,0),664);
 const ratings=detailedSkillGroups.flatMap(g=>g.skills.map((_,i)=>({pupil_id:'a',category_id:g.id,item_id:i+1,rating:4})));
 assert.equal(detailSkillProgress([],'a').maximum,2656);assert.equal(detailSkillProgress(ratings,'a').percent,100);
 ratings.at(-1).rating=3;assert.equal(detailSkillProgress(ratings,'a').percent,99.9);
 assert.equal(detailSkillProgress(ratings,'b').points,0);assert.equal(detailSkillProgress(ratings,'a',1).maximum,64);
 assert.equal(detailSkillProgress([{pupil_id:'a',category_id:1,item_id:1,rating:4}],'a',1).average,.25);
});
