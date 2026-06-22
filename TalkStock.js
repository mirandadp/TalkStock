// ══════════════════════════════════════════════
// ROLES Y PERMISOS
// ══════════════════════════════════════════════
const ROLES = {
  admin:     { label:'Administrador', color:'#f1c40f', cls:'role-admin',     emoji:'👑' },
  encargado: { label:'Encargado',     color:'#4f8ef7', cls:'role-encargado', emoji:'🔑' },
  operario:  { label:'Operario',      color:'#2ecc71', cls:'role-operario',  emoji:'👷' }
};

// Permisos por rol
const CAN = {
  verPrecios:    r => r==='admin'||r==='encargado',
  verPedidos:    r => r==='admin'||r==='encargado',
  crearPedidos:  r => r==='admin'||r==='encargado',
  aprobarPedidos:r => r==='admin',
  gestionAdmin:  r => r==='admin',
  moverStock:    r => true,
  verMovimientos:r => true
};

let currentUser = null; // { id, nombre, rol, pin }

function getCurrentUser(){ return currentUser; }
function hasPermiso(perm){ return currentUser && CAN[perm]?.(currentUser.rol); }

// ══════════════════════════════════════════════
// INDEXEDDB
// ══════════════════════════════════════════════
let db;
const DB_NAME='StockVozDB', DB_VER=4;

function initDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('materiales')) d.createObjectStore('materiales',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('ubicaciones')) d.createObjectStore('ubicaciones',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('movimientos')){
        const mv=d.createObjectStore('movimientos',{keyPath:'id',autoIncrement:true});
        mv.createIndex('synced','synced',{unique:false});
      }
      if(!d.objectStoreNames.contains('usuarios')) d.createObjectStore('usuarios',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('pedidos')) d.createObjectStore('pedidos',{keyPath:'id',autoIncrement:true});
    };
    req.onsuccess=e=>{db=e.target.result;res(db);};
    req.onerror=()=>rej(req.error);
  });
}
function dbTx(store,mode,fn){
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,mode), s=tx.objectStore(store), req=fn(s);
    req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error);
  });
}
const dbGetAll=store=>dbTx(store,'readonly',s=>s.getAll());
const dbAdd=(store,data)=>dbTx(store,'readwrite',s=>s.add(data));
const dbPut=(store,data)=>dbTx(store,'readwrite',s=>s.put(data));
const dbDelete=(store,key)=>dbTx(store,'readwrite',s=>s.delete(key));
function dbClear(store){return new Promise(res=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=res;});}

// ══════════════════════════════════════════════
// LOGIN / USUARIOS
// ══════════════════════════════════════════════
let pinBuffer='';

async function initLogin(){
  const usuarios=await dbGetAll('usuarios');
  if(!usuarios.length){
    // Primera vez — mostrar setup
    document.getElementById('user-select-wrap').style.display='none';
    document.getElementById('first-setup').style.display='block';
    return;
  }
  const sel=document.getElementById('login-user-sel');
  sel.innerHTML='<option value="">— Seleccionar —</option>';
  usuarios.forEach(u=>{
    const opt=document.createElement('option');
    opt.value=u.id; opt.textContent=u.nombre+' ('+ROLES[u.rol].emoji+')';
    sel.appendChild(opt);
  });
  // Auto-login si hay sesión guardada
  const saved=localStorage.getItem('sv_session');
  if(saved){
    try{
      const s=JSON.parse(saved);
      const u=usuarios.find(x=>x.id===s.id);
      if(u){ doLogin(u); return; }
    }catch(e){}
  }
}

async function createFirstAdmin(){
  const n=document.getElementById('setup-nombre').value.trim();
  const p=document.getElementById('setup-pin').value.trim();
  if(!n){toast('Escribe tu nombre','error');return;}
  if(!/^\d{4}$/.test(p)){toast('El PIN debe ser 4 dígitos','error');return;}
  await dbAdd('usuarios',{nombre:n,rol:'admin',pin:p,creado:new Date().toISOString(),synced:0});
  toast('✓ Administrador creado. Accede ahora.','success');
  setTimeout(()=>initLogin(),600);
  document.getElementById('first-setup').style.display='none';
  document.getElementById('user-select-wrap').style.display='block';
}

