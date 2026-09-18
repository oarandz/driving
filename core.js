export function localDate(date = new Date()) {
  const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate()+days); return d; }
export function weekStart(date) { const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; }
export function minutes(a,b) { return (new Date(b)-new Date(a))/60000; }
export function lessonTotals(lessons) {
  return lessons.filter(l=>l.status==='completed').reduce((a,l)=>({hours:a.hours+Math.max(0,minutes(l.started_at,l.ended_at))/60,miles:a.miles+lessonMiles(l)}),{hours:0,miles:0});
}
export function lessonMiles(lesson){return lesson.route_distance_miles!=null?Math.max(0,Number(lesson.route_distance_miles)):Math.max(0,Number(lesson.end_mileage)-Number(lesson.start_mileage));}
export function routeMiles(points){
 let metres=0;const radians=n=>n*Math.PI/180;
 for(const segment of splitTrack(points))for(let i=1;i<segment.length;i++){
  const a=segment[i-1],b=segment[i];if(Date.parse(b.recorded_at)<=Date.parse(a.recorded_at))continue;
  const hav=Math.sin(radians(b.lat-a.lat)/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(radians(b.lng-a.lng)/2)**2;
  metres+=2*6371008.8*Math.asin(Math.sqrt(Math.min(1,Math.max(0,hav))));
 }
 return metres/1609.344;
}
export function previousAims(lessons,pupilId,start) {
  return lessons.filter(l=>l.pupil_id===pupilId && l.status==='completed' && new Date(l.starts_at)<new Date(start)).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at))[0]?.next_aims || '';
}
export function overlaps(a,b) { return new Date(a.starts_at)<new Date(b.ends_at) && new Date(a.ends_at)>new Date(b.starts_at); }
export function validateBooking(candidate,lessons,before=0,after=0) {
  if(!(new Date(candidate.ends_at)>new Date(candidate.starts_at))) throw Error('The end must be after the start.');
  const existing=lessons.filter(l=>l.status!=='cancelled' && l.id!==candidate.id).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  if(existing.some(l=>overlaps(l,candidate))) throw Error('This overlaps another lesson. Choose a different time.');
  const prev=existing.filter(l=>new Date(l.ends_at)<=new Date(candidate.starts_at)).at(-1);
  const next=existing.find(l=>new Date(l.starts_at)>=new Date(candidate.ends_at));
  if(prev && minutes(prev.ends_at,candidate.starts_at)<before) throw Error(`Allow at least ${before} minutes to reach this pickup.`);
  if(next && minutes(candidate.ends_at,next.starts_at)<after) throw Error(`Allow at least ${after} minutes to reach the following lesson.`);
  return {prev,next};
}
export function extractGpxPoints(xml, makeId=()=>crypto.randomUUID()) {
  if(xml.getElementsByTagName('parsererror').length || xml.documentElement?.localName!=='gpx') throw Error('This is not a valid GPX file.');
  const points=[]; let skipped=0,total=0;
  const segments=[...xml.getElementsByTagNameNS('*','trkseg')];
  for(const segment of segments) {
    const segmentId=makeId();
    for(const node of segment.getElementsByTagNameNS('*','trkpt')) {
      total++;
      const latitude=node.getAttribute('lat'),longitude=node.getAttribute('lon');
      const lat=Number(latitude),lng=Number(longitude);
      const time=node.getElementsByTagNameNS('*','time')[0]?.textContent?.trim();
      const timestamp=Date.parse(time);
      if(!latitude?.trim()||!longitude?.trim()||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180||!Number.isFinite(timestamp)){skipped++;continue;}
      points.push({lat,lng,accuracy:0,recorded_at:new Date(timestamp).toISOString(),segment_id:segmentId});
    }
  }
  if(!points.length)throw Error('No GPS track points with valid coordinates and recording times were found in this file. Export the recorded track as GPX.');
  if(points.length>30000)throw Error('The route is too large. Export it with fewer GPS points.');
  points.sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at));
  return {points,skipped,total};
}
export function splitTrack(points) {
  const groups=new Map(),segments=[];
  for(const p of points) {
    if(!Number.isFinite(p.lat)||Math.abs(p.lat)>90||!Number.isFinite(p.lng)||Math.abs(p.lng)>180||p.accuracy>100||!Number.isFinite(Date.parse(p.recorded_at)))continue;
    const key=JSON.stringify([p.lesson_id||'',p.segment_id||'']);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(p);
  }
  for(const group of groups.values()) {
    let segment=[];
    for(const p of group.sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at))) {
      const previous=segment.at(-1);
      if(previous&&Date.parse(p.recorded_at)-Date.parse(previous.recorded_at)>90000){segments.push(segment);segment=[];}
      segment.push(p);
    }
    if(segment.length)segments.push(segment);
  }
  return segments;
}
export const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function youtubeVideoId(value){
 let url;try{url=new URL(value.trim());}catch{throw Error('Paste a full YouTube video link.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw Error('Use a YouTube video link.');
 const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);let id;
 if(host==='youtu.be'&&parts.length===1)id=parts[0];
 else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)){
  if(url.pathname==='/watch')id=url.searchParams.get('v');
  else if(['shorts','live','embed'].includes(parts[0])&&parts.length===2)id=parts[1];
 }else if(['youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)&&parts[0]==='embed'&&parts.length===2)id=parts[1];
 if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw Error('Use a link to a YouTube video, rather than a channel or playlist.');
 return id;
}

// DVSA learning-to-drive record, Crown copyright, Open Government Licence v3.0.
// https://www.gov.uk/government/publications/keep-a-record-of-your-pupils-driving-lessons
// The 0–4 scale below is the instructor's custom scale, not DVSA's five levels.
export const skillLevels=['Not introduced','Always prompted','Often prompted','Mostly independent','Fully independent'];
export const drivingSkillGroups=[
 {name:'Basics',skills:['Legal responsibilities','Safety checks','Cockpit checks','Security']},
 {name:'Control and positioning',skills:['Controls and instruments','Moving away and stopping','Safe positioning']},
 {name:'Observation, signalling and planning',skills:['Mirrors – vision and use','Signals','Anticipation and planning','Use of speed','Other traffic','Fuel-efficient driving']},
 {name:'Junctions, roundabouts and crossings',skills:['Junctions','Roundabouts','Pedestrian crossings']},
 {name:'Manoeuvres',skills:['Reversing','Turning the car around','Parking','Emergency stop']},
 {name:'Road types',skills:['Country roads','Dual carriageways','Motorways']},
 {name:'Driving conditions',skills:['Driving in the dark','Weather conditions','Passengers and loads']},
 {name:'Following routes',skills:['Independent driving and using a sat nav']}
];

export function skillProgress(ratings,pupilId){
 const bySkill=new Map(ratings.filter(r=>r.pupil_id===pupilId&&Number.isInteger(r.skill_id)&&r.skill_id>=1&&r.skill_id<=27&&Number.isInteger(r.rating)&&r.rating>=0&&r.rating<=4).map(r=>[r.skill_id,r.rating]));
 const points=[...bySkill.values()].reduce((sum,rating)=>sum+rating,0);
 return {points,maximum:108,percent:Math.round(points/108*1000)/10};
}
