import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendEmailVerification,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
const $=id=>document.getElementById(id),cfg=window.LER_FIREBASE_CONFIG;
const words={simples:['BOLA','CASA','GATO','PATO','MESA','LUA','DEDO','BOCA','MALA','SOPA','CAMA','RATO','VELA','FITA','DADO','PIPA','LATA','BOTA','VACA','FOCA'],complexas:['PRATO','BRINCO','FLORESTA','TRILHO','CLARO','GRILO','BLOCO','FRUTA','PLANTA','BRAVO','TROCA','CRAVO','GROSSO','PEDRA','PRIMO','FLAUTA','GRANDE','CHUVA','QUEIJO','NINHO']};
let auth,students=[],role='family',recording,recorder,stream,chunks=[],seconds=60,tick,started,elapsed=60;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(t){$('message').textContent=t;$('message').classList.add('visible');setTimeout(()=>$('message').classList.remove('visible'),6500)}
async function api(path,method='GET',body){const token=await auth.currentUser.getIdToken();const res=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'Erro no servidor');return data}
function showTab(tab){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==tab));document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab))}
async function loadStudents(){const data=await api('students');students=data.students;role=data.role;$('roleHint').textContent=role==='teacher'?'Cadastre alunos e vincule o e-mail do responsável.':'Você vê somente alunos vinculados ao seu e-mail pelo professor.';$('studentForm').classList.toggle('hidden',role!=='teacher');$('welcome').textContent=role==='teacher'?'Painel do professor':'Painel da família';$('teacherActivation').classList.toggle('hidden',role==='teacher');$('totalStudents').textContent=students.length;$('studentList').innerHTML=students.map(s=>`<div class="student"><strong>${escapeHTML(s.name)}</strong> — ${escapeHTML(s.className)}<br><small>${role==='teacher'?'Responsável: '+escapeHTML(s.parentEmail):'Leitura em casa'}</small></div>`).join('')||'<p>Nenhum aluno vinculado ainda.</p>';for(const id of ['historyStudent','readingStudent']){$(id).innerHTML='<option value="">Selecione...</option>'+students.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)} — ${escapeHTML(s.className)}</option>`).join('')}}
async function history(){
 const id=$('historyStudent').value;if(!id){$('history').textContent='Selecione um aluno.';return}
 try{
  const {evaluations}=await api('evaluations?studentId='+encodeURIComponent(id));
  const reviewed=evaluations.filter(e=>e.status==='reviewed'||(!e.objectPath&&e.pcpm!==undefined));
  $('totalReadings').textContent=reviewed.length;
  $('averagePcpm').textContent=reviewed.length?(reviewed.reduce((a,x)=>a+Number(x.pcpm||0),0)/reviewed.length).toFixed(1):'—';
  $('history').innerHTML=evaluations.map(e=>{
   const reviewed=e.status==='reviewed',pending=e.status==='pending',old=!e.objectPath;
   if(e.status==='uploading')return '';
   const status=reviewed?'Avaliada':pending?'Aguardando avaliação':'Avaliação antiga';
   const details=reviewed||old?'<p>'+Number(e.pcpm||0).toFixed(1)+' PCPM · '+Number(e.accuracy||0)+'% de precisão</p>':'';
   const play=e.objectPath?'<button type="button" class="outline listen" data-id="'+escapeHTML(e.id)+'">▶ Ouvir áudio</button>':'';
   const form=role==='teacher'&&e.objectPath?'<div class="review"><label>Palavras lidas<input type="number" min="0" max="500" id="total-'+escapeHTML(e.id)+'" value="'+(e.total??'')+'"></label><label>Erros<input type="number" min="0" max="500" id="errors-'+escapeHTML(e.id)+'" value="'+(e.errors??0)+'"></label><label>Observações<textarea id="notes-'+escapeHTML(e.id)+'" maxlength="2000">'+escapeHTML(e.notes||'')+'</textarea></label><button type="button" class="save-review" data-id="'+escapeHTML(e.id)+'">Salvar avaliação</button></div>':'';
   return '<article><strong>'+escapeHTML(e.activity||'Leitura')+'</strong> · '+status+'<small>'+escapeHTML(e.createdAt?new Date(e.createdAt).toLocaleDateString('pt-BR'):'Data indisponível')+' · '+(e.source==='home'?'Em casa':'Na escola')+'</small>'+details+play+form+'</article>'
  }).join('')||'<p>Nenhuma gravação até o momento.</p>';
  $('history').querySelectorAll('.listen').forEach(b=>b.onclick=()=>listen(b.dataset.id,b));
  $('history').querySelectorAll('.save-review').forEach(b=>b.onclick=()=>review(b.dataset.id));
 }catch(e){toast(e.message)}
}

function drawWords(){$('wordGrid').innerHTML=words[$('activity').value].map(w=>`<div>${w}</div>`).join('')}
function resetRecording(){recording=null;$('analyze').classList.add('hidden');$('playback').classList.add('hidden');$('result').innerHTML='';$('start').disabled=false;$('stop').disabled=true;$('timer').textContent='60 s';seconds=60;elapsed=60}
async function start(){if(!$('readingStudent').value)return toast('Selecione um aluno.');if(!navigator.mediaDevices?.getUserMedia)return toast('Seu navegador não oferece gravação. Abra pelo HTTPS.');try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const options=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));if(!options)throw Error('Formato de áudio não suportado');recorder=new MediaRecorder(stream,{mimeType:options,audioBitsPerSecond:32000});chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=()=>{recording=new Blob(chunks,{type:recorder.mimeType});$('playback').src=URL.createObjectURL(recording);$('playback').classList.remove('hidden');$('analyze').classList.remove('hidden');stream.getTracks().forEach(t=>t.stop())};recorder.start();started=Date.now();seconds=60;$('timer').textContent='60 s';$('start').disabled=true;$('stop').disabled=false;$('analyze').classList.add('hidden');$('result').innerHTML='';tick=setInterval(()=>{seconds=Math.max(0,60-Math.floor((Date.now()-started)/1000));$('timer').textContent=seconds+' s';if(!seconds)stop()},250)}catch(e){toast('Não foi possível acessar o microfone: '+e.message);stream?.getTracks().forEach(t=>t.stop())}}
function stop(){clearInterval(tick);elapsed=Math.min(60,Math.max(1,(Date.now()-started)/1000));if(recorder?.state==='recording')recorder.stop();$('stop').disabled=true}
async function sendRecording(){
 if(!recording)return toast('Grave a leitura primeiro.');
 const studentId=$('readingStudent').value,activity=$('activity').value;
 $('analyze').disabled=true;$('result').textContent='Enviando gravação com segurança...';
 try{
  const mime=recording.type.split(';')[0];
  const ticket=await api('upload-url','POST',{studentId,activity,elapsed,mime,size:recording.size});
  const response=await fetch(ticket.url,{method:'PUT',headers:{'Content-Type':ticket.contentType},body:recording});
  if(!response.ok)throw Error('Falha no envio ao armazenamento ('+response.status+').');
  await api('finish-upload','POST',{id:ticket.id});
  $('result').textContent='Gravação enviada! O professor poderá ouvi-la e avaliar posteriormente.';
  toast('Gravação salva com sucesso.');await historyIfSelected(studentId);
 }catch(e){$('result').textContent='Erro ao enviar: '+e.message}
 finally{$('analyze').disabled=false}
}
async function historyIfSelected(id){if($('historyStudent').value===id)await history()}
async function listen(id,button){
 try{button.disabled=true;const data=await api('audio-url?id='+encodeURIComponent(id));const audio=document.createElement('audio');audio.controls=true;audio.src=data.url;button.replaceWith(audio);audio.play().catch(()=>{})}catch(e){toast(e.message);button.disabled=false}
}
async function review(id){
 const total=Number($('total-'+id).value),errors=Number($('errors-'+id).value),notes=$('notes-'+id).value;
 try{await api('review','POST',{id,total,errors,notes});toast('Avaliação salva.');await history()}catch(e){toast(e.message)}
}

if(!cfg||String(cfg.apiKey).startsWith('SUBSTITUA')){$('configWarning').classList.remove('hidden');$('auth').classList.add('hidden')}else{
 auth=getAuth(initializeApp(cfg));
 $('register').onclick=async()=>{try{const u=await createUserWithEmailAndPassword(auth,$('email').value,$('password').value);await sendEmailVerification(u.user);toast('Conta criada! Confirme o e-mail recebido e entre novamente.');await signOut(auth)}catch(e){toast(e.message)}};
 $('login').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('email').value,$('password').value)}catch(e){toast('Não foi possível entrar: '+e.message)}};
 $('logout').onclick=()=>signOut(auth);
 onAuthStateChanged(auth,async user=>{if(!user){$('auth').classList.remove('hidden');$('app').classList.add('hidden');$('logout').classList.add('hidden');return}await user.reload();if(!user.emailVerified){toast('Confirme seu e-mail antes de entrar.');await signOut(auth);return}$('auth').classList.add('hidden');$('app').classList.remove('hidden');$('logout').classList.remove('hidden');try{await loadStudents()}catch(e){toast(e.message)}});
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('studentForm').onsubmit=async e=>{e.preventDefault();try{await api('students','POST',{name:$('studentName').value,className:$('className').value,parentEmail:$('parentEmail').value});$('studentForm').reset();await loadStudents();toast('Aluno cadastrado. O responsável poderá acessar com esse e-mail.')}catch(e){toast(e.message)}};
$('historyStudent').onchange=history;$('activity').onchange=()=>{if(recorder?.state==='recording')stop();resetRecording();drawWords()};$('readingStudent').onchange=resetRecording;$('start').onclick=start;$('stop').onclick=stop;$('analyze').onclick=sendRecording;drawWords();
const activate=document.createElement('button');activate.className='outline';activate.textContent='Sou professor: ativar meu painel';activate.onclick=async()=>{if(!confirm('Ativar perfil de professor nesta conta?'))return;try{await api('setup','POST',{role:'teacher'});await loadStudents();toast('Painel do professor ativado.')}catch(e){toast(e.message)}};activate.id='teacherActivation';document.querySelector('#dashboard').appendChild(activate);