function onUserSelect(){
  const id=parseInt(document.getElementById('login-user-sel').value);
  if(!id){document.getElementById('pin-section').style.display='none';return;}
  document.getElementById('pin-section').style.display='block';
  document.getElementById('user-select-wrap').style.display='none';
  document.getElementById('login-title-text').textContent='Introduce tu PIN';
  pinBuffer='';
  renderPinDots();
  // Mostrar badge de rol
  dbGetAll('usuarios').then(us=>{
    const u=us.find(x=>x.id===id);
    if(u){
      const r=ROLES[u.rol];
      document.getElementById('login-role-badge').innerHTML=`<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
    }
  });
}

function backToUserSelect(){
  document.getElementById('pin-section').style.display='none';
  document.getElementById('user-select-wrap').style.display='block';
  document.getElementById('login-title-text').textContent='Selecciona usuario';
  document.getElementById('login-user-sel').value='';
  pinBuffer='';
}

function pinPress(d){
  if(pinBuffer.length>=4)return;
  pinBuffer+=d;
  renderPinDots();
  if(pinBuffer.length===4) setTimeout(checkPin,200);
}
function pinDel(){ if(pinBuffer.length>0){pinBuffer=pinBuffer.slice(0,-1);renderPinDots();} }
function renderPinDots(){
  for(let i=0;i<4;i++) document.getElementById('pd'+i).className='pin-dot'+(i<pinBuffer.length?' filled':'');
}

async function checkPin(){
  const id=parseInt(document.getElementById('login-user-sel').value);
  const usuarios=await dbGetAll('usuarios');
  const u=usuarios.find(x=>x.id===id);
  if(u&&u.pin===pinBuffer){
    doLogin(u);
  } else {
    toast('PIN incorrecto','error');
    pinBuffer='';
    renderPinDots();
  }
}

function doLogin(u){
  currentUser=u;
  localStorage.setItem('sv_session',JSON.stringify({id:u.id}));
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').style.display='flex';
  updateTopbarUser();
  applyRoleUI();
  renderAll();
  if(initSupabase()){startRealtime();scheduleSyncSoon();}
  updateNetStatus();
}

function doLogout(){
  closeModal('userMenuModal');
  currentUser=null;
  localStorage.removeItem('sv_session');
  document.getElementById('app').style.display='none';
  document.getElementById('login-screen').classList.remove('hidden');
  pinBuffer='';
  renderPinDots();
  backToUserSelect();
  initLogin();
}

function updateTopbarUser(){
  if(!currentUser)return;
  const r=ROLES[currentUser.rol];
  document.getElementById('topbar-avatar').textContent=currentUser.nombre.charAt(0).toUpperCase();
  document.getElementById('topbar-avatar').style.background=r.color+'33';
  document.getElementById('topbar-avatar').style.color=r.color;
  document.getElementById('topbar-name').textContent=currentUser.nombre;
}

function applyRoleUI(){
  if(!currentUser)return;
  const rol=currentUser.rol;
  // Pedidos: visible a encargado y admin
  document.getElementById('nav-ped').style.display=CAN.verPedidos(rol)?'':'none';
  // Admin: solo admin
  document.getElementById('nav-admin').style.display=CAN.gestionAdmin(rol)?'':'none';
}

function showUserMenu(){
  if(!currentUser)return;
  const r=ROLES[currentUser.rol];
  document.getElementById('um-avatar').textContent=currentUser.nombre.charAt(0).toUpperCase();
  document.getElementById('um-avatar').style.background=r.color+'33';
  document.getElementById('um-avatar').style.color=r.color;
  document.getElementById('um-name').textContent=currentUser.nombre;
  document.getElementById('um-role').innerHTML=`<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
  document.getElementById('userMenuModal').classList.add('open');
}

function showChangePinModal(){
  closeModal('userMenuModal');
  showConfirmModal('Cambiar PIN',
    `<div class="form-group"><label>PIN actual</label><input type="password" id="pin-old" maxlength="4" inputmode="numeric" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);width:100%;"></div>
     <div class="form-group"><label>Nuevo PIN</label><input type="password" id="pin-new" maxlength="4" inputmode="numeric" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);width:100%;"></div>`,
    async()=>{
      const old=document.getElementById('pin-old').value;
      const nw=document.getElementById('pin-new').value;
      if(old!==currentUser.pin){toast('PIN actual incorrecto','error');return;}
      if(!/^\d{4}$/.test(nw)){toast('El PIN debe ser 4 dígitos','error');return;}
      currentUser.pin=nw; currentUser.synced=0;
      await dbPut('usuarios',currentUser);
      toast('✓ PIN actualizado','success');
      scheduleSyncSoon();
    },'Guardar');
}

// ══════════════════════════════════════════════
// SUPABASE SYNC
// ══════════════════════════════════════════════
let SB=null, rtChannel=null, syncBusy=false;

const SETUP_SQL=`-- StockVoz — SQL para Supabase (pega y ejecuta en SQL Editor)

create table if not exists ubicaciones(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,tipo text default 'almacen',creado timestamptz default now(),updated_at timestamptz default now());
create table if not exists materiales(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,cantidad numeric default 0,unidad text default 'ud',precio numeric default 0,minimo numeric default 0,proveedor text,ubicacion_id uuid references ubicaciones(id),creado timestamptz default now(),updated_at timestamptz default now());
create table if not exists movimientos(id uuid primary key default gen_random_uuid(),local_id integer,tipo text not null,cantidad numeric not null,material_id uuid references materiales(id),ubicacion_id uuid references ubicaciones(id),fecha timestamptz default now(),usuario text,nota text,created_at timestamptz default now());
create table if not exists usuarios(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,rol text default 'operario',pin text,creado timestamptz default now(),updated_at timestamptz default now());
create table if not exists pedidos(id uuid primary key default gen_random_uuid(),local_id integer,proveedor text,estado text default 'pendiente',notas text,lineas jsonb,total numeric default 0,creado_por text,fecha timestamptz default now(),updated_at timestamptz default now());

create or replace function update_updated_at() returns trigger as $$ begin new.updated_at=now();return new;end;$$ language plpgsql;
do $$ begin if not exists(select 1 from pg_trigger where tgname='trg_ubic_upd') then create trigger trg_ubic_upd before update on ubicaciones for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_mat_upd') then create trigger trg_mat_upd before update on materiales for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_usr_upd') then create trigger trg_usr_upd before update on usuarios for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_ped_upd') then create trigger trg_ped_upd before update on pedidos for each row execute function update_updated_at();end if;end$$;

alter table ubicaciones enable row level security;alter table materiales enable row level security;alter table movimientos enable row level security;alter table usuarios enable row level security;alter table pedidos enable row level security;
do $$ begin if not exists(select 1 from pg_policies where tablename='ubicaciones' and policyname='public_all') then create policy public_all on ubicaciones for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='materiales' and policyname='public_all') then create policy public_all on materiales for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='movimientos' and policyname='public_all') then create policy public_all on movimientos for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='usuarios' and policyname='public_all') then create policy public_all on usuarios for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='pedidos' and policyname='public_all') then create policy public_all on pedidos for all using(true) with check(true);end if;end$$;

alter publication supabase_realtime add table movimientos;
alter publication supabase_realtime add table materiales;
alter publication supabase_realtime add table pedidos;`.trim();

function getSBConfig(){return{url:localStorage.getItem('sb_url')||'',key:localStorage.getItem('sb_key')||''};}
function initSupabase(){const{url,key}=getSBConfig();if(!url||!key)return false;try{SB=window.supabase.createClient(url,key);return true;}catch(e){return false;}}

async function syncNow(){
  if(!navigator.onLine){toast('Sin conexión','error');return;}
  if(!SB&&!initSupabase()){toast('⚙️ Configura Supabase en Admin → ☁️','error');return;}
  if(syncBusy)return;syncBusy=true;
  try{
    const[ubics,mats,movs,users,peds]=await Promise.all([dbGetAll('ubicaciones'),dbGetAll('materiales'),dbGetAll('movimientos'),dbGetAll('usuarios'),dbGetAll('pedidos')]);
    // push ubicaciones
    for(const u of ubics.filter(x=>!x.synced)){
      const{data,error}=await SB.from('ubicaciones').upsert({nombre:u.nombre,tipo:u.tipo,local_id:u.id,creado:u.creado},{onConflict:'local_id'}).select().single();
      if(!error&&data){u.synced=1;u.remote_id=data.id;await dbPut('ubicaciones',u);}
    }
    const ubicsSynced=await dbGetAll('ubicaciones');
    // push materiales
    for(const m of mats.filter(x=>!x.synced)){
      const ub=ubicsSynced.find(u=>u.id===m.ubicacionId);
      const{data,error}=await SB.from('materiales').upsert({nombre:m.nombre,cantidad:m.cantidad,unidad:m.unidad||'ud',precio:m.precio||0,minimo:m.minimo||0,proveedor:m.proveedor||'',local_id:m.id,ubicacion_id:ub?.remote_id||null,creado:m.creado},{onConflict:'local_id'}).select().single();
      if(!error&&data){m.synced=1;m.remote_id=data.id;await dbPut('materiales',m);}
    }
    const matsSynced=await dbGetAll('materiales');
    // push movimientos
    let pushed=0;
    for(const mv of movs.filter(x=>!x.synced)){
      const mt=matsSynced.find(m=>m.id===mv.materialId);const ub=ubicsSynced.find(u=>u.id===mv.ubicacionId);
      const{error}=await SB.from('movimientos').upsert({tipo:mv.tipo,cantidad:mv.cantidad,nota:mv.nota||'',fecha:mv.fecha,usuario:mv.usuario||'',local_id:mv.id,material_id:mt?.remote_id||null,ubicacion_id:ub?.remote_id||null},{onConflict:'local_id'});
      if(!error){mv.synced=1;await dbPut('movimientos',mv);pushed++;}
    }
    // push usuarios
    for(const u of users.filter(x=>!x.synced)){
      const{data,error}=await SB.from('usuarios').upsert({nombre:u.nombre,rol:u.rol,pin:u.pin,local_id:u.id,creado:u.creado},{onConflict:'local_id'}).select().single();
      if(!error&&data){u.synced=1;u.remote_id=data.id;await dbPut('usuarios',u);}
    }
    // push pedidos
    for(const p of peds.filter(x=>!x.synced)){
      const{error}=await SB.from('pedidos').upsert({proveedor:p.proveedor||'',estado:p.estado,notas:p.notas||'',lineas:p.lineas||[],total:p.total||0,creado_por:p.creadoPor||'',fecha:p.fecha,local_id:p.id},{onConflict:'local_id'});
      if(!error){p.synced=1;await dbPut('pedidos',p);}
    }
    if(pushed>0)toast(`☁️ ${pushed} movimientos subidos`,'success');
    await pullRemoteData();
  }catch(e){toast('Error sync: '+(e.message||e),'error');}
  finally{syncBusy=false;updateSyncBadge();updateStats();}
}

async function pullRemoteData(){
  if(!SB)return;
  const lastPull=localStorage.getItem('last_pull')||'1970-01-01T00:00:00Z';
  try{
    const{data:rU}=await SB.from('ubicaciones').select('*').gt('updated_at',lastPull);
    if(rU?.length){const l=await dbGetAll('ubicaciones');for(const ru of rU){if(!l.find(u=>u.remote_id===ru.id||u.id===ru.local_id))await dbAdd('ubicaciones',{nombre:ru.nombre,tipo:ru.tipo,remote_id:ru.id,local_id:ru.local_id,synced:1,creado:ru.creado});}}
    const{data:rM}=await SB.from('materiales').select('*').gt('updated_at',lastPull);
    if(rM?.length){const lm=await dbGetAll('materiales');const lu=await dbGetAll('ubicaciones');for(const rm of rM){const ex=lm.find(m=>m.remote_id===rm.id||m.id===rm.local_id);if(ex){ex.cantidad=rm.cantidad;ex.precio=rm.precio||0;ex.remote_id=rm.id;ex.synced=1;await dbPut('materiales',ex);}else{const ub=lu.find(u=>u.remote_id===rm.ubicacion_id);await dbAdd('materiales',{nombre:rm.nombre,cantidad:rm.cantidad,unidad:rm.unidad,precio:rm.precio||0,minimo:rm.minimo,proveedor:rm.proveedor||'',remote_id:rm.id,local_id:rm.local_id,ubicacionId:ub?.id||null,synced:1,creado:rm.creado});}}}
    const{data:rMv}=await SB.from('movimientos').select('*').gt('created_at',lastPull);
    if(rMv?.length){const lmv=await dbGetAll('movimientos');const lmt=await dbGetAll('materiales');const lub=await dbGetAll('ubicaciones');for(const rm of rMv){if(!lmv.find(m=>m.local_id===rm.local_id&&rm.local_id)){const mt=lmt.find(m=>m.remote_id===rm.material_id);const ub=lub.find(u=>u.remote_id===rm.ubicacion_id);await dbAdd('movimientos',{tipo:rm.tipo,cantidad:rm.cantidad,nota:rm.nota,fecha:rm.fecha,usuario:rm.usuario,local_id:rm.local_id,materialId:mt?.id||null,ubicacionId:ub?.id||null,synced:1});}}}
    const{data:rUs}=await SB.from('usuarios').select('*').gt('updated_at',lastPull);
    if(rUs?.length){const lu=await dbGetAll('usuarios');for(const ru of rUs){const ex=lu.find(u=>u.remote_id===ru.id||u.id===ru.local_id);if(ex){ex.nombre=ru.nombre;ex.rol=ru.rol;ex.pin=ru.pin;ex.remote_id=ru.id;ex.synced=1;await dbPut('usuarios',ex);}else{await dbAdd('usuarios',{nombre:ru.nombre,rol:ru.rol,pin:ru.pin,remote_id:ru.id,local_id:ru.local_id,synced:1,creado:ru.creado});}}}
    const{data:rP}=await SB.from('pedidos').select('*').gt('updated_at',lastPull);
    if(rP?.length){const lp=await dbGetAll('pedidos');for(const rped of rP){const ex=lp.find(p=>p.local_id===rped.local_id&&rped.local_id);if(ex){ex.estado=rped.estado;ex.synced=1;await dbPut('pedidos',ex);}else if(!ex){await dbAdd('pedidos',{proveedor:rped.proveedor,estado:rped.estado,notas:rped.notas,lineas:rped.lineas,total:rped.total,creadoPor:rped.creado_por,fecha:rped.fecha,local_id:rped.local_id,synced:1});}}}
    localStorage.setItem('last_pull',new Date().toISOString());
    renderAll();
  }catch(e){console.error('pull',e);}
}

function startRealtime(){
  if(!SB||rtChannel)return;
  rtChannel=SB.channel('sv-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'movimientos'},()=>{toast('🔄 Actualización recibida','');pullRemoteData();})
    .on('postgres_changes',{event:'*',schema:'public',table:'materiales'},()=>pullRemoteData())
    .on('postgres_changes',{event:'*',schema:'public',table:'pedidos'},()=>{pullRemoteData();renderPedidos();})
    .on('postgres_changes',{event:'*',schema:'public',table:'usuarios'},()=>pullRemoteData())
    .subscribe(st=>{const el=document.getElementById('rt-status');if(!el)return;el.textContent=st==='SUBSCRIBED'?'🟢 Tiempo real activo':'🔴 '+st;el.style.color=st==='SUBSCRIBED'?'var(--success)':'var(--danger)';});
}
function stopRealtime(){if(rtChannel&&SB){SB.removeChannel(rtChannel);rtChannel=null;}}

function saveSupabaseConfig(){
  const url=document.getElementById('sb-url').value.trim();
  const key=document.getElementById('sb-key').value.trim();
  if(!url||!key){toast('Rellena URL y API Key','error');return;}
  localStorage.setItem('sb_url',url);localStorage.setItem('sb_key',key);
  SB=null;stopRealtime();
  if(initSupabase()){toast('✓ Supabase conectado','success');startRealtime();syncNow();renderSyncScreen();}
  else toast('Error al conectar','error');
}
function clearSupabaseConfig(){
  showConfirmModal('Desconectar Supabase','<p style="font-size:13px;color:var(--text2);">Los datos locales se conservan. Solo se elimina la conexión remota.</p>',()=>{
    localStorage.removeItem('sb_url');localStorage.removeItem('sb_key');localStorage.removeItem('last_pull');
    stopRealtime();SB=null;toast('Desconectado','success');renderSyncScreen();
  });
}
function renderSyncScreen(){
  const{url,key}=getSBConfig(); const c=!!(url&&key);
  const ue=document.getElementById('sb-url'),ke=document.getElementById('sb-key');
  if(ue)ue.value=c?'':url; if(ke)ke.value='';
  const ce=document.getElementById('sb-connected'),fe=document.getElementById('sb-form');
  if(ce)ce.style.display=c?'block':'none'; if(fe)fe.style.display=c?'none':'block';
  const su=document.getElementById('sb-url-show');if(su&&c)su.textContent=url;
}
function copySetupSQL(){
  navigator.clipboard.writeText(SETUP_SQL).then(()=>toast('✓ SQL copiado','success')).catch(()=>{const ta=document.createElement('textarea');ta.value=SETUP_SQL;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('✓ SQL copiado','success');});
}
let syncTimer;
function scheduleSyncSoon(){if(!SB)return;clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,1800);}

// ══════════════════════════════════════════════
// VOZ
// ══════════════════════════════════════════════
let recognition=null,isRecording=false,lastParsed=null;
const ENTRADA_KW=['entrada','entrar','recibir','recibido','llega','llegó','añadir','agregar','meter','mete','ingresa','ingreso'];
const SALIDA_KW=['salida','salir','sacar','saca','usar','uso','consumir','quitar','retirar','gasta','gastado'];
const MOVER_KW=['mover','mueve','trasladar','pasar','pasa'];
const BUSCAR_KW=['buscar','busca','stock','cantidad','cuanto','cuánto','quedan','hay'];
const PEDIR_KW=['pedir','pide','pedido','solicitar','solicita','comprar'];

function initVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){document.querySelector('.voice-hero p').textContent='⚠️ Usa Chrome en Android para voz.';return;}
  recognition=new SR();recognition.lang='es-ES';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=3;
  recognition.onresult=e=>{let int='',fin='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)fin+=t;else int+=t;}const text=fin||int;showVoiceText(text,!fin);if(fin)parseVoiceCommand(fin.trim());};
  recognition.onerror=e=>{stopVoice();if(e.error==='no-speech')toast('Sin audio','error');else if(e.error==='not-allowed')toast('Micrófono no permitido','error');else toast('Error: '+e.error,'error');};
  recognition.onend=()=>stopVoice();
}
function toggleVoice(){isRecording?stopVoice():startVoice();}
function startVoice(){if(!recognition){toast('Voz no disponible','error');return;}recognition.start();isRecording=true;document.getElementById('micBtn').classList.add('recording');document.getElementById('voiceText').textContent='🎙️ Escuchando...';document.getElementById('voiceText').classList.remove('placeholder');}
function stopVoice(){if(recognition&&isRecording)try{recognition.stop();}catch(e){}isRecording=false;document.getElementById('micBtn').classList.remove('recording');}
function showVoiceText(text,interim){const el=document.getElementById('voiceText');el.textContent=interim?'🎙️ '+text+'...':text;el.classList.remove('placeholder');}
function norm(s){return(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();}

function parseVoiceCommand(text){
  const t=norm(text);
  let tipo=null,isMover=false,isBuscar=false,isPedir=false;
  if(MOVER_KW.some(k=>t.includes(k)))isMover=true;
  else if(BUSCAR_KW.some(k=>t.startsWith(k)||t.includes(' '+k)))isBuscar=true;
  else if(PEDIR_KW.some(k=>t.startsWith(k)||t.includes(' '+k)))isPedir=true;
  else if(ENTRADA_KW.some(k=>t.startsWith(k)||t.includes(' '+k)))tipo='entrada';
  else if(SALIDA_KW.some(k=>t.startsWith(k)||t.includes(' '+k)))tipo='salida';
  if(!tipo&&!isMover&&!isBuscar&&!isPedir){showParsedResult({error:true,msg:'No se entendió. Di "entrada", "salida", "buscar", "pedir" o "mover" al inicio.'});return;}
  const numMatch=t.match(/(\d+(?:[.,]\d+)?)/);
  const cantidad=numMatch?parseFloat(numMatch[1].replace(',','.')):null;
  let matText=t,ubicOrigen=null,ubicDest=null;
  [...ENTRADA_KW,...SALIDA_KW,...MOVER_KW,...BUSCAR_KW,...PEDIR_KW].forEach(k=>{matText=matText.replace(new RegExp('\\b'+k+'\\b','g'),' ');});
  if(isMover){const m=matText.match(/(.+?)\s+de\s+(.+?)\s+a\s+(.+)/);if(m){matText=m[1];ubicOrigen=m[2].trim();ubicDest=m[3].trim();}}
  else{const m=matText.match(/\s+(?:en|de)\s+(.+)$/);if(m){ubicOrigen=m[1].trim();matText=matText.replace(m[0],'');}}
  if(cantidad!==null)matText=matText.replace(/\d+(?:[.,]\d+)?/,'');
  matText=matText.replace(/\b(unidades?|ud|uds|kg|metros?|litros?|piezas?)\b/gi,'').replace(/\s+/g,' ').trim();
  if(isBuscar){searchMaterialVoice(matText||text);return;}
  if(isPedir){voicePedir(matText,cantidad);return;}
  if(!matText||matText.length<2){showParsedResult({error:true,msg:'No entendí el material. Di el nombre claramente.'});return;}
  lastParsed={tipo:isMover?'mover':tipo,cantidad:cantidad||1,material:matText,ubicacion:ubicOrigen,ubicacionDestino:ubicDest,original:text};
  showParsedResult(lastParsed);
}

function showParsedResult(result){
  const el=document.getElementById('parsedResult');el.style.display='block';
  if(result.error){el.innerHTML=`<div class="result-card" style="border-left-color:var(--warn);"><h3>⚠️ No entendido</h3><p style="font-size:13px;color:var(--text2);">${result.msg}</p><button class="btn btn-secondary" style="margin-top:8px;" onclick="clearVoice()">Intentar de nuevo</button></div>`;return;}
  const cls=result.tipo==='entrada'?'entrada':result.tipo==='salida'?'salida':'';
  const badge=result.tipo==='entrada'?'<span class="tipo-badge badge-entrada">↑ ENTRADA</span>':result.tipo==='salida'?'<span class="tipo-badge badge-salida">↓ SALIDA</span>':'<span class="tipo-badge" style="background:rgba(79,142,247,.15);color:var(--accent);">⇄ MOVER</span>';
  el.innerHTML=`<div class="result-card ${cls}"><h3>Movimiento detectado</h3>
    <div class="result-row"><span>Tipo</span><span class="val">${badge}</span></div>
    <div class="result-row"><span>Cantidad</span><span class="val">${result.cantidad}</span></div>
    <div class="result-row"><span>Material</span><span class="val">${result.material}</span></div>
    ${result.ubicacion?`<div class="result-row"><span>${result.tipo==='mover'?'Origen':'Ubicación'}</span><span class="val">${result.ubicacion}</span></div>`:''}
    ${result.ubicacionDestino?`<div class="result-row"><span>Destino</span><span class="val">${result.ubicacionDestino}</span></div>`:''}
    <div class="result-row"><span style="font-size:11px;color:var(--text3);font-style:italic;">"${result.original}"</span></div>
  </div>
  <div class="btn-row"><button class="btn btn-secondary" onclick="clearVoice()">✕</button><button class="btn btn-success" onclick="confirmVoiceAction()">✓ Confirmar</button></div>`;
}

function clearVoice(){document.getElementById('voiceText').textContent='Pulsa el micrófono para hablar';document.getElementById('voiceText').classList.add('placeholder');document.getElementById('parsedResult').style.display='none';lastParsed=null;}

async function searchMaterialVoice(query){
  const mats=await dbGetAll('materiales'),q=norm(query);
  const found=mats.filter(m=>norm(m.nombre).includes(q));
  const el=document.getElementById('parsedResult');el.style.display='block';
  const canVerPrecios=hasPermiso('verPrecios');
  if(!found.length){el.innerHTML=`<div class="result-card" style="border-left-color:var(--warn);"><h3>Sin resultados</h3><p style="font-size:13px;color:var(--text2);">No se encontró: "${query}"</p><button class="btn btn-secondary" style="margin-top:8px;" onclick="clearVoice()">Cerrar</button></div>`;return;}
  el.innerHTML=`<div class="result-card"><h3>🔍 "${query}"</h3>${found.map(m=>`<div class="result-row"><span>${m.nombre}</span><div style="text-align:right;"><span class="val" style="color:${m.cantidad<=0?'var(--danger)':m.cantidad<=(m.minimo||0)?'var(--warn)':'var(--success)'}">${m.cantidad} ${m.unidad||'ud'}</span>${canVerPrecios&&m.precio?`<div style="font-size:10px;color:var(--gold);">${(m.precio).toFixed(2)} €/ud</div>`:''}</div></div>`).join('')}</div><button class="btn btn-secondary" onclick="clearVoice()">Cerrar</button>`;
}

async function voicePedir(material, cantidad){
  if(!hasPermiso('crearPedidos')){toast('Sin permiso para crear pedidos','error');clearVoice();return;}
  const el=document.getElementById('parsedResult');el.style.display='block';
  const mats=await dbGetAll('materiales'),q=norm(material);
  const mat=mats.find(m=>norm(m.nombre).includes(q));
  el.innerHTML=`<div class="result-card" style="border-left-color:var(--warn);"><h3>🛒 Crear Pedido</h3>
    <div class="result-row"><span>Material</span><span class="val">${mat?mat.nombre:material}</span></div>
    <div class="result-row"><span>Cantidad</span><span class="val">${cantidad||1} ${mat?.unidad||'ud'}</span></div>
    ${mat?.precio&&hasPermiso('verPrecios')?`<div class="result-row"><span>Coste estimado</span><span class="val" style="color:var(--gold);">${((cantidad||1)*mat.precio).toFixed(2)} €</span></div>`:''}
  </div>
  <div class="btn-row"><button class="btn btn-secondary" onclick="clearVoice()">✕</button><button class="btn btn-warn" onclick="confirmVoicePedido(${mat?mat.id:'null'},'${mat?mat.nombre:material}',${cantidad||1})">📋 Crear pedido</button></div>`;
}

async function confirmVoicePedido(matId, nombre, cantidad){
  const mats=await dbGetAll('materiales');
  const mat=mats.find(m=>m.id===matId);
  const lineas=[{materialId:matId,nombre,cantidad,precio:mat?.precio||0,subtotal:(cantidad*(mat?.precio||0))}];
  const total=lineas.reduce((s,l)=>s+l.subtotal,0);
  await dbAdd('pedidos',{proveedor:mat?.proveedor||'',estado:'pendiente',notas:'Creado por voz',lineas,total,creadoPor:currentUser?.nombre||'',fecha:new Date().toISOString(),synced:0});
  clearVoice();toast('✓ Pedido creado','success');scheduleSyncSoon();
}

async function confirmVoiceAction(){
  if(!lastParsed)return;
  const p=lastParsed;
  const[mats,ubics]=await Promise.all([dbGetAll('materiales'),dbGetAll('ubicaciones')]);
  const matQ=norm(p.material);
  let mat=mats.find(m=>norm(m.nombre)===matQ)||mats.find(m=>norm(m.nombre).includes(matQ)||matQ.includes(norm(m.nombre)));
  let ubicId=null;
  if(p.ubicacion){const uQ=norm(p.ubicacion);const ub=ubics.find(u=>norm(u.nombre)===uQ)||ubics.find(u=>norm(u.nombre).includes(uQ)||uQ.includes(norm(u.nombre)));if(ub)ubicId=ub.id;}
  if(!mat){
    showConfirmModal('Material no encontrado',`<p style="font-size:13px;color:var(--text2);">No existe "<strong>${p.material}</strong>". ¿Crearlo?</p>`,async()=>{
      const newId=await dbAdd('materiales',{nombre:p.material,cantidad:p.tipo==='entrada'?p.cantidad:0,unidad:'ud',precio:0,ubicacionId:ubicId,minimo:0,creado:new Date().toISOString(),synced:0});
      await registerMovement(newId,p.tipo==='entrada'?'entrada':'salida',p.cantidad,ubicId,null,p.original);
      clearVoice();toast('✓ Material creado y movimiento registrado','success');renderAll();scheduleSyncSoon();
    });return;
  }
  if(p.tipo==='salida'&&mat.cantidad<p.cantidad){
    showConfirmModal('Stock insuficiente',`<p style="font-size:13px;color:var(--danger);">Solo hay <strong>${mat.cantidad} ${mat.unidad||'ud'}</strong> de ${mat.nombre}. ¿Confirmar?</p>`,()=>doMovement(mat,p,ubicId));return;
  }
  await doMovement(mat,p,ubicId);
}

async function doMovement(mat,p,ubicId){
  const delta=p.tipo==='entrada'?p.cantidad:-p.cantidad;
  mat.cantidad=Math.max(0,(mat.cantidad||0)+delta);mat.synced=0;
  if(ubicId)mat.ubicacionId=ubicId;
  await dbPut('materiales',mat);
  await registerMovement(mat.id,p.tipo,p.cantidad,ubicId||mat.ubicacionId,null,p.original);
  clearVoice();toast(`✓ ${p.tipo==='entrada'?'Entrada':'Salida'} de ${p.cantidad} ${mat.unidad||'ud'} de ${mat.nombre}`,'success');
  renderAll();scheduleSyncSoon();
}

async function registerMovement(matId,tipo,cantidad,ubicId,destUbicId,nota){
  await dbAdd('movimientos',{materialId:matId,tipo,cantidad,ubicacionId:ubicId||null,ubicacionDestinoId:destUbicId||null,fecha:new Date().toISOString(),nota:nota||'',synced:0,usuario:currentUser?.nombre||''});
  updateSyncBadge();
}

// ══════════════════════════════════════════════
// PEDIDOS
// ══════════════════════════════════════════════
let currentPedTab='pendiente';
let pedLines=[];

async function openNewPedido(){
  pedLines=[{materialId:null,nombre:'',cantidad:1,precio:0,subtotal:0}];
  renderPedLines();
  document.getElementById('ped-proveedor').value='';
  document.getElementById('ped-notas').value='';
  document.getElementById('pedidoModal').classList.add('open');
}

async function renderPedLines(){
  const mats=await dbGetAll('materiales');
  const canVerPrecios=hasPermiso('verPrecios');
  const el=document.getElementById('ped-lines');
  el.innerHTML=pedLines.map((l,i)=>`
    <div style="background:var(--bg3);border-radius:var(--rs);padding:10px;margin-bottom:8px;">
      <div class="form-group" style="margin-bottom:6px;">
        <select onchange="pedLineMatChange(${i},this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:8px;color:var(--text);font-size:13px;">
          <option value="">— Seleccionar material —</option>
          ${mats.map(m=>`<option value="${m.id}" ${l.materialId===m.id?'selected':''}>${m.nombre}${canVerPrecios&&m.precio?' ('+m.precio.toFixed(2)+'€/ud)':''}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" value="${l.cantidad}" min="1" onchange="pedLineQtyChange(${i},this.value)" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:8px;color:var(--text);font-size:13px;">
        ${canVerPrecios?`<span style="font-size:13px;color:var(--gold);min-width:70px;text-align:right;">${l.subtotal.toFixed(2)} €</span>`:''}
        <button onclick="pedLineRemove(${i})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:6px 10px;cursor:pointer;">✕</button>
      </div>
    </div>`).join('');
  updatePedTotal();
}

async function pedLineMatChange(i, matId){
  const mats=await dbGetAll('materiales');
  const mat=mats.find(m=>m.id===parseInt(matId));
  if(mat){pedLines[i].materialId=mat.id;pedLines[i].nombre=mat.nombre;pedLines[i].precio=mat.precio||0;pedLines[i].subtotal=pedLines[i].cantidad*(mat.precio||0);}
  renderPedLines();
}
function pedLineQtyChange(i,qty){pedLines[i].cantidad=parseFloat(qty)||1;pedLines[i].subtotal=pedLines[i].cantidad*pedLines[i].precio;renderPedLines();}
function pedLineRemove(i){pedLines.splice(i,1);renderPedLines();}
function addPedLine(){pedLines.push({materialId:null,nombre:'',cantidad:1,precio:0,subtotal:0});renderPedLines();}
function updatePedTotal(){const t=pedLines.reduce((s,l)=>s+l.subtotal,0);const el=document.getElementById('ped-total');if(el)el.textContent=t.toFixed(2)+' €';}

async function savePedido(){
  const prov=document.getElementById('ped-proveedor').value.trim();
  const notas=document.getElementById('ped-notas').value.trim();
  const validLines=pedLines.filter(l=>l.materialId&&l.cantidad>0);
  if(!validLines.length){toast('Añade al menos un material','error');return;}
  const total=validLines.reduce((s,l)=>s+l.subtotal,0);
  await dbAdd('pedidos',{proveedor:prov,estado:'pendiente',notas,lineas:validLines,total,creadoPor:currentUser?.nombre||'',fecha:new Date().toISOString(),synced:0});
  closeModal('pedidoModal');toast('✓ Pedido creado','success');renderPedidos();scheduleSyncSoon();
}

function setPedTab(tab){
  currentPedTab=tab;
  document.querySelectorAll('#screen-ped .tab').forEach((t,i)=>t.classList.toggle('active',['pendiente','aprobado','recibido'][i]===tab));
  renderPedidos();
}

async function renderPedidos(){
  if(!hasPermiso('verPedidos')){document.getElementById('lock-ped').style.display='flex';document.getElementById('ped-content').style.display='none';return;}
  document.getElementById('lock-ped').style.display='none';document.getElementById('ped-content').style.display='block';
  const peds=await dbGetAll('pedidos');
  const filtered=peds.filter(p=>p.estado===currentPedTab).reverse();
  const canVerPrecios=hasPermiso('verPrecios');
  const canAprobar=hasPermiso('aprobarPedidos');
  const el=document.getElementById('pedidosList');
  if(!filtered.length){el.innerHTML=`<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>No hay pedidos ${currentPedTab==='pendiente'?'pendientes':currentPedTab==='aprobado'?'aprobados':'recibidos'}</p></div>`;return;}
  el.innerHTML=filtered.map(p=>{
    const statusCls='ps-'+p.estado;
    const statusLabel=p.estado==='pendiente'?'⏳ Pendiente':p.estado==='aprobado'?'✓ Aprobado':p.estado==='recibido'?'📦 Recibido':'✕ Cancelado';
    const fd=new Date(p.fecha);
    const fs=fd.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit'});
    const lineas=(p.lineas||[]).map(l=>`<div class="pedido-item-row"><span>${l.nombre||'Material'} × ${l.cantidad}</span><span>${canVerPrecios?l.subtotal?.toFixed(2)+' €':'—'}</span></div>`).join('');
    const acciones=[];
    if(p.estado==='pendiente'&&canAprobar)acciones.push(`<button class="btn btn-primary" onclick="cambiarEstadoPedido(${p.id},'aprobado')">✓ Aprobar</button>`);
    if(p.estado==='aprobado')acciones.push(`<button class="btn btn-success" onclick="cambiarEstadoPedido(${p.id},'recibido')">📦 Recibido</button>`);
    if((p.estado==='pendiente'||p.estado==='aprobado')&&canAprobar)acciones.push(`<button class="btn btn-secondary" onclick="cambiarEstadoPedido(${p.id},'cancelado')">✕</button>`);
    return `<div class="pedido-card">
      <div class="pedido-header"><div><h3>${p.proveedor||'Sin proveedor'}</h3></div><span class="pedido-status ${statusCls}">${statusLabel}</span></div>
      <div class="pedido-meta">${fs} · ${p.creadoPor||'—'}${p.notas?` · ${p.notas}`:''}</div>
      <div class="pedido-items">${lineas}</div>
      ${canVerPrecios?`<div class="pedido-total"><span>Total</span><span>${(p.total||0).toFixed(2)} €</span></div>`:''}
      ${acciones.length?`<div class="pedido-actions">${acciones.join('')}</div>`:''}
    </div>`;
  }).join('');
}

async function cambiarEstadoPedido(id, nuevoEstado){
  const peds=await dbGetAll('pedidos');
  const ped=peds.find(p=>p.id===id);
  if(!ped)return;
  // Si se recibe, actualizar stock
  if(nuevoEstado==='recibido'&&ped.lineas?.length){
    for(const l of ped.lineas){
      if(!l.materialId)continue;
      const mats=await dbGetAll('materiales');
      const mat=mats.find(m=>m.id===l.materialId);
      if(mat){mat.cantidad=(mat.cantidad||0)+l.cantidad;mat.synced=0;await dbPut('materiales',mat);await registerMovement(mat.id,'entrada',l.cantidad,mat.ubicacionId,null,'Pedido recibido: '+ped.proveedor);}
    }
    toast('📦 Stock actualizado automáticamente','success');
  }
  ped.estado=nuevoEstado;ped.synced=0;
  await dbPut('pedidos',ped);renderPedidos();renderInventory();scheduleSyncSoon();
  toast(`✓ Pedido ${nuevoEstado}`,'success');
}

// ══════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════
let currentMovTab='all', currentAdminTab='mat';

async function renderAll(){await Promise.all([renderInventory(),renderMovements(),renderAdmin(),renderPedidos(),updateStats()]);}

async function renderInventory(){
  const[mats,ubics]=await Promise.all([dbGetAll('materiales'),dbGetAll('ubicaciones')]);
  const ubicMap={};ubics.forEach(u=>ubicMap[u.id]=u);
  const sel=document.getElementById('filterUbic');if(!sel)return;
  const cv=sel.value;
  sel.innerHTML='<option value="">Todas</option>'+ubics.map(u=>`<option value="${u.id}">${u.tipo==='furgoneta'?'🚐 ':'🏭 '}${u.nombre}</option>`).join('');
  sel.value=cv;filterInventory(mats,ubics,ubicMap);
}

async function filterInventory(mats,ubics,ubicMap){
  if(!mats){[mats,ubics]=await Promise.all([dbGetAll('materiales'),dbGetAll('ubicaciones')]);ubicMap={};ubics.forEach(u=>ubicMap[u.id]=u);}
  const q=norm(document.getElementById('searchInput')?.value||'');
  const fU=document.getElementById('filterUbic')?.value;
  const canVerPrecios=hasPermiso('verPrecios');
  let f=mats;if(q)f=f.filter(m=>norm(m.nombre).includes(q));if(fU)f=f.filter(m=>String(m.ubicacionId)===String(fU));
  const el=document.getElementById('inventoryList');if(!el)return;
  if(!f.length){el.innerHTML=`<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg><p>${q?'Sin resultados':'Sin materiales. ¡Empieza añadiendo!'}</p></div>`;return;}
  el.innerHTML=f.map(m=>{
    const ub=ubicMap[m.ubicacionId];
    const ubL=ub?(ub.tipo==='furgoneta'?'🚐 ':ub.tipo==='almacen'?'🏭 ':'📍 ')+ub.nombre:'—';
    const qc=m.cantidad<=0?'stock-zero':m.cantidad<=(m.minimo||0)?'stock-low':'';
    return `<div class="item-card"><div class="item-info"><h3>${m.nombre}</h3><p>${ubL}${m.proveedor?' · '+m.proveedor:''}</p>${m.minimo&&m.cantidad<=m.minimo?`<p style="color:var(--warn);font-size:10px;">⚠️ Stock bajo (mín: ${m.minimo})</p>`:''}</div><div class="item-stock"><div class="qty ${qc}">${m.cantidad}</div><div class="unit">${m.unidad||'ud'}</div>${canVerPrecios&&m.precio?`<div class="price-tag">${m.precio.toFixed(2)} €/ud</div>`:''}  </div></div>`;
  }).join('');
}

async function renderMovements(){
  const[movs,mats,ubics]=await Promise.all([dbGetAll('movimientos'),dbGetAll('materiales'),dbGetAll('ubicaciones')]);
  const matMap={},ubicMap={};mats.forEach(m=>matMap[m.id]=m);ubics.forEach(u=>ubicMap[u.id]=u);
  let f=[...movs].reverse();if(currentMovTab!=='all')f=f.filter(m=>m.tipo===currentMovTab);
  const el=document.getElementById('movementsList');if(!el)return;
  if(!f.length){el.innerHTML=`<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg><p>Sin movimientos</p></div>`;return;}
  el.innerHTML=f.slice(0,100).map(mv=>{
    const mat=matMap[mv.materialId],ub=ubicMap[mv.ubicacionId],isIn=mv.tipo==='entrada';
    const fd=new Date(mv.fecha);
    const fs=fd.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit'})+' '+fd.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
    return `<div class="mov-item"><div class="mov-icon ${isIn?'mov-in':'mov-out'}">${isIn?'↑':'↓'}</div><div class="mov-info"><h4>${mat?mat.nombre:'—'}</h4><p>${ub?(ub.tipo==='furgoneta'?'🚐 ':'🏭 ')+ub.nombre+' · ':''} ${fs}${mv.usuario?' · '+mv.usuario:''}${!mv.synced?' · ⏳':' · ☁️'}</p></div><div class="mov-qty ${isIn?'in':'out'}">${isIn?'+':'-'}${mv.cantidad}</div></div>`;
  }).join('');
}

async function renderAdmin(){
  if(!hasPermiso('gestionAdmin')){
    const lk=document.getElementById('lock-admin');const ac=document.getElementById('admin-content');
    if(lk)lk.style.display='flex';if(ac)ac.style.display='none';return;
  }
  const lk=document.getElementById('lock-admin');const ac=document.getElementById('admin-content');
  if(lk)lk.style.display='none';if(ac)ac.style.display='block';
  const[mats,ubics,users]=await Promise.all([dbGetAll('materiales'),dbGetAll('ubicaciones'),dbGetAll('usuarios')]);
  const ubicMap={};ubics.forEach(u=>ubicMap[u.id]=u);
  // Mat list
  const ml=document.getElementById('matList');
  if(ml)ml.innerHTML=mats.length?mats.map(m=>{const ub=ubicMap[m.ubicacionId];return`<div class="item-card" style="margin-bottom:7px;"><div class="item-info"><h3 style="font-size:13px;">${m.nombre}</h3><p>${ub?ub.nombre:'—'} · ${m.precio||0}€/ud · mín:${m.minimo||0}</p></div><div style="display:flex;align-items:center;gap:6px;"><div class="item-stock"><div class="qty" style="font-size:16px;">${m.cantidad}</div><div class="unit">${m.unidad||'ud'}</div></div><button onclick="deleteMaterial(${m.id})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11px;">✕</button></div></div>`;}).join(''):'<p style="color:var(--text3);font-size:13px;">Sin materiales</p>';
  // Ubic select
  const ms=document.getElementById('matUbic');
  if(ms)ms.innerHTML='<option value="">Sin ubicación</option>'+ubics.map(u=>`<option value="${u.id}">${u.tipo==='furgoneta'?'🚐 ':'🏭 '}${u.nombre}</option>`).join('');
  // Ubic list
  const ul=document.getElementById('ubicList');
  if(ul)ul.innerHTML=ubics.length?'<div style="display:flex;flex-wrap:wrap;gap:6px;">'+ubics.map(u=>`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:7px 10px;display:flex;align-items:center;gap:7px;font-size:12px;">${u.tipo==='furgoneta'?'🚐':u.tipo==='almacen'?'🏭':u.tipo==='obra'?'🏗️':'📍'} ${u.nombre}<button onclick="deleteUbicacion(${u.id})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;">✕</button></div>`).join('')+'</div>':'<p style="color:var(--text3);font-size:13px;">Sin ubicaciones</p>';
  // User list
  const userList=document.getElementById('userList');
  if(userList)userList.innerHTML=users.map(u=>{const r=ROLES[u.rol];return`<div class="user-card"><div class="user-avatar" style="background:${r.color}22;color:${r.color};">${u.nombre.charAt(0).toUpperCase()}</div><div class="user-info"><h3>${u.nombre}</h3><p><span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span></p></div><button onclick="deleteUser(${u.id})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:6px 9px;cursor:pointer;">✕</button></div>`;}).join('');
}

async function updateStats(){
  const[mats,ubics,movs]=await Promise.all([dbGetAll('materiales'),dbGetAll('ubicaciones'),dbGetAll('movimientos')]);
  const el=id=>document.getElementById(id);
  if(el('statMat'))el('statMat').textContent=mats.length;if(el('statUbic'))el('statUbic').textContent=ubics.length;
  if(el('statMov'))el('statMov').textContent=movs.length;if(el('statPend'))el('statPend').textContent=movs.filter(m=>!m.synced).length;
  updateSyncBadge();
}
async function updateSyncBadge(){
  const movs=await dbGetAll('movimientos');const p=movs.filter(m=>!m.synced).length;
  const b=document.getElementById('sync-badge');if(!b)return;
  b.textContent=p>0?`⏳${p}`:'☁️';b.className='status '+(p>0?'offline':'online');
}

// ══════════════════════════════════════════════
// ACCIONES
// ══════════════════════════════════════════════
async function addUser(){
  const n=document.getElementById('newUserNombre').value.trim();
  const rol=document.getElementById('newUserRol').value;
  const pin=document.getElementById('newUserPin').value.trim();
  if(!n){toast('Escribe el nombre','error');return;}
  if(!/^\d{4}$/.test(pin)){toast('PIN de 4 dígitos','error');return;}
  await dbAdd('usuarios',{nombre:n,rol,pin,creado:new Date().toISOString(),synced:0});
  document.getElementById('newUserNombre').value='';document.getElementById('newUserPin').value='';
  toast('✓ Usuario añadido','success');renderAdmin();scheduleSyncSoon();
}

async function deleteUser(id){
  if(currentUser?.id===id){toast('No puedes eliminarte a ti mismo','error');return;}
  showConfirmModal('Eliminar usuario','<p style="font-size:13px;color:var(--text2);">¿Eliminar este usuario?</p>',async()=>{
    await dbDelete('usuarios',id);toast('Usuario eliminado','success');renderAdmin();
  });
}

async function addMaterial(){
  const n=document.getElementById('matNombre').value.trim();if(!n){toast('Escribe el nombre','error');return;}
  const qty=parseFloat(document.getElementById('matQty').value)||0;
  const unit=document.getElementById('matUnit').value.trim()||'ud';
  const precio=parseFloat(document.getElementById('matPrecio').value)||0;
  const ubicId=parseInt(document.getElementById('matUbic').value)||null;
  const min=parseInt(document.getElementById('matMin').value)||0;
  const proveedor=document.getElementById('matProveedor').value.trim();
  const id=await dbAdd('materiales',{nombre:n,cantidad:qty,unidad:unit,precio,ubicacionId:ubicId,minimo:min,proveedor,creado:new Date().toISOString(),synced:0});
  if(qty>0)await registerMovement(id,'entrada',qty,ubicId,null,'Inventario inicial');
  document.getElementById('matNombre').value='';document.getElementById('matQty').value='0';document.getElementById('matUnit').value='';document.getElementById('matPrecio').value='0';document.getElementById('matMin').value='0';document.getElementById('matProveedor').value='';
  toast('✓ Material añadido','success');renderAll();scheduleSyncSoon();
}
async function deleteMaterial(id){showConfirmModal('Eliminar material','<p style="font-size:13px;color:var(--text2);">¿Eliminar este material?</p>',async()=>{await dbDelete('materiales',id);toast('Eliminado','success');renderAll();});}
async function addUbicacion(){
  const n=document.getElementById('ubicNombre').value.trim();if(!n){toast('Escribe el nombre','error');return;}
  const tipo=document.getElementById('ubicTipo').value;
  await dbAdd('ubicaciones',{nombre:n,tipo,creado:new Date().toISOString(),synced:0});
  document.getElementById('ubicNombre').value='';toast('✓ Ubicación añadida','success');renderAll();scheduleSyncSoon();
}
async function deleteUbicacion(id){await dbDelete('ubicaciones',id);toast('Eliminada','success');renderAll();}

async function exportCSV(tipo){
  const[mats,ubics,movs,peds]=await Promise.all([dbGetAll('materiales'),dbGetAll('ubicaciones'),dbGetAll('movimientos'),dbGetAll('pedidos')]);
  const matMap={},ubicMap={};mats.forEach(m=>matMap[m.id]=m);ubics.forEach(u=>ubicMap[u.id]=u);
  const canVerPrecios=hasPermiso('verPrecios');
  let csv='',fn='';
  if(tipo==='inventario'||tipo==='todo'){csv+='INVENTARIO\nID,Nombre,Cantidad,Unidad,Precio (€),Proveedor,Ubicación,Stock Mínimo\n';csv+=mats.map(m=>[m.id,`"${m.nombre}"`,m.cantidad,m.unidad||'ud',canVerPrecios?m.precio||0:'***',`"${m.proveedor||''}"`,`"${ubicMap[m.ubicacionId]?.nombre||''}"`,m.minimo||0].join(',')).join('\n')+'\n\n';fn='inventario.csv';}
  if(tipo==='movimientos'||tipo==='todo'){csv+='MOVIMIENTOS\nID,Tipo,Material,Cantidad,Ubicación,Fecha,Usuario\n';csv+=movs.map(mv=>[mv.id,mv.tipo,`"${matMap[mv.materialId]?.nombre||''}"`,mv.cantidad,`"${ubicMap[mv.ubicacionId]?.nombre||''}"`,mv.fecha,mv.usuario||''].join(',')).join('\n')+'\n\n';if(tipo==='movimientos')fn='movimientos.csv';}
  if(tipo==='pedidos'||tipo==='todo'){csv+='PEDIDOS\nID,Proveedor,Estado,Total (€),Fecha,Creado por,Notas\n';csv+=peds.map(p=>[p.id,`"${p.proveedor||''}"`,p.estado,canVerPrecios?p.total?.toFixed(2)||0:'***',p.fecha,`"${p.creadoPor||''}"`,`"${p.notas||''}"`].join(',')).join('\n')+'\n\n';if(tipo==='pedidos')fn='pedidos.csv';}
  if(tipo==='todo')fn='stockvoz_completo.csv';
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fn;a.click();URL.revokeObjectURL(url);
  toast('✓ CSV exportado','success');
}

async function loadSampleData(){
  showConfirmModal('Cargar datos de ejemplo','<p style="font-size:13px;color:var(--text2);">Se añadirán ubicaciones, materiales y un usuario operario de ejemplo.</p>',async()=>{
    const u1=await dbAdd('ubicaciones',{nombre:'Almacén Central',tipo:'almacen',creado:new Date().toISOString(),synced:0});
    const u2=await dbAdd('ubicaciones',{nombre:'Almacén B',tipo:'almacen',creado:new Date().toISOString(),synced:0});
    const u3=await dbAdd('ubicaciones',{nombre:'Furgoneta 1',tipo:'furgoneta',creado:new Date().toISOString(),synced:0});
    const u4=await dbAdd('ubicaciones',{nombre:'Furgoneta 2',tipo:'furgoneta',creado:new Date().toISOString(),synced:0});
    const u5=await dbAdd('ubicaciones',{nombre:'Obra Norte',tipo:'obra',creado:new Date().toISOString(),synced:0});
    const samples=[
      {nombre:'Tornillo M8',cantidad:500,unidad:'ud',precio:0.05,ubicacionId:u1,minimo:50,proveedor:'Tornillería García'},
      {nombre:'Cable eléctrico 2.5mm',cantidad:150,unidad:'m',precio:1.20,ubicacionId:u2,minimo:20,proveedor:'ElecDist'},
      {nombre:'Brida nylon',cantidad:1000,unidad:'ud',precio:0.02,ubicacionId:u3,minimo:100,proveedor:''},
      {nombre:'Cinta aislante',cantidad:24,unidad:'ud',precio:1.80,ubicacionId:u3,minimo:5,proveedor:'ElecDist'},
      {nombre:'Interruptor simple',cantidad:15,unidad:'ud',precio:3.50,ubicacionId:u4,minimo:5,proveedor:'ElecDist'},
      {nombre:'Hormigón seco 25kg',cantidad:12,unidad:'saco',precio:6.90,ubicacionId:u5,minimo:3,proveedor:'Materiales López'},
    ];
    for(const m of samples){const id=await dbAdd('materiales',{...m,creado:new Date().toISOString(),synced:0});await registerMovement(id,'entrada',m.cantidad,m.ubicacionId,null,'Stock inicial');}
    // Añadir usuario encargado de ejemplo
    const users=await dbGetAll('usuarios');
    if(!users.find(u=>u.nombre==='Encargado')){await dbAdd('usuarios',{nombre:'Encargado',rol:'encargado',pin:'1234',creado:new Date().toISOString(),synced:0});}
    if(!users.find(u=>u.nombre==='Operario 1')){await dbAdd('usuarios',{nombre:'Operario 1',rol:'operario',pin:'0000',creado:new Date().toISOString(),synced:0});}
    toast('✓ Datos de ejemplo cargados','success');renderAll();scheduleSyncSoon();
  });
}

async function clearAllData(){
  showConfirmModal('⚠️ Borrar TODO','<p style="font-size:13px;color:var(--danger);font-weight:600;">Se eliminan TODOS los datos locales incluyendo usuarios.</p>',async()=>{
    for(const s of['materiales','ubicaciones','movimientos','pedidos'])await dbClear(s);
    localStorage.removeItem('last_pull');
    toast('Datos eliminados','error');doLogout();
  });
}

// ══════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════
function showScreen(name){
  if(name==='ped'&&!hasPermiso('verPedidos')){toast('Sin permiso','error');return;}
  if(name==='admin'&&!hasPermiso('gestionAdmin')){toast('Solo administradores','error');return;}
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  if(name==='inv')renderInventory();
  else if(name==='mov')renderMovements();
  else if(name==='ped')renderPedidos();
  else if(name==='admin'){renderAdmin();updateStats();}
}

function setMovTab(tab){currentMovTab=tab;document.querySelectorAll('#screen-mov .tab').forEach((t,i)=>t.classList.toggle('active',['all','entrada','salida'][i]===tab));renderMovements();}

function setAdminTab(tab){
  currentAdminTab=tab;
  ['mat','ubic','users','sync','export'].forEach(t=>{const el=document.getElementById('admin-'+t);if(el)el.style.display=t===tab?'block':'none';});
  document.querySelectorAll('#screen-admin .tabs .tab').forEach((t,i)=>t.classList.toggle('active',['mat','ubic','users','sync','export'][i]===tab));
  if(tab==='sync')renderSyncScreen();else if(tab!=='mat')renderAdmin();
}

function showConfirmModal(title,body,onConfirm,confirmLabel='Confirmar'){
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmBody').innerHTML=body;
  document.getElementById('confirmBtn').textContent=confirmLabel;
  document.getElementById('confirmBtn').onclick=()=>{closeModal('confirmModal');onConfirm();};
  document.getElementById('confirmModal').classList.add('open');
}
function closeModal(id){document.getElementById(id).classList.remove('open');}

let toastTimer;
function toast(msg,type=''){const el=document.getElementById('toast');el.textContent=msg;el.className='show '+type;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',3000);}

function updateNetStatus(){
  const el=document.getElementById('net-status');if(!el)return;
  if(navigator.onLine){el.textContent='Online';el.className='status online';scheduleSyncSoon();}
  else{el.textContent='Offline';el.className='status offline';}
}
window.addEventListener('online',updateNetStatus);
window.addEventListener('offline',updateNetStatus);

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
(async()=>{
  await initDB();
  initVoice();
  await initLogin();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
