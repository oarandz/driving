export function localDate(date = new Date()) {
  const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate()+days); return d; }
export function weekStart(date) { const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; }
export function minutes(a,b) { return (new Date(b)-new Date(a))/60000; }
export function lessonTotals(lessons) {
  return lessons.filter(l=>l.status==='completed').reduce((a,l)=>({hours:a.hours+Math.max(0,minutes(l.started_at,l.ended_at))/60,miles:a.miles+Math.max(0,Number(l.end_mileage)-Number(l.start_mileage))}),{hours:0,miles:0});
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
export function splitTrack(points) {
  const segments=[]; let segment=[];
  for(const p of [...points].sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at))) {
    if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.accuracy>100) continue;
    const prev=segment.at(-1);
    if(prev && (new Date(p.recorded_at)-new Date(prev.recorded_at)>90000 || p.lesson_id!==prev.lesson_id)) { if(segment.length) segments.push(segment);segment=[]; }
    segment.push(p);
  }
  if(segment.length) segments.push(segment); return segments;
}
export const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
