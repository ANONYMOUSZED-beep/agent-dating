import fs from 'fs';
const c = JSON.parse(fs.readFileSync('scripts/candidates.json'));
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const out=[];
for (const [li,ig] of c){
  let r={li,ig};
  try{ const x=await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${ig}`,{headers:{'x-ig-app-id':'936619743392459','User-Agent':UA}});
    r.igStatus=x.status; if(x.ok){const u=(await x.json()).data?.user; r.igName=u?.full_name; r.igPrivate=u?.is_private; r.igFollowers=u?.edge_followed_by?.count; fs.writeFileSync(`data/raw/ig_${ig}.json`,JSON.stringify(u));}}catch(e){r.igErr=e.message}
  try{ const x=await fetch(`https://www.linkedin.com/in/${li}`,{headers:{'User-Agent':UA,'Accept-Language':'en-US'}});
    r.liStatus=x.status; const h=await x.text(); const m=h.match(/<title>([^<]*)/); r.liTitle=m?.[1]?.slice(0,60); r.liLd=h.includes('application/ld+json'); if(r.liLd) fs.writeFileSync(`data/raw/li_${li}.html`,h);}catch(e){r.liErr=e.message}
  console.log(JSON.stringify(r)); out.push(r);
  await new Promise(s=>setTimeout(s,700));
}
fs.writeFileSync('scripts/verify_out.json',JSON.stringify(out,null,1));
