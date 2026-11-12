const VAPID_PUBLIC_KEY = "BGhnC17c2n1juVj8VrTBIa6Pcdtms6XLPxPgF3Z82DIi4ZQrbe4bbQJjZ-TYN1QsoWNES8oIXgPbEKGYtWqtDkI";
const textEncoder = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\\+/g,"-").replace(/\\//g,"_");
const fromB64u = value => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4)),c=>c.charCodeAt(0));
const concat = (...arrays) => { const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length}return out };
async function hmac(key,data){const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",k,data))}
async function hkdf(ikm,salt,info,length){const prk=await hmac(salt,ikm);let t=new Uint8Array(0),out=new Uint8Array(0),i=1;while(out.length<length){t=await hmac(prk,concat(t,info,new Uint8Array([i++])));out=concat(out,t)}return out.slice(0,length)}
async function vapidToken(endpoint,privateJwk){
 const audience=new URL(endpoint).origin,now=Math.floor(Date.now()/1000);
 const header=b64u(textEncoder.encode(JSON.stringify({typ:"JWT",alg:"ES256"})));
 const payload=b64u(textEncoder.encode(JSON.stringify({aud:audience,exp:now+43200,sub:"mailto:jmerchanp01@educarex.es"})));
 const unsigned=header+"."+payload;
 const key=await crypto.subtle.importKey("jwk",JSON.parse(privateJwk),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
 const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,textEncoder.encode(unsigned));
 return unsigned+"."+b64u(signature);
}
async function encryptPayload(subscription,payload){
 const clientPublic=fromB64u(subscription.p256dh),auth=fromB64u(subscription.auth);
 const clientKey=await crypto.subtle.importKey("raw",clientPublic,{name:"ECDH",namedCurve:"P-256"},false,[]);
 const serverPair=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
 const serverPublic=new Uint8Array(await crypto.subtle.exportKey("raw",serverPair.publicKey));
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:clientKey},serverPair.privateKey,256));
 const ikm=await hkdf(shared,auth,concat(textEncoder.encode("WebPush: info\\0"),clientPublic,serverPublic),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,textEncoder.encode("Content-Encoding: aes128gcm\\0"),16);
 const nonce=await hkdf(ikm,salt,textEncoder.encode("Content-Encoding: nonce\\0"),12);
 const aes=await crypto.subtle.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
 const plain=concat(textEncoder.encode(JSON.stringify(payload)),new Uint8Array([2]));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,tagLength:128},aes,plain));
 const rs=new Uint8Array([0,0,16,0]);
 return concat(salt,rs,new Uint8Array([serverPublic.length]),serverPublic,cipher);
}
async function sendPush(sub,payload,env){
 const jwt=await vapidToken(sub.endpoint,env.VAPID_PRIVATE_JWK);
 const body=await encryptPayload(sub,payload);
 const response=await fetch(sub.endpoint,{method:"POST",headers:{
  "Authorization":"vapid t="+jwt+", k="+VAPID_PUBLIC_KEY,
  "Content-Encoding":"aes128gcm","Content-Type":"application/octet-stream","TTL":"86400","Urgency":"high"
 },body});
 if(response.status===404||response.status===410)return "expired";
 if(!response.ok)throw new Error("Push provider respondió "+response.status);
 return "sent";
}
function madridParts(date){const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);return Object.fromEntries(p.map(x=>[x.type,x.value]))}
function dayDiff(target,today){const [y,m,d]=target.split("-").map(Number),[ty,tm,td]=today.split("-").map(Number);return Math.round((Date.UTC(y,m-1,d)-Date.UTC(ty,tm-1,td))/86400000)}
async function processItem(env,user,subs,item,type,today){
 const days=Array.isArray(item.reminders)?item.reminders:(type==="event"?[1]:[3,1,0]);
 const delta=dayDiff(item.date,today);
 if(!days.includes(delta))return;
 const key=[user.id,type,item.id,delta,item.date].join(":");
 const exists=await env.DB.prepare("SELECT idempotency_key FROM push_sent WHERE idempotency_key=?").bind(key).first();
 if(exists)return;
 const title=type==="exam"?"Próximo examen: "+(item.title||"Examen"):"Mañana tienes un evento: "+(item.title||"Actividad");
 const body=(delta===0?"Es hoy.":delta===1?"Es mañana.":"Faltan "+delta+" días.")+(item.time?" Hora: "+item.time+".":"")+(item.subject?" "+item.subject+".":"");
 let sent=0;
 for(const sub of subs){try{const result=await sendPush(sub,{title,body,url:"/",tag:"miaula-"+type+"-"+item.id},env);if(result==="expired")await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(sub.endpoint).run();else sent++}catch(error){console.error("PUSH_SEND_ERROR",error?.message||error)}}
 if(sent)await env.DB.prepare("INSERT OR IGNORE INTO push_sent (idempotency_key,user_id) VALUES (?,?)").bind(key,user.id).run();
}
export default {
 async scheduled(controller,env,ctx){
  const now=madridParts(new Date());
  if(now.hour!=="08"||now.minute!=="00")return;
  const users=await env.DB.prepare("SELECT u.id,d.payload FROM user_data d JOIN users u ON u.id=d.user_id").all();
  for(const row of users.results||[]){
   let data;try{data=JSON.parse(row.payload)}catch{continue}
   const subsResult=await env.DB.prepare("SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?").bind(row.id).all();
   const subs=subsResult.results||[];if(!subs.length)continue;
   const user={id:row.id};
   for(const exam of data.exams||[])if(exam.date)await processItem(env,user,subs,exam,"exam",now.year+"-"+now.month+"-"+now.day);
   for(const event of data.events||[])if(event.date)await processItem(env,user,subs,event,"event",now.year+"-"+now.month+"-"+now.day);
  }
 }
};