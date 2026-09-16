import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// Deploy with --no-verify-jwt: identity is explicitly verified with getUser below.
// Set ALLOWED_ORIGIN to the exact GitHub Pages origin; use a separate project for local testing.
Deno.serve(async (request: Request) => {
  const origin = Deno.env.get('ALLOWED_ORIGIN') || '';
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json' };
  const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers});
  if (!origin || request.headers.get('origin') !== origin) return reply({error:'Origin not allowed'},403);
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (request.method!=='POST') return reply({error:'Method not allowed'},405);
  try {
    const auth = request.headers.get('authorization') || '';
    const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user},error} = await client.auth.getUser(auth.replace(/^Bearer\s+/i,''));
    if(error||!user) return reply({error:'Sign in first'},401);
    const role=await client.rpc('is_instructor');
    if(role.error||role.data!==true) return reply({error:'Instructor access required'},403);
    const token=Deno.env.get('MAPBOX_ACCESS_TOKEN');
    if(!token) return reply({error:'Map service is not configured. Enter a manual travel allowance.'},503);
    const raw=await request.text();if(raw.length>5000)return reply({error:'Request too large'},413);
    const body=JSON.parse(raw);
    let url:URL;
    if(body.action==='geocode'){
      if(typeof body.query!=='string'||body.query.trim().length<3||body.query.length>250) return reply({error:'Enter an address or postcode'},400);
      url=new URL('https://api.mapbox.com/search/geocode/v6/forward');
      url.searchParams.set('q',body.query);url.searchParams.set('limit','5');url.searchParams.set('country','gb');
      // These coordinates are stored in bookings, so permanent geocoding is required.
      url.searchParams.set('permanent','true');
    }else if(body.action==='directions'){
      for(const p of [body.from,body.to]) if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)return reply({error:'Invalid coordinates'},400);
      url=new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${body.from.lng},${body.from.lat};${body.to.lng},${body.to.lat}`);
      url.searchParams.set('overview','false');url.searchParams.set('alternatives','false');
    }else return reply({error:'Unknown action'},400);
    url.searchParams.set('access_token',token);
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)return reply({error:'Map provider could not complete the request. Check the address, map account and usage limit.'},502);
    const result=await response.json();
    if(body.action==='geocode')return reply({places:(result.features||[]).map((f:any)=>({label:f.properties.full_address||[f.properties.name,f.properties.place_formatted].filter(Boolean).join(', '),lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]}))});
    const seconds=result.routes?.[0]?.duration;
    if(!Number.isFinite(seconds))return reply({error:'No driving route found. Check the pickup and drop-off.'},422);
    return reply({minutes:Math.ceil(seconds/60)+5});
  }catch{return reply({error:'Map request failed. Try again or use a manual allowance.'},500);}
});
