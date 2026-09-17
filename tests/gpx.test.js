import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGpxPoints,splitTrack} from '../core.js';
// Minimal parsed XML nodes: real XML parsing is checked in the browser with a GPX file.
const point=(lat,lon,time)=>({getAttribute:key=>({lat,lon}[key]??null),getElementsByTagNameNS:(_ns,key)=>key==='time'&&time!==undefined?[{textContent:time}]:[]});
const xml=(segments,{invalid=false,root='gpx'}={})=>({documentElement:{localName:root},getElementsByTagName:()=>invalid?[{}]:[],getElementsByTagNameNS:()=>segments.map(points=>({getElementsByTagNameNS:()=>points}))});
test('full GPX recording is preserved without clipping to a lesson or changing timestamps',()=>{
 const tracks=Array.from({length:566},(_,i)=>point('51.0',String(-2+i/100000),new Date(Date.parse('2026-09-17T08:34:39Z')+i*7200).toISOString()));
 const result=extractGpxPoints(xml([tracks]),()=> 'segment-a');
 assert.equal(result.points.length,566);assert.equal(result.skipped,0);
 assert.equal(result.points[0].recorded_at,'2026-09-17T08:34:39.000Z');assert.equal(result.points.at(-1).recorded_at,tracks.at(-1).getElementsByTagNameNS('*','time')[0].textContent);
});
test('GPX segment breaks are preserved even when timestamps are close or overlap',()=>{
 let n=0;const p=()=>point('51','-2','2026-09-17T09:00:00Z');
 const {points}=extractGpxPoints(xml([[p(),p()],[p(),p()]]),()=>String(++n));
 assert.deepEqual(splitTrack(points).map(group=>group.length),[2,2]);
});
test('invalid coordinates, missing attributes and invalid times are counted and excluded',()=>{
 const result=extractGpxPoints(xml([[point(null,'-2','2026-09-17T09:00Z'),point('91','-2','2026-09-17T09:00Z'),point('51','-2','invalid'),point('51','-2'),point('0','0','2026-09-17T09:00Z')]]));
 assert.equal(result.points.length,1);assert.equal(result.skipped,4);assert.equal(result.points[0].lat,0);
});
test('bad XML and files without timed tracks give an actionable error',()=>{
 assert.throws(()=>extractGpxPoints(xml([],{invalid:true})),/not a valid GPX/);
 assert.throws(()=>extractGpxPoints(xml([],{root:'html'})),/not a valid GPX/);
 assert.throws(()=>extractGpxPoints(xml([[point('51','-2')]])),/No GPS track points/);
});
test('map lines stay separate for overlapping lessons and imported recordings',()=>{
 const p=(lesson_id,segment_id,sec)=>({lesson_id,segment_id,lat:51,lng:-2,accuracy:0,recorded_at:`2026-09-17T09:00:${sec}Z`});
 const segments=splitTrack([p('a','one','00'),p('a','two','01'),p('a','one','02'),p('a','two','03'),p('b','one','01')]);
 assert.deepEqual(segments.map(g=>g.length),[2,2,1]);assert.equal(segments[0].every(p=>p.segment_id==='one'),true);
});
