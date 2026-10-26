import admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';

if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
 const credentials=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
 admin.initializeApp({credential:admin.credential.cert(credentials),storageBucket:process.env.FIREBASE_STORAGE_BUCKET||'ler-mais-fluencia.firebasestorage.app'});
}
const db=()=>admin.firestore();
const norm=s=>String(s||'').trim().toLowerCase();
const activities={simples:['BOLA','CASA','GATO','PATO','MESA','LUA','DEDO','BOCA','MALA','SOPA','CAMA','RATO','VELA','FITA','DADO','PIPA','LATA','BOTA','VACA','FOCA'],complexas:['PRATO','BRINCO','FLORESTA','TRILHO','CLARO','GRILO','BLOCO','FRUTA','PLANTA','BRAVO','TROCA','CRAVO','GROSSO','PEDRA','PRIMO','FLAUTA','GRANDE','CHUVA','QUEIJO','NINHO']};
const MAX_BYTES=2_500_000;
const driveConfigured=()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REFRESH_TOKEN);
async function driveToken(){
 if(!driveConfigured())throw Error('Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN.');
 const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params});
 const j=await r.json();if(!r.ok||!j.access_token)throw Error('Falha na autorização do Google Drive: '+(j.error||r.status));
 return j.access_token;
}
async function driveRequest(url,options={}){
 const token=await driveToken();
 const headers={Authorization:'Bearer '+token,...options.headers};
 const r=await fetch(url,{...options,headers});
 if(!r.ok)throw Error('Google Drive respondeu '+r.status+': '+(await r.text()).slice(0,250));
 return r;
}
async function driveFolder(){
 const ref=db().collection('settings').doc('driveStorage');
 const snap=await ref.get();if(snap.exists&&snap.data().folderId)return snap.data().folderId;
 const r=await driveRequest('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'LER+ - Gravações',mimeType:'application/vnd.google-apps.folder'})});
 const data=await r.json();if(!data.id)throw Error('Não foi possível criar a pasta do Drive.');
 await ref.set({folderId:data.id,createdAt:admin.firestore.FieldValue.serverTimestamp()});
 return data.id;
}
async function driveUpload(buffer,mime,name){
 const folderId=await driveFolder();
 const boundary='ler'+randomUUID().replaceAll('-','');
 const meta=JSON.stringify({name,parents:[folderId],description:'Gravação de leitura do LER+'});
 const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: '+mime+'\r\n\r\n'),buffer,Buffer.from('\r\n--'+boundary+'--')]);
 const r=await driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size,mimeType',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
 return r.json();
}

function reply(res,status,data){res.setHeader('Cache-Control','no-store');return res.status(status).json(data)}
async function parse(req){if(typeof req.body==='object')return req.body||{};try{return JSON.parse(req.body||'{}')}catch{return {}}}
function stamp(x){return x?.toDate?.()?.toISOString?.()||null}
function serialize(d){const x=d.data();return {id:d.id,...x,createdAt:stamp(x.createdAt),reviewedAt:stamp(x.reviewedAt)}}
async function studentAccess(id,user,email){if(!/^[\w-]{1,150}$/.test(id))return null;const doc=await db().collection('students').doc(id).get();if(!doc.exists)return null;const s=doc.data();return (s.teacherUid===user.uid||s.parentEmail===email)?{doc,s,isOwner:s.teacherUid===user.uid}:null}
export default async function handler(req,res){
 try{
  if(!admin.apps.length)return reply(res,503,{error:'Configure FIREBASE_SERVICE_ACCOUNT_JSON na Vercel.'});
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)return reply(res,401,{error:'Faça login primeiro.'});
  const user=await admin.auth().verifyIdToken(token);
  const email=norm(user.email);
  if(!email||!user.email_verified)return reply(res,403,{error:'Confirme seu e-mail.'});
  const path=req.url.split('?')[0].replace(/^\/api\/?/,'');
  const body=await parse(req);
  if(path==='setup'&&req.method==='POST'){
   if(body.role!=='teacher')return reply(res,400,{error:'Papel inválido.'});
   const allowed=(process.env.TEACHER_EMAILS||'').split(',').map(norm);
   if(!allowed.includes(email))return reply(res,403,{error:'Professor não autorizado.'});
   await db().collection('teachers').doc(user.uid).set({email,createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
   return reply(res,200,{ok:true});
  }
  const isTeacher=(await db().collection('teachers').doc(user.uid).get()).exists;
  if(path==='students'&&req.method==='GET'){
   const snap=isTeacher?await db().collection('students').where('teacherUid','==',user.uid).get():await db().collection('students').where('parentEmail','==',email).get();
   return reply(res,200,{role:isTeacher?'teacher':'family',students:snap.docs.map(serialize)});
  }
  if(path==='students'&&req.method==='POST'){
   if(!isTeacher)return reply(res,403,{error:'Apenas professores podem cadastrar.'});
   const name=String(body.name||'').trim(),parentEmail=norm(body.parentEmail),className=String(body.className||'').trim();
   if(name.length<2||name.length>100||!/^\S+@\S+\.\S+$/.test(parentEmail)||!className||className.length>50)return reply(res,400,{error:'Preencha nome, turma e e-mail válido.'});
   const ref=await db().collection('students').add({name,parentEmail,className,teacherUid:user.uid,createdAt:admin.firestore.FieldValue.serverTimestamp()});
   return reply(res,201,{id:ref.id});
  }
  if(path==='evaluations'&&req.method==='GET'){
   const access=await studentAccess(String(req.query.studentId||''),user,email);
   if(!access)return reply(res,403,{error:'Aluno não encontrado ou sem acesso.'});
   const snap=await db().collection('evaluations').where('studentId','==',access.doc.id).get();
   return reply(res,200,{evaluations:snap.docs.map(serialize).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))});
  }
  if(path==='upload-drive'&&req.method==='POST'){
   if(!driveConfigured())return reply(res,503,{error:'Google Drive ainda não foi autorizado. Configure as variáveis OAuth na Vercel.'});
   const access=await studentAccess(String(body.studentId||''),user,email);
   if(!access)return reply(res,403,{error:'Aluno não encontrado ou sem acesso.'});
   const activity=String(body.activity||''),mime=String(body.mime||'').split(';')[0],elapsed=Number(body.elapsed),b64=String(body.audioBase64||'');
   const ext={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg'}[mime];
   if(!activities[activity]||!ext||!Number.isFinite(elapsed)||elapsed<1||elapsed>65||!b64||b64.length>3_350_000||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b64))return reply(res,400,{error:'Gravação inválida. Máximo 60 segundos e 2,5 MB.'});
   const buffer=Buffer.from(b64,'base64');
   if(buffer.length<1000||buffer.length>MAX_BYTES)return reply(res,413,{error:'Áudio fora do limite de 2,5 MB.'});
   const recent=await db().collection('evaluations').where('studentId','==',access.doc.id).get();
   const today=new Date().toISOString().slice(0,10);
   if(recent.docs.filter(d=>d.data().uploadedBy===user.uid&&stamp(d.data().createdAt)?.startsWith(today)).length>=15)return reply(res,429,{error:'Limite diário de 15 gravações por aluno e usuário.'});
   const id=randomUUID();
   const file=await driveUpload(buffer,mime,id+'.'+ext);
   if(!file.id)return reply(res,502,{error:'Google Drive não retornou identificador do arquivo.'});
   await db().collection('evaluations').doc(id).set({studentId:access.doc.id,activity,elapsed,mime,size:buffer.length,driveFileId:file.id,status:'pending',uploadedBy:user.uid,source:access.isOwner?'school':'home',method:'avaliacao-manual',createdAt:admin.firestore.FieldValue.serverTimestamp()});
   return reply(res,201,{id,ok:true});
  }
  if(path==='audio-drive'&&req.method==='GET'){
   const id=String(req.query.id||'');if(!/^[\w-]{1,150}$/.test(id))return reply(res,400,{error:'Identificador inválido.'});
   const doc=await db().collection('evaluations').doc(id).get();
   if(!doc.exists||!doc.data().driveFileId||!['pending','reviewed'].includes(doc.data().status))return reply(res,404,{error:'Áudio indisponível.'});
   const access=await studentAccess(doc.data().studentId,user,email);
   if(!access)return reply(res,403,{error:'Sem acesso.'});
   const file=await driveRequest('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(doc.data().driveFileId)+'?alt=media');
   const bytes=Buffer.from(await file.arrayBuffer());
   if(bytes.length>MAX_BYTES)return reply(res,413,{error:'Arquivo maior que o permitido.'});
   return reply(res,200,{mime:doc.data().mime,audioBase64:bytes.toString('base64')});
  }
  if(path==='review'&&req.method==='POST'){
   const id=String(body.id||'');if(!/^[\w-]{1,150}$/.test(id))return reply(res,400,{error:'Identificador inválido.'});
   const ref=db().collection('evaluations').doc(id),doc=await ref.get();
   if(!doc.exists||!doc.data().driveFileId||!['pending','reviewed'].includes(doc.data().status))return reply(res,404,{error:'Gravação não encontrada.'});
   const access=await studentAccess(doc.data().studentId,user,email);
   if(!isTeacher||!access?.isOwner)return reply(res,403,{error:'Somente o professor responsável pode avaliar.'});
   const total=Number(body.total),errors=Number(body.errors),notes=String(body.notes||'').trim();
   if(!Number.isInteger(total)||total<0||total>500||!Number.isInteger(errors)||errors<0||errors>total||notes.length>2000)return reply(res,400,{error:'Informe quantidades válidas de palavras e erros.'});
   const correct=total-errors,elapsed=Number(doc.data().elapsed),pcpm=Math.round(correct*60/elapsed*10)/10,accuracy=total?Math.round(correct/total*1000)/10:0;
   await ref.update({total,errors,correct,pcpm,accuracy,notes,status:'reviewed',reviewedBy:user.uid,reviewedAt:admin.firestore.FieldValue.serverTimestamp(),needsReview:false});
   return reply(res,200,{ok:true,pcpm,accuracy,correct});
  }
  if(path==='analyze')return reply(res,410,{error:'Transcrição automática desativada. Use a avaliação manual.'});
  return reply(res,404,{error:'Rota não encontrada.'});
 }catch(e){console.error('LER+ API:',e?.message);return reply(res,500,{error:'Falha no servidor. Confira a autorização e as configurações do Google Drive.'})}
}
