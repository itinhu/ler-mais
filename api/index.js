import admin from 'firebase-admin';
import OpenAI, { toFile } from 'openai';

if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))});
}
const db = () => {if(!admin.apps.length) throw new Error('Servidor sem Firebase configurado'); return admin.firestore()};
const norm = s => String(s||'').trim().toLowerCase();
const activities = {
 simples:['BOLA','CASA','GATO','PATO','MESA','LUA','DEDO','BOCA','MALA','SOPA','CAMA','RATO','VELA','FITA','DADO','PIPA','LATA','BOTA','VACA','FOCA'],
 complexas:['PRATO','BRINCO','FLORESTA','TRILHO','CLARO','GRILO','BLOCO','FRUTA','PLANTA','BRAVO','TROCA','CRAVO','GROSSO','PEDRA','PRIMO','FLAUTA','GRANDE','CHUVA','QUEIJO','NINHO']
};
const clean = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z\s]/g,' ').trim().split(/\s+/).filter(Boolean);
function align(expected, heard) {
 const n=expected.length,m=heard.length, dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=expected[i]===heard[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 let i=0,j=0, matched=[]; while(i<n&&j<m){if(expected[i]===heard[j]){matched.push(i);i++;j++}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++}
 return {correct:matched.length, matched, possibleErrors:expected.filter((_,idx)=>!matched.includes(idx))};
}
function reply(res,code,obj){res.status(code).setHeader('Cache-Control','no-store').json(obj)}
async function parse(req){if(typeof req.body==='object')return req.body||{};try{return JSON.parse(req.body||'{}')}catch{return {}}}
export default async function handler(req,res){
 try{
  if(!admin.apps.length)return reply(res,503,{error:'Configure FIREBASE_SERVICE_ACCOUNT_JSON na Vercel.'});
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)return reply(res,401,{error:'Faça login primeiro.'});
  const user=await admin.auth().verifyIdToken(token);
  const email=norm(user.email); if(!email||!user.email_verified)return reply(res,403,{error:'Confirme seu e-mail antes de continuar.'});
  const path=req.url.split('?')[0].replace(/^\/api\/?/,'');
  const body=await parse(req);
  if(path==='setup'&&req.method==='POST'){
   if(body.role!=='teacher')return reply(res,400,{error:'Papel inválido'});
   const allowed=(process.env.TEACHER_EMAILS||'').split(',').map(norm).filter(Boolean);
   if(!allowed.includes(email))return reply(res,403,{error:'Cadastro de professor não autorizado. Solicite acesso à escola.'});
   await db().collection('teachers').doc(user.uid).set({email,createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
   return reply(res,200,{ok:true});
  }
  const isTeacher=(await db().collection('teachers').doc(user.uid).get()).exists;
  if(path==='students'&&req.method==='GET'){
   const snap=isTeacher?await db().collection('students').where('teacherUid','==',user.uid).get():await db().collection('students').where('parentEmail','==',email).get();
   return reply(res,200,{role:isTeacher?'teacher':'family',students:snap.docs.map(d=>({id:d.id,...d.data()}))});
  }
  if(path==='students'&&req.method==='POST'){
   if(!isTeacher)return reply(res,403,{error:'Apenas professores podem cadastrar.'});
   const name=String(body.name||'').trim(), parentEmail=norm(body.parentEmail), className=String(body.className||'').trim();
   if(name.length<2||name.length>100||!/^\S+@\S+\.\S+$/.test(parentEmail)||className.length>50)return reply(res,400,{error:'Preencha nome, turma e e-mail válido do responsável.'});
   const ref=await db().collection('students').add({name,parentEmail,className,teacherUid:user.uid,createdAt:admin.firestore.FieldValue.serverTimestamp()});
   return reply(res,201,{id:ref.id});
  }
  if(path==='evaluations'&&req.method==='GET'){
   const studentId=String(req.query.studentId||'');const student=await db().collection('students').doc(studentId).get();
   if(!student.exists)return reply(res,404,{error:'Aluno não encontrado.'});
   const s=student.data();if(s.teacherUid!==user.uid&&s.parentEmail!==email)return reply(res,403,{error:'Sem acesso.'});
   const snap=await db().collection('evaluations').where('studentId','==',studentId).get();
   return reply(res,200,{evaluations:snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?._seconds||0)-(a.createdAt?._seconds||0))});
  }
  if(path==='analyze'&&req.method==='POST'){
   const studentId=String(body.studentId||''),activity=String(body.activity||''),words=activities[activity];
   if(!words)return reply(res,400,{error:'Atividade inválida.'});
   const student=await db().collection('students').doc(studentId).get();if(!student.exists)return reply(res,404,{error:'Aluno não encontrado.'});
   const s=student.data();if(s.teacherUid!==user.uid&&s.parentEmail!==email)return reply(res,403,{error:'Sem acesso.'});
   const mime=String(body.mime||'audio/webm').split(';')[0];
   const ext={'audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav'}[mime];
   if(!ext)return reply(res,400,{error:'Formato de áudio não aceito.'});
   const b64=String(body.audioBase64||'');if(!/^[a-zA-Z0-9+/]*={0,2}$/.test(b64)||b64.length>5_000_000)return reply(res,413,{error:'Áudio inválido ou muito grande (limite ~3,5 MB).'});
   const buffer=Buffer.from(b64,'base64');if(buffer.length<1000||buffer.length>3_600_000)return reply(res,413,{error:'Gravação fora do tamanho permitido.'});
   const elapsed=Number(body.elapsed);if(!Number.isFinite(elapsed)||elapsed<1||elapsed>65)return reply(res,400,{error:'Tempo inválido.'});
   if(!process.env.OPENAI_API_KEY)return reply(res,503,{error:'Configure OPENAI_API_KEY na Vercel.'});
   const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
   const transcription=await client.audio.transcriptions.create({model:'gpt-4o-transcribe',file:await toFile(buffer,`leitura.${ext}`,{type:mime}),language:'pt',prompt:`Leitura escolar em português brasileiro. Lista esperada: ${words.join(', ')}.`});
   const heard=clean(transcription.text),expected=words.flatMap(clean);
   const scored=align(expected,heard), correct=scored.correct, pcpm=Math.round(correct*60/elapsed*10)/10;
   const evaluation={studentId,activity,elapsed,correct,total:expected.length,pcpm,accuracy:Math.round(correct/expected.length*100),transcript:transcription.text,possibleErrors:scored.possibleErrors,method:'transcricao-alinhamento-automatico',needsReview:true,createdAt:admin.firestore.FieldValue.serverTimestamp()};
   const ref=await db().collection('evaluations').add(evaluation);
   return reply(res,200,{id:ref.id,...evaluation,createdAt:new Date().toISOString(),note:'Estimativa automática: revisão pedagógica recomendada.'});
  }
  return reply(res,404,{error:'Rota não encontrada.'});
 }catch(e){console.error('API error',e?.message);return reply(res,500,{error:'Não foi possível concluir. Verifique a configuração ou tente novamente.'})}
}
