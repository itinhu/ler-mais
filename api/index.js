import admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';

if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
 const credentials=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
 admin.initializeApp({credential:admin.credential.cert(credentials),storageBucket:process.env.FIREBASE_STORAGE_BUCKET||'ler-mais-fluencia.firebasestorage.app'});
}
const db=()=>admin.firestore();
const norm=s=>String(s||'').trim().toLowerCase();
const activities={simples:['BOLA','CASA','GATO','PATO','MESA','LUA','DEDO','BOCA','MALA','SOPA','CAMA','RATO','VELA','FITA','DADO','PIPA','LATA','BOTA','VACA','FOCA'],complexas:['PRATO','BRINCO','FLORESTA','TRILHO','CLARO','GRILO','BLOCO','FRUTA','PLANTA','BRAVO','TROCA','CRAVO','GROSSO','PEDRA','PRIMO','FLAUTA','GRANDE','CHUVA','QUEIJO','NINHO']};
const MAX_BYTES=3_600_000;
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
  if(path==='upload-url'&&req.method==='POST'){
   const access=await studentAccess(String(body.studentId||''),user,email);
   if(!access)return reply(res,403,{error:'Aluno não encontrado ou sem acesso.'});
   const activity=String(body.activity||''),mime=String(body.mime||'').split(';')[0],size=Number(body.size),elapsed=Number(body.elapsed);
   const ext={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg'}[mime];
   if(!activities[activity]||!ext||!Number.isInteger(size)||size<1000||size>MAX_BYTES||!Number.isFinite(elapsed)||elapsed<1||elapsed>65)return reply(res,400,{error:'Áudio ou atividade inválidos (máximo 3,6 MB e 60 segundos).'});
   const recent=await db().collection('evaluations').where('studentId','==',access.doc.id).get();
   const today=new Date().toISOString().slice(0,10);
   if(recent.docs.filter(d=>d.data().uploadedBy===user.uid&&stamp(d.data().createdAt)?.startsWith(today)).length>=15)return reply(res,429,{error:'Limite diário de 15 gravações por aluno e usuário.'});
   const ref=db().collection('evaluations').doc();
   const objectPath='readings/'+access.doc.id+'/'+ref.id+'.'+ext;
   const [url]=await admin.storage().bucket().file(objectPath).getSignedUrl({version:'v4',action:'write',expires:Date.now()+10*60*1000,contentType:mime});
   await ref.set({studentId:access.doc.id,activity,elapsed,mime,size,objectPath,status:'uploading',uploadedBy:user.uid,source:access.isOwner?'school':'home',method:'avaliacao-manual',createdAt:admin.firestore.FieldValue.serverTimestamp()});
   return reply(res,200,{id:ref.id,url,contentType:mime});
  }
  if(path==='finish-upload'&&req.method==='POST'){
   const id=String(body.id||'');if(!/^[\w-]{1,150}$/.test(id))return reply(res,400,{error:'Identificador inválido.'});
   const ref=db().collection('evaluations').doc(id),doc=await ref.get();
   if(!doc.exists||doc.data().uploadedBy!==user.uid)return reply(res,403,{error:'Gravação não autorizada.'});
   const e=doc.data();if(e.status==='pending'||e.status==='reviewed')return reply(res,200,{ok:true});
   if(e.status!=='uploading')return reply(res,409,{error:'Estado inválido.'});
   const [meta]=await admin.storage().bucket().file(e.objectPath).getMetadata();
   const actual=Number(meta.size);
   if(actual<1000||actual>MAX_BYTES||meta.contentType!==e.mime){await admin.storage().bucket().file(e.objectPath).delete({ignoreNotFound:true});return reply(res,400,{error:'Arquivo inválido ou acima do limite.'})}
   await ref.update({status:'pending',size:actual,uploadedAt:admin.firestore.FieldValue.serverTimestamp()});
   return reply(res,200,{ok:true});
  }
  if(path==='audio-url'&&req.method==='GET'){
   const id=String(req.query.id||'');if(!/^[\w-]{1,150}$/.test(id))return reply(res,400,{error:'Identificador inválido.'});
   const doc=await db().collection('evaluations').doc(id).get();
   if(!doc.exists||!doc.data().objectPath||!['pending','reviewed'].includes(doc.data().status))return reply(res,404,{error:'Áudio indisponível.'});
   const access=await studentAccess(doc.data().studentId,user,email);
   if(!access)return reply(res,403,{error:'Sem acesso.'});
   const [url]=await admin.storage().bucket().file(doc.data().objectPath).getSignedUrl({version:'v4',action:'read',expires:Date.now()+5*60*1000});
   return reply(res,200,{url});
  }
  if(path==='review'&&req.method==='POST'){
   const id=String(body.id||'');if(!/^[\w-]{1,150}$/.test(id))return reply(res,400,{error:'Identificador inválido.'});
   const ref=db().collection('evaluations').doc(id),doc=await ref.get();
   if(!doc.exists||!doc.data().objectPath||!['pending','reviewed'].includes(doc.data().status))return reply(res,404,{error:'Gravação não encontrada.'});
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
 }catch(e){console.error('LER+ API:',e?.message);return reply(res,500,{error:'Falha no servidor. Confira se o Firebase Storage está ativado e o bucket configurado.'})}
}
