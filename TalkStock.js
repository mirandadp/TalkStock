// ══════════════════════════════════════════════
// ROLES Y PERMISOS
// ══════════════════════════════════════════════
const ROLES = {
    admin: { label: 'Administrador', color: '#f1c40f', cls: 'role-admin', emoji: '👑' },
    encargado: { label: 'Encargado', color: '#4f8ef7', cls: 'role-encargado', emoji: '🔑' },
    operario: { label: 'Operario', color: '#2ecc71', cls: 'role-operario', emoji: '👷' }
};
const CAN = {
    verPrecios: r => r === 'admin' || r === 'encargado',
    verPedidos: r => r === 'admin' || r === 'encargado',
    crearPedidos: r => r === 'admin' || r === 'encargado',
    editarPedidos: r => r === 'admin' || r === 'encargado',
    aprobarPedidos: r => r === 'admin',
    gestionAdmin: r => r === 'admin',
    editarMaterial: r => r === 'admin' || r === 'encargado',
    editarUbicacion: r => r === 'admin' || r === 'encargado',
};
let currentUser = null;
function hasPermiso(p) {
    return currentUser && CAN[p]?.(currentUser.rol);
}
function auditStamp() {
    return {
        modificadoPor: currentUser?.nombre || '',
        modificadoEn: new Date().toISOString()
    };
}
function fmtAudit(r) {
    const parts = [];
    if (r.creadoPor) parts.push('Creado por ' + r.creadoPor);
    if (r.modificadoPor && r.modificadoPor !== r.creadoPor) parts.push('· Modificado por ' + r.modificadoPor);
    if (r.modificadoEn) parts.push('· ' + new Date(r.modificadoEn).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }));
    return parts.join(' ');
}
function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
function fmtDate(d) {
    return new Date(d).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

// ══════════════════════════════════════════════
// INDEXEDDB
// ══════════════════════════════════════════════
let db;
const DB_NAME = 'StockVozDB', DB_VER = 5;
function initDB() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            ['materiales', 'ubicaciones', 'movimientos', 'usuarios', 'pedidos'].forEach(s => {
                if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
            });
        };
        req.onsuccess = e => { db = e.target.result; res(db); };
        req.onerror = () => rej(req.error);
    });
}
function dbTx(store, mode, fn) {
    return new Promise((res, rej) => {
        const tx = db.transaction(store, mode), s = tx.objectStore(store), req = fn(s);
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
}
const dbGetAll = s => dbTx(s, 'readonly', o => o.getAll());
const dbAdd = (s, d) => dbTx(s, 'readwrite', o => o.add(d));
const dbPut = (s, d) => dbTx(s, 'readwrite', o => o.put(d));
const dbDelete = (s, k) => dbTx(s, 'readwrite', o => o.delete(k));
function dbClear(s) {
    return new Promise(r => {
        const tx = db.transaction(s, 'readwrite');
        tx.objectStore(s).clear(); tx.oncomplete = r;
    });
}

// ══════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════
let pinBuffer = '';
async function initLogin() {
    const usuarios = await dbGetAll('usuarios');
    if (!usuarios.length) { document.getElementById('user-select-wrap').style.display = 'none'; document.getElementById('first-setup').style.display = 'block'; return; }
    const sel = document.getElementById('login-user-sel');
    sel.innerHTML = '<option value="">— Seleccionar —</option>';
    usuarios.forEach(u => {
        const o = document.createElement('option');
        o.value = u.id; o.textContent = u.nombre + ' (' + ROLES[u.rol].emoji + ')';
        sel.appendChild(o);
    });
    const saved = localStorage.getItem('sv_session');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            const u = usuarios.find(x => x.id === s.id); if (u) { doLogin(u); return; }
        } catch (e) { }
    }
}
async function createFirstAdmin() {
    const n = document.getElementById('setup-nombre').value.trim();
    const p = document.getElementById('setup-pin').value.trim();
    if (!n) { toast('Escribe tu nombre', 'error'); return; }
    if (!/^\d{4}$/.test(p)) { toast('PIN de 4 dígitos', 'error'); return; }
    const now = new Date().toISOString();
    await dbAdd('usuarios', { nombre: n, rol: 'admin', pin: p, creado: now, creadoPor: 'sistema', modificadoPor: '', modificadoEn: now, synced: 0 });
    toast('✓ Administrador creado', 'success');
    document.getElementById('first-setup').style.display = 'none'; document.getElementById('user-select-wrap').style.display = 'block';
    setTimeout(() => initLogin(), 500);
}
function onUserSelect() {
    const id = parseInt(document.getElementById('login-user-sel').value);
    if (!id) { document.getElementById('pin-section').style.display = 'none'; return; }
    document.getElementById('pin-section').style.display = 'block'; document.getElementById('user-select-wrap').style.display = 'none';
    document.getElementById('login-title-text').textContent = 'Introduce tu PIN';
    pinBuffer = ''; renderPinDots();
    dbGetAll('usuarios').then(us => {
        const u = us.find(x => x.id === id); if (u) {
            const r = ROLES[u.rol];
            document.getElementById('login-role-badge').innerHTML = `<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
        }
    });
}
function backToUserSelect() {
    document.getElementById('pin-section').style.display = 'none';
    document.getElementById('user-select-wrap').style.display = 'block';
    document.getElementById('login-title-text').textContent = 'Selecciona usuario';
    document.getElementById('login-user-sel').value = '';
    pinBuffer = '';
}
function pinPress(d) { if (pinBuffer.length >= 4) return; pinBuffer += d; renderPinDots(); if (pinBuffer.length === 4) setTimeout(checkPin, 200); }
function pinDel() { if (pinBuffer.length > 0) { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); } }
function renderPinDots() { for (let i = 0; i < 4; i++)document.getElementById('pd' + i).className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : ''); }
async function checkPin() {
    const id = parseInt(document.getElementById('login-user-sel').value);
    const us = await dbGetAll('usuarios'); const u = us.find(x => x.id === id);
    if (u && u.pin === pinBuffer) doLogin(u);
    else { toast('PIN incorrecto', 'error'); pinBuffer = ''; renderPinDots(); }
}
function doLogin(u) {
    currentUser = u; localStorage.setItem('sv_session', JSON.stringify({ id: u.id }));
    document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app').style.display = 'flex';
    updateTopbarUser(); applyRoleUI(); renderAll();
    if (initSupabase()) { startRealtime(); scheduleSyncSoon(); }
    updateNetStatus();
}
function doLogout() {
    closeModal('userMenuModal'); currentUser = null; localStorage.removeItem('sv_session');
    document.getElementById('app').style.display = 'none'; document.getElementById('login-screen').classList.remove('hidden');
    pinBuffer = ''; renderPinDots(); backToUserSelect(); initLogin();
}
function updateTopbarUser() {
    if (!currentUser) return; const r = ROLES[currentUser.rol];
    document.getElementById('topbar-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
    document.getElementById('topbar-avatar').style.background = r.color + '33'; document.getElementById('topbar-avatar').style.color = r.color;
    document.getElementById('topbar-name').textContent = currentUser.nombre;
}
function applyRoleUI() {
    if (!currentUser) return; const rol = currentUser.rol;
    document.getElementById('nav-ped').style.display = CAN.verPedidos(rol) ? '' : 'none';
    document.getElementById('nav-admin').style.display = CAN.gestionAdmin(rol) ? '' : 'none';
}
function showUserMenu() {
    if (!currentUser) return; const r = ROLES[currentUser.rol];
    document.getElementById('um-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
    document.getElementById('um-avatar').style.background = r.color + '33'; document.getElementById('um-avatar').style.color = r.color;
    document.getElementById('um-name').textContent = currentUser.nombre;
    document.getElementById('um-role').innerHTML = `<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
    document.getElementById('userMenuModal').classList.add('open');
}
function showChangePinModal() {
    closeModal('userMenuModal');
    showConfirmModal('Cambiar PIN',
        `<div class="form-group"><label>PIN actual</label><input type="password" id="pin-old" maxlength="4" inputmode="numeric" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);font-size:14px;outline:none;"></div>
     <div class="form-group"><label>Nuevo PIN</label><input type="password" id="pin-new" maxlength="4" inputmode="numeric" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);font-size:14px;outline:none;"></div>`,
        async () => {
            const old = document.getElementById('pin-old').value; const nw = document.getElementById('pin-new').value;
            if (old !== currentUser.pin) { toast('PIN actual incorrecto', 'error'); return; }
            if (!/^\d{4}$/.test(nw)) { toast('El PIN debe ser 4 dígitos', 'error'); return; }
            currentUser.pin = nw; Object.assign(currentUser, auditStamp()); currentUser.synced = 0;
            await dbPut('usuarios', currentUser); toast('✓ PIN actualizado', 'success'); scheduleSyncSoon();
        }, 'Guardar');
}

// ══════════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════════
let SB = null, rtChannel = null, syncBusy = false;
const SETUP_SQL = `-- StockVoz v4 — pega en SQL Editor de Supabase y ejecuta

create table if not exists ubicaciones(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,tipo text default 'almacen',direccion text,descripcion text,creado timestamptz default now(),creado_por text,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
create table if not exists materiales(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,cantidad numeric default 0,unidad text default 'ud',precio numeric default 0,minimo numeric default 0,proveedor text,referencia text,descripcion text,ubicacion_id uuid references ubicaciones(id),creado timestamptz default now(),creado_por text,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
create table if not exists movimientos(id uuid primary key default gen_random_uuid(),local_id integer,tipo text not null,cantidad numeric not null,material_id uuid references materiales(id),ubicacion_id uuid references ubicaciones(id),fecha timestamptz default now(),usuario text,nota text,created_at timestamptz default now());
create table if not exists usuarios(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,rol text default 'operario',pin text,creado timestamptz default now(),creado_por text,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
create table if not exists pedidos(id uuid primary key default gen_random_uuid(),local_id integer,proveedor text,estado text default 'pendiente',notas text,lineas jsonb,total numeric default 0,creado_por text,modificado_por text,modificado_en timestamptz,fecha timestamptz default now(),updated_at timestamptz default now());

create or replace function update_updated_at() returns trigger as $$ begin new.updated_at=now();return new;end;$$ language plpgsql;
do $$ declare t text;begin foreach t in array array['ubicaciones','materiales','usuarios','pedidos'] loop execute format('drop trigger if exists trg_%s_upd on %s;create trigger trg_%s_upd before update on %s for each row execute function update_updated_at();',t,t,t,t);end loop;end$$;

alter table ubicaciones enable row level security;alter table materiales enable row level security;alter table movimientos enable row level security;alter table usuarios enable row level security;alter table pedidos enable row level security;
do $$ declare t text;begin foreach t in array array['ubicaciones','materiales','movimientos','usuarios','pedidos'] loop if not exists(select 1 from pg_policies where tablename=t and policyname='public_all') then execute format('create policy public_all on %s for all using(true) with check(true)',t);end if;end loop;end$$;

alter publication supabase_realtime add table movimientos;
alter publication supabase_realtime add table materiales;
alter publication supabase_realtime add table pedidos;
alter publication supabase_realtime add table ubicaciones;`.trim();

function getSBConfig() { return { url: localStorage.getItem('sb_url') || '', key: localStorage.getItem('sb_key') || '' }; }
function initSupabase() { const { url, key } = getSBConfig(); if (!url || !key) return false; try { SB = window.supabase.createClient(url, key); return true; } catch (e) { return false; } }

async function syncNow() {
    if (!navigator.onLine) { toast('Sin conexión', 'error'); return; }
    if (!SB && !initSupabase()) { toast('⚙️ Configura Supabase en Admin → ☁️', 'error'); return; }
    if (syncBusy) return; syncBusy = true;
    try {
        const [ubics, mats, movs, users, peds] = await Promise.all([dbGetAll('ubicaciones'), dbGetAll('materiales'), dbGetAll('movimientos'), dbGetAll('usuarios'), dbGetAll('pedidos')]);
        for (const u of ubics.filter(x => !x.synced)) { const { data, error } = await SB.from('ubicaciones').upsert({ nombre: u.nombre, tipo: u.tipo, direccion: u.direccion || '', descripcion: u.descripcion || '', local_id: u.id, creado: u.creado, creado_por: u.creadoPor || '', modificado_por: u.modificadoPor || '', modificado_en: u.modificadoEn || null }, { onConflict: 'local_id' }).select().single(); if (!error && data) { u.synced = 1; u.remote_id = data.id; await dbPut('ubicaciones', u); } }
        const ubicsSynced = await dbGetAll('ubicaciones');
        for (const m of mats.filter(x => !x.synced)) { const ub = ubicsSynced.find(u => u.id === m.ubicacionId); const { data, error } = await SB.from('materiales').upsert({ nombre: m.nombre, cantidad: m.cantidad, unidad: m.unidad || 'ud', precio: m.precio || 0, minimo: m.minimo || 0, proveedor: m.proveedor || '', referencia: m.referencia || '', descripcion: m.descripcion || '', local_id: m.id, ubicacion_id: ub?.remote_id || null, creado: m.creado, creado_por: m.creadoPor || '', modificado_por: m.modificadoPor || '', modificado_en: m.modificadoEn || null }, { onConflict: 'local_id' }).select().single(); if (!error && data) { m.synced = 1; m.remote_id = data.id; await dbPut('materiales', m); } }
        const matsSynced = await dbGetAll('materiales');
        let pushed = 0;
        for (const mv of movs.filter(x => !x.synced)) { const mt = matsSynced.find(m => m.id === mv.materialId); const ub = ubicsSynced.find(u => u.id === mv.ubicacionId); const { error } = await SB.from('movimientos').upsert({ tipo: mv.tipo, cantidad: mv.cantidad, nota: mv.nota || '', fecha: mv.fecha, usuario: mv.usuario || '', local_id: mv.id, material_id: mt?.remote_id || null, ubicacion_id: ub?.remote_id || null }, { onConflict: 'local_id' }); if (!error) { mv.synced = 1; await dbPut('movimientos', mv); pushed++; } }
        for (const u of users.filter(x => !x.synced)) { const { data, error } = await SB.from('usuarios').upsert({ nombre: u.nombre, rol: u.rol, pin: u.pin, local_id: u.id, creado: u.creado, creado_por: u.creadoPor || '', modificado_por: u.modificadoPor || '', modificado_en: u.modificadoEn || null }, { onConflict: 'local_id' }).select().single(); if (!error && data) { u.synced = 1; u.remote_id = data.id; await dbPut('usuarios', u); } }
        for (const p of peds.filter(x => !x.synced)) { const { error } = await SB.from('pedidos').upsert({ proveedor: p.proveedor || '', estado: p.estado, notas: p.notas || '', lineas: p.lineas || [], total: p.total || 0, creado_por: p.creadoPor || '', modificado_por: p.modificadoPor || '', modificado_en: p.modificadoEn || null, fecha: p.fecha, local_id: p.id }, { onConflict: 'local_id' }); if (!error) { p.synced = 1; await dbPut('pedidos', p); } }
        if (pushed > 0) toast(`☁️ ${pushed} movimientos subidos`, 'success');
        await pullRemoteData();
    } catch (e) { toast('Error sync: ' + (e.message || e), 'error'); }
    finally { syncBusy = false; updateSyncBadge(); updateStats(); }
}

async function pullRemoteData() {
    if (!SB) return;
    const lastPull = localStorage.getItem('last_pull') || '1970-01-01T00:00:00Z';
    try {
        const pull = async (table, localStore, merge) => { const { data } = await SB.from(table).select('*').gt('updated_at', lastPull); if (data?.length) { const local = await dbGetAll(localStore); for (const r of data) await merge(r, local); } };
        await pull('ubicaciones', 'ubicaciones', async (ru, local) => { const ex = local.find(u => u.remote_id === ru.id || u.id === ru.local_id); if (ex) { ex.nombre = ru.nombre; ex.tipo = ru.tipo; ex.direccion = ru.direccion; ex.descripcion = ru.descripcion; ex.creadoPor = ru.creado_por; ex.modificadoPor = ru.modificado_por; ex.modificadoEn = ru.modificado_en; ex.remote_id = ru.id; ex.synced = 1; await dbPut('ubicaciones', ex); } else { await dbAdd('ubicaciones', { nombre: ru.nombre, tipo: ru.tipo, direccion: ru.direccion, descripcion: ru.descripcion, remote_id: ru.id, local_id: ru.local_id, creadoPor: ru.creado_por, modificadoPor: ru.modificado_por, modificadoEn: ru.modificado_en, synced: 1, creado: ru.creado }); } });
        const ubicsSynced = await dbGetAll('ubicaciones');
        await pull('materiales', 'materiales', async (rm, local) => { const ex = local.find(m => m.remote_id === rm.id || m.id === rm.local_id); const ub = ubicsSynced.find(u => u.remote_id === rm.ubicacion_id); if (ex) { Object.assign(ex, { nombre: rm.nombre, cantidad: rm.cantidad, unidad: rm.unidad, precio: rm.precio || 0, minimo: rm.minimo, proveedor: rm.proveedor || '', referencia: rm.referencia || '', descripcion: rm.descripcion || '', ubicacionId: ub?.id || ex.ubicacionId, creadoPor: rm.creado_por, modificadoPor: rm.modificado_por, modificadoEn: rm.modificado_en, remote_id: rm.id, synced: 1 }); await dbPut('materiales', ex); } else { await dbAdd('materiales', { nombre: rm.nombre, cantidad: rm.cantidad, unidad: rm.unidad, precio: rm.precio || 0, minimo: rm.minimo, proveedor: rm.proveedor || '', referencia: rm.referencia || '', descripcion: rm.descripcion || '', ubicacionId: ub?.id || null, remote_id: rm.id, local_id: rm.local_id, creadoPor: rm.creado_por, modificadoPor: rm.modificado_por, modificadoEn: rm.modificado_en, synced: 1, creado: rm.creado }); } });
        const matsSynced = await dbGetAll('materiales');
        const { data: rMv } = await SB.from('movimientos').select('*').gt('created_at', lastPull);
        if (rMv?.length) { const lmv = await dbGetAll('movimientos'); for (const rm of rMv) { if (!lmv.find(m => m.local_id === rm.local_id && rm.local_id)) { const mt = matsSynced.find(m => m.remote_id === rm.material_id); const ub = ubicsSynced.find(u => u.remote_id === rm.ubicacion_id); await dbAdd('movimientos', { tipo: rm.tipo, cantidad: rm.cantidad, nota: rm.nota, fecha: rm.fecha, usuario: rm.usuario, local_id: rm.local_id, materialId: mt?.id || null, ubicacionId: ub?.id || null, synced: 1 }); } } }
        await pull('usuarios', 'usuarios', async (ru, local) => { const ex = local.find(u => u.remote_id === ru.id || u.id === ru.local_id); if (ex) { Object.assign(ex, { nombre: ru.nombre, rol: ru.rol, pin: ru.pin, creadoPor: ru.creado_por, modificadoPor: ru.modificado_por, modificadoEn: ru.modificado_en, remote_id: ru.id, synced: 1 }); await dbPut('usuarios', ex); } else { await dbAdd('usuarios', { nombre: ru.nombre, rol: ru.rol, pin: ru.pin, remote_id: ru.id, local_id: ru.local_id, creadoPor: ru.creado_por, modificadoPor: ru.modificado_por, modificadoEn: ru.modificado_en, synced: 1, creado: ru.creado }); } });
        await pull('pedidos', 'pedidos', async (rp, local) => { const ex = local.find(p => p.local_id === rp.local_id && rp.local_id); if (ex) { Object.assign(ex, { proveedor: rp.proveedor, estado: rp.estado, notas: rp.notas, lineas: rp.lineas, total: rp.total, creadoPor: rp.creado_por, modificadoPor: rp.modificado_por, modificadoEn: rp.modificado_en, synced: 1 }); await dbPut('pedidos', ex); } else { await dbAdd('pedidos', { proveedor: rp.proveedor, estado: rp.estado, notas: rp.notas, lineas: rp.lineas, total: rp.total, creadoPor: rp.creado_por, modificadoPor: rp.modificado_por, modificadoEn: rp.modificado_en, fecha: rp.fecha, local_id: rp.local_id, synced: 1 }); } });
        localStorage.setItem('last_pull', new Date().toISOString());
        renderAll();
    } catch (e) { console.error('pull', e); }
}
function startRealtime() {
    if (!SB || rtChannel) return;
    rtChannel = SB.channel('sv-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, () => { toast('🔄 Actualización recibida', ''); pullRemoteData(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'materiales' }, () => pullRemoteData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => { pullRemoteData(); renderPedidos(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ubicaciones' }, () => pullRemoteData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, () => pullRemoteData())
        .subscribe(st => {
            const el = document.getElementById('rt-status'); if (!el) return;
            el.textContent = st === 'SUBSCRIBED' ? '🟢 Tiempo real activo' : '🔴 ' + st; el.style.color = st === 'SUBSCRIBED' ? 'var(--success)' : 'var(--danger)';
        });
}
function stopRealtime() { if (rtChannel && SB) { SB.removeChannel(rtChannel); rtChannel = null; } }
function saveSupabaseConfig() {
    const url = document.getElementById('sb-url').value.trim(), key = document.getElementById('sb-key').value.trim();
    if (!url || !key) { toast('Rellena URL y API Key', 'error'); return; }
    localStorage.setItem('sb_url', url); localStorage.setItem('sb_key', key);
    SB = null; stopRealtime();
    if (initSupabase()) { toast('✓ Supabase conectado', 'success'); startRealtime(); syncNow(); renderSyncScreen(); }
    else toast('Error al conectar', 'error');
}
function clearSupabaseConfig() {
    showConfirmModal('Desconectar Supabase', '<p style="font-size:13px;color:var(--text2);">Los datos locales se conservan.</p>', () => {
        localStorage.removeItem('sb_url');
        localStorage.removeItem('sb_key'); localStorage.removeItem('last_pull'); stopRealtime(); SB = null; toast('Desconectado', 'success'); renderSyncScreen();
    });
}
function renderSyncScreen() {
    const { url, key } = getSBConfig(); const c = !!(url && key);
    const ue = document.getElementById('sb-url'), ke = document.getElementById('sb-key');
    if (ue) ue.value = '';
    if (ke) ke.value = '';
    const ce = document.getElementById('sb-connected'),
        fe = document.getElementById('sb-form'); if (ce) ce.style.display = c ? 'block' : 'none';
    if (fe) fe.style.display = c ? 'none' : 'block';
    const su = document.getElementById('sb-url-show');
    if (su && c) su.textContent = url;
}
function copySetupSQL() {
    navigator.clipboard.writeText(SETUP_SQL).then(() => toast('✓ SQL copiado', 'success')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = SETUP_SQL; document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); toast('✓ SQL copiado', 'success');
    });
}
let syncTimer;
function scheduleSyncSoon() { if (!SB) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1800); }

// ══════════════════════════════════════════════
// VOZ
// ══════════════════════════════════════════════
let recognition = null, isRecording = false, lastParsed = null;
const ENTRADA_KW = ['entrada', 'entrar', 'recibir', 'recibido', 'llega', 'llegó', 'añadir', 'agregar', 'meter', 'ingresa', 'ingreso'];
const SALIDA_KW = ['salida', 'salir', 'sacar', 'saca', 'usar', 'uso', 'consumir', 'quitar', 'retirar', 'gasta', 'gastado'];
const MOVER_KW = ['mover', 'mueve', 'trasladar', 'pasar', 'pasa'];
const BUSCAR_KW = ['buscar', 'busca', 'stock', 'cantidad', 'cuanto', 'cuánto', 'quedan', 'hay'];
const PEDIR_KW = ['pedir', 'pide', 'pedido', 'solicitar', 'solicita', 'comprar'];
function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { document.querySelector('.voice-hero p').textContent = '⚠️ Usa Chrome en Android para reconocimiento de voz.'; return; }
    recognition = new SR(); recognition.lang = 'es-ES'; recognition.continuous = false; recognition.interimResults = true; recognition.maxAlternatives = 3;
    recognition.onresult = e => {
        let int = '', fin = ''; for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t;
            else int += t;
        } const text = fin || int; showVoiceText(text, !fin); if (fin) parseVoiceCommand(fin.trim());
    };
    recognition.onerror = e => {
        stopVoice(); if (e.error === 'no-speech') toast('Sin audio', 'error'); else if (e.error === 'not-allowed') toast('Micrófono no permitido', 'error');
        else toast('Error: ' + e.error, 'error');
    };
    recognition.onend = () => stopVoice();
}
function toggleVoice() { isRecording ? stopVoice() : startVoice(); }
function startVoice() {
    if (!recognition) { toast('Voz no disponible', 'error'); return; } recognition.start();
    isRecording = true; document.getElementById('micBtn').classList.add('recording');
    document.getElementById('voiceText').textContent = '🎙️ Escuchando...';
    document.getElementById('voiceText').classList.remove('placeholder');
}
function stopVoice() {
    if (recognition && isRecording) try { recognition.stop(); } catch (e) { } isRecording = false;
    document.getElementById('micBtn').classList.remove('recording');
}
function showVoiceText(text, interim) {
    const el = document.getElementById('voiceText');
    el.textContent = interim ? '🎙️ ' + text + '...' : text; el.classList.remove('placeholder');
}
function parseVoiceCommand(text) {
    const t = norm(text); let tipo = null, isMover = false, isBuscar = false, isPedir = false;
    if (MOVER_KW.some(k => t.includes(k))) isMover = true;
    else if (BUSCAR_KW.some(k => t.startsWith(k) || t.includes(' ' + k))) isBuscar = true;
    else if (PEDIR_KW.some(k => t.startsWith(k) || t.includes(' ' + k))) isPedir = true;
    else if (ENTRADA_KW.some(k => t.startsWith(k) || t.includes(' ' + k))) tipo = 'entrada';
    else if (SALIDA_KW.some(k => t.startsWith(k) || t.includes(' ' + k))) tipo = 'salida';
    if (!tipo && !isMover && !isBuscar && !isPedir) { showParsedResult({ error: true, msg: 'No se entendió. Di "entrada", "salida", "buscar", "pedir" o "mover" al inicio.' }); return; }
    const numMatch = t.match(/(\d+(?:[.,]\d+)?)/); const cantidad = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;
    let matText = t, ubicOrigen = null, ubicDest = null;
    [...ENTRADA_KW, ...SALIDA_KW, ...MOVER_KW, ...BUSCAR_KW, ...PEDIR_KW].forEach(k => { matText = matText.replace(new RegExp('\\b' + k + '\\b', 'g'), ' '); });
    if (isMover) { const m = matText.match(/(.+?)\s+de\s+(.+?)\s+a\s+(.+)/); if (m) { matText = m[1]; ubicOrigen = m[2].trim(); ubicDest = m[3].trim(); } }
    else { const m = matText.match(/\s+(?:en|de)\s+(.+)$/); if (m) { ubicOrigen = m[1].trim(); matText = matText.replace(m[0], ''); } }
    if (cantidad !== null) matText = matText.replace(/\d+(?:[.,]\d+)?/, '');
    matText = matText.replace(/\b(unidades?|ud|uds|kg|metros?|litros?|piezas?)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (isBuscar) { searchMaterialVoice(matText || text); return; }
    if (isPedir) { voicePedir(matText, cantidad); return; }
    if (!matText || matText.length < 2) { showParsedResult({ error: true, msg: 'No entendí el material. Di el nombre claramente.' }); return; }
    lastParsed = { tipo: isMover ? 'mover' : tipo, cantidad: cantidad || 1, material: matText, ubicacion: ubicOrigen, ubicacionDestino: ubicDest, original: text };
    showParsedResult(lastParsed);
}
function showParsedResult(result) {
    const el = document.getElementById('parsedResult'); el.style.display = 'block';
    if (result.error) { el.innerHTML = `<div class="result-card" style="border-left-color:var(--warn);"><h3>⚠️ No entendido</h3><p style="font-size:13px;color:var(--text2);">${result.msg}</p><button class="btn btn-secondary" style="margin-top:8px;" onclick="clearVoice()">Intentar de nuevo</button></div>`; return; }
    const cls = result.tipo === 'entrada' ? 'entrada' : result.tipo === 'salida' ? 'salida' : '';
    const badge = result.tipo === 'entrada' ? '<span class="tipo-badge badge-entrada">↑ ENTRADA</span>' : result.tipo === 'salida' ? '<span class="tipo-badge badge-salida">↓ SALIDA</span>' : '<span class="tipo-badge" style="background:rgba(79,142,247,.15);color:var(--accent);">⇄ MOVER</span>';
    el.innerHTML = `<div class="result-card ${cls}"><h3>Movimiento detectado</h3>
    <div class="result-row"><span>Tipo</span><span class="val">${badge}</span></div>
    <div class="result-row"><span>Cantidad</span><span class="val">${result.cantidad}</span></div>
    <div class="result-row"><span>Material</span><span class="val">${result.material}</span></div>
    ${result.ubicacion ? `<div class="result-row"><span>${result.tipo === 'mover' ? 'Origen' : 'Ubicación'}</span><span class="val">${result.ubicacion}</span></div>` : ''}
    ${result.ubicacionDestino ? `<div class="result-row"><span>Destino</span><span class="val">${result.ubicacionDestino}</span></div>` : ''}
  </div>
  <div class="btn-row"><button class="btn btn-secondary" onclick="clearVoice()">✕ Cancelar</button><button class="btn btn-success" onclick="confirmVoiceAction()">✓ Confirmar</button></div>`;
}
function clearVoice() { document.getElementById('voiceText').textContent = 'Pulsa el micrófono para hablar'; document.getElementById('voiceText').classList.add('placeholder'); document.getElementById('parsedResult').style.display = 'none'; lastParsed = null; }
async function searchMaterialVoice(query) {
    const mats = await dbGetAll('materiales'), q = norm(query), canP = hasPermiso('verPrecios');
    const found = mats.filter(m => norm(m.nombre).includes(q));
    const el = document.getElementById('parsedResult'); el.style.display = 'block';
    if (!found.length) { el.innerHTML = `<div class="result-card" style="border-left-color:var(--warn);"><h3>Sin resultados</h3><p style="font-size:13px;color:var(--text2);">No se encontró: "${query}"</p><button class="btn btn-secondary" style="margin-top:8px;" onclick="clearVoice()">Cerrar</button></div>`; return; }
    el.innerHTML = `<div class="result-card"><h3>🔍 "${query}"</h3>${found.map(m => `<div class="result-row"><span>${m.nombre}</span><div style="text-align:right;"><span class="val" style="color:${m.cantidad <= 0 ? 'var(--danger)' : m.cantidad <= (m.minimo || 0) ? 'var(--warn)' : 'var(--success)'}">${m.cantidad} ${m.unidad || 'ud'}</span>${canP && m.precio ? `<div style="font-size:10px;color:var(--gold);">${m.precio.toFixed(2)} €/ud</div>` : ''}</div></div>`).join('')}</div><button class="btn btn-secondary" onclick="clearVoice()">Cerrar</button>`;
}
async function voicePedir(material, cantidad) {
    if (!hasPermiso('crearPedidos')) { toast('Sin permiso para crear pedidos', 'error'); clearVoice(); return; }
    const mats = await dbGetAll('materiales'), q = norm(material);
    const mat = mats.find(m => norm(m.nombre).includes(q));
    const el = document.getElementById('parsedResult'); el.style.display = 'block';
    el.innerHTML = `<div class="result-card" style="border-left-color:var(--warn);"><h3>🛒 Crear Pedido</h3>
    <div class="result-row"><span>Material</span><span class="val">${mat ? mat.nombre : material}</span></div>
    <div class="result-row"><span>Cantidad</span><span class="val">${cantidad || 1} ${mat?.unidad || 'ud'}</span></div>
    ${mat?.precio && hasPermiso('verPrecios') ? `<div class="result-row"><span>Coste estimado</span><span class="val" style="color:var(--gold);">${((cantidad || 1) * mat.precio).toFixed(2)} €</span></div>` : ''}
  </div>
  <div class="btn-row"><button class="btn btn-secondary" onclick="clearVoice()">✕</button><button class="btn btn-warn" onclick="confirmVoicePedido(${mat ? mat.id : 'null'},'${mat ? mat.nombre.replace(/'/g, "\\'") : material}',${cantidad || 1})">📋 Crear pedido</button></div>`;
}
async function confirmVoicePedido(matId, nombre, cantidad) {
    const mats = await dbGetAll('materiales'), mat = mats.find(m => m.id === matId);
    const lineas = [{ materialId: matId, nombre, cantidad, precio: mat?.precio || 0, subtotal: cantidad * (mat?.precio || 0) }];
    const now = new Date().toISOString();
    await dbAdd('pedidos', { proveedor: mat?.proveedor || '', estado: 'pendiente', notas: 'Creado por voz', lineas, total: lineas[0].subtotal, creadoPor: currentUser?.nombre || '', modificadoPor: '', modificadoEn: now, fecha: now, synced: 0 });
    clearVoice(); toast('✓ Pedido creado', 'success'); scheduleSyncSoon();
}
async function confirmVoiceAction() {
    if (!lastParsed) return; const p = lastParsed;
    const [mats, ubics] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones')]);
    const matQ = norm(p.material);
    let mat = mats.find(m => norm(m.nombre) === matQ) || mats.find(m => norm(m.nombre).includes(matQ) || matQ.includes(norm(m.nombre)));
    let ubicId = null;
    if (p.ubicacion) { const uQ = norm(p.ubicacion); const ub = ubics.find(u => norm(u.nombre) === uQ) || ubics.find(u => norm(u.nombre).includes(uQ) || uQ.includes(norm(u.nombre))); if (ub) ubicId = ub.id; }
    if (!mat) {
        showConfirmModal('Material no encontrado', `<p style="font-size:13px;color:var(--text2);">No existe "<strong>${p.material}</strong>". ¿Crearlo?</p>`, async () => {
            const now = new Date().toISOString();
            const newId = await dbAdd('materiales', { nombre: p.material, cantidad: p.tipo === 'entrada' ? p.cantidad : 0, unidad: 'ud', precio: 0, ubicacionId: ubicId, minimo: 0, creado: now, creadoPor: currentUser?.nombre || '', modificadoPor: '', modificadoEn: now, synced: 0 });
            await registerMovement(newId, p.tipo === 'entrada' ? 'entrada' : 'salida', p.cantidad, ubicId, null, p.original);
            clearVoice(); toast('✓ Material creado y movimiento registrado', 'success'); renderAll(); scheduleSyncSoon();
        }); return;
    }
    if (p.tipo === 'salida' && mat.cantidad < p.cantidad) { showConfirmModal('Stock insuficiente', `<p style="font-size:13px;color:var(--danger);">Solo hay <strong>${mat.cantidad} ${mat.unidad || 'ud'}</strong> de ${mat.nombre}. ¿Confirmar?</p>`, () => doMovement(mat, p, ubicId)); return; }
    await doMovement(mat, p, ubicId);
}
async function doMovement(mat, p, ubicId) {
    const delta = p.tipo === 'entrada' ? p.cantidad : -p.cantidad;
    mat.cantidad = Math.max(0, (mat.cantidad || 0) + delta);
    Object.assign(mat, auditStamp()); mat.synced = 0;
    if (ubicId) mat.ubicacionId = ubicId;
    await dbPut('materiales', mat);
    await registerMovement(mat.id, p.tipo, p.cantidad, ubicId || mat.ubicacionId, null, p.original);
    clearVoice(); toast(`✓ ${p.tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${p.cantidad} ${mat.unidad || 'ud'} de ${mat.nombre}`, 'success');
    renderAll(); scheduleSyncSoon();
}
async function registerMovement(matId, tipo, cantidad, ubicId, destUbicId, nota) {
    await dbAdd('movimientos', { materialId: matId, tipo, cantidad, ubicacionId: ubicId || null, ubicacionDestinoId: destUbicId || null, fecha: new Date().toISOString(), nota: nota || '', synced: 0, usuario: currentUser?.nombre || '' });
    updateSyncBadge();
}

// ══════════════════════════════════════════════
// PEDIDOS
// ══════════════════════════════════════════════
let currentPedTab = 'pendiente', pedLines = [], editingPedidoId = null;
async function openNewPedido() {
    editingPedidoId = null; pedLines = [{ materialId: null, nombre: '', cantidad: 1, precio: 0, subtotal: 0 }];
    document.getElementById('pedidoModalTitle').textContent = 'Nuevo Pedido';
    document.getElementById('pedidoSaveBtn').textContent = '📋 Crear pedido';
    document.getElementById('ped-proveedor').value = ''; document.getElementById('ped-notas').value = '';
    renderPedLines(); document.getElementById('pedidoModal').classList.add('open');
}
async function openEditPedido(id) {
    const peds = await dbGetAll('pedidos'); const p = peds.find(x => x.id === id); if (!p) return;
    editingPedidoId = id; pedLines = (p.lineas || []).map(l => ({ ...l }));
    document.getElementById('pedidoModalTitle').textContent = 'Editar Pedido';
    document.getElementById('pedidoSaveBtn').textContent = '💾 Guardar cambios';
    document.getElementById('ped-proveedor').value = p.proveedor || ''; document.getElementById('ped-notas').value = p.notas || '';
    renderPedLines(); document.getElementById('pedidoModal').classList.add('open');
}
async function renderPedLines() {
    const mats = await dbGetAll('materiales'), canP = hasPermiso('verPrecios');
    const el = document.getElementById('ped-lines');
    el.innerHTML = pedLines.map((l, i) => `
    <div style="background:var(--bg3);border-radius:var(--rs);padding:10px;margin-bottom:8px;">
      <div class="form-group" style="margin-bottom:6px;">
        <select onchange="pedLineMatChange(${i},this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:8px;color:var(--text);font-size:13px;">
          <option value="">— Seleccionar material —</option>
          ${mats.map(m => `<option value="${m.id}" ${l.materialId === m.id ? 'selected' : ''}>${m.nombre}${canP && m.precio ? ' (' + m.precio.toFixed(2) + '€/ud)' : ''}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="flex:1;">
          <label style="font-size:11px;color:var(--text2);">Cantidad</label>
          <input type="number" value="${l.cantidad}" min="1" onchange="pedLineQtyChange(${i},this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:7px;color:var(--text);font-size:13px;outline:none;">
        </div>
        ${canP ? `<div style="flex:1;"><label style="font-size:11px;color:var(--text2);">Precio/ud (€)</label><input type="number" value="${l.precio}" min="0" step="0.01" onchange="pedLinePrecioChange(${i},this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:7px;color:var(--text);font-size:13px;outline:none;"></div><span style="font-size:13px;color:var(--gold);min-width:60px;text-align:right;padding-top:18px;">${l.subtotal.toFixed(2)} €</span>` : ''}
        <button onclick="pedLineRemove(${i})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:7px 10px;cursor:pointer;margin-top:${canP ? '18px' : '0'};">✕</button>
      </div>
    </div>`).join('');
    updatePedTotal();
}
async function pedLineMatChange(i, matId) {
    const mats = await dbGetAll('materiales'), mat = mats.find(m => m.id === parseInt(matId));
    if (mat) { pedLines[i].materialId = mat.id; pedLines[i].nombre = mat.nombre; pedLines[i].precio = mat.precio || 0; pedLines[i].subtotal = pedLines[i].cantidad * (mat.precio || 0); }
    renderPedLines();
}
function pedLineQtyChange(i, qty) { pedLines[i].cantidad = parseFloat(qty) || 1; pedLines[i].subtotal = pedLines[i].cantidad * pedLines[i].precio; renderPedLines(); }
function pedLinePrecioChange(i, precio) { pedLines[i].precio = parseFloat(precio) || 0; pedLines[i].subtotal = pedLines[i].cantidad * pedLines[i].precio; renderPedLines(); }
function pedLineRemove(i) { pedLines.splice(i, 1); renderPedLines(); }
function addPedLine() { pedLines.push({ materialId: null, nombre: '', cantidad: 1, precio: 0, subtotal: 0 }); renderPedLines(); }
function updatePedTotal() { const t = pedLines.reduce((s, l) => s + l.subtotal, 0); const el = document.getElementById('ped-total'); if (el) el.textContent = t.toFixed(2) + ' €'; }
async function savePedido() {
    const prov = document.getElementById('ped-proveedor').value.trim(), notas = document.getElementById('ped-notas').value.trim();
    const validLines = pedLines.filter(l => l.materialId && l.cantidad > 0);
    if (!validLines.length) { toast('Añade al menos un material', 'error'); return; }
    const total = validLines.reduce((s, l) => s + l.subtotal, 0);
    const now = new Date().toISOString();
    if (editingPedidoId) {
        const peds = await dbGetAll('pedidos'); const p = peds.find(x => x.id === editingPedidoId);
        if (p) { Object.assign(p, { proveedor: prov, notas, lineas: validLines, total, ...auditStamp(), synced: 0 }); await dbPut('pedidos', p); }
        toast('✓ Pedido actualizado', 'success');
    } else {
        await dbAdd('pedidos', { proveedor: prov, estado: 'pendiente', notas, lineas: validLines, total, creadoPor: currentUser?.nombre || '', ...auditStamp(), fecha: now, synced: 0 });
        toast('✓ Pedido creado', 'success');
    }
    closeModal('pedidoModal'); renderPedidos(); scheduleSyncSoon();
}
function setPedTab(tab) {
    currentPedTab = tab;
    document.querySelectorAll('#screen-ped .tab').forEach((t, i) => t.classList.toggle('active', ['pendiente', 'aprobado', 'recibido'][i] === tab));
    renderPedidos();
}
async function renderPedidos() {
    if (!hasPermiso('verPedidos')) { document.getElementById('lock-ped').style.display = 'flex'; document.getElementById('ped-content').style.display = 'none'; return; }
    document.getElementById('lock-ped').style.display = 'none'; document.getElementById('ped-content').style.display = 'block';
    const peds = await dbGetAll('pedidos');
    const filtered = peds.filter(p => p.estado === currentPedTab).reverse();
    const canP = hasPermiso('verPrecios'), canAprobar = hasPermiso('aprobarPedidos'), canEditar = hasPermiso('editarPedidos');
    const el = document.getElementById('pedidosList');
    if (!filtered.length) { el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>No hay pedidos ${currentPedTab === 'pendiente' ? 'pendientes' : currentPedTab === 'aprobado' ? 'aprobados' : 'recibidos'}</p></div>`; return; }
    el.innerHTML = filtered.map(p => {
        const statusCls = 'ps-' + p.estado;
        const statusLabel = { pendiente: '⏳ Pendiente', aprobado: '✓ Aprobado', recibido: '📦 Recibido', cancelado: '✕ Cancelado' }[p.estado] || p.estado;
        const lineas = (p.lineas || []).map(l => `<div class="pedido-item-row"><span>${l.nombre || 'Material'} × ${l.cantidad}</span><span>${canP ? (l.subtotal || 0).toFixed(2) + ' €' : '—'}</span></div>`).join('');
        const acciones = [];
        if (p.estado === 'pendiente' && canAprobar) acciones.push(`<button class="btn btn-primary" onclick="cambiarEstadoPedido(${p.id},'aprobado')">✓ Aprobar</button>`);
        if (p.estado === 'aprobado') acciones.push(`<button class="btn btn-success" onclick="cambiarEstadoPedido(${p.id},'recibido')">📦 Recibido</button>`);
        if ((p.estado === 'pendiente' || p.estado === 'aprobado') && canEditar) acciones.push(`<button class="btn btn-edit" onclick="openEditPedido(${p.id})">✏️ Editar</button>`);
        if ((p.estado === 'pendiente' || p.estado === 'aprobado') && canAprobar) acciones.push(`<button class="btn btn-secondary" onclick="cambiarEstadoPedido(${p.id},'cancelado')">✕ Cancelar</button>`);
        const audit = fmtAudit({ creadoPor: p.creadoPor, modificadoPor: p.modificadoPor, modificadoEn: p.modificadoEn });
        return `<div class="pedido-card">
      <div class="pedido-header"><h3>${p.proveedor || 'Sin proveedor'}</h3><span class="pedido-status ${statusCls}">${statusLabel}</span></div>
      <div class="pedido-meta">${fmtDate(p.fecha)}${audit ? '<br><span style="color:var(--text3);font-size:10px;">' + audit + '</span>' : ''}</div>
      <div class="pedido-items">${lineas}</div>
      ${canP ? `<div class="pedido-total"><span>Total</span><span>${(p.total || 0).toFixed(2)} €</span></div>` : ''}
      ${acciones.length ? `<div class="pedido-actions">${acciones.join('')}</div>` : ''}
    </div>`;
    }).join('');
}
async function cambiarEstadoPedido(id, nuevoEstado) {
    const peds = await dbGetAll('pedidos'), ped = peds.find(p => p.id === id); if (!ped) return;
    if (nuevoEstado === 'recibido' && ped.lineas?.length) {
        for (const l of ped.lineas) {
            if (!l.materialId) continue;
            const mats = await dbGetAll('materiales'), mat = mats.find(m => m.id === l.materialId);
            if (mat) { mat.cantidad = (mat.cantidad || 0) + l.cantidad; Object.assign(mat, auditStamp()); mat.synced = 0; await dbPut('materiales', mat); await registerMovement(mat.id, 'entrada', l.cantidad, mat.ubicacionId, null, 'Pedido recibido: ' + ped.proveedor); }
        }
        toast('📦 Stock actualizado automáticamente', 'success');
    }
    Object.assign(ped, { estado: nuevoEstado, ...auditStamp(), synced: 0 });
    await dbPut('pedidos', ped); renderPedidos(); renderInventory(); scheduleSyncSoon();
    toast(`✓ Pedido ${nuevoEstado}`, 'success');
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
let currentMovTab = 'all', currentAdminTab = 'mat';
async function renderAll() { await Promise.all([renderInventory(), renderMovements(), renderAdmin(), renderPedidos(), updateStats()]); }

async function renderInventory() {
    const [mats, ubics] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones')]);
    const ubicMap = {}; ubics.forEach(u => ubicMap[u.id] = u);
    const sel = document.getElementById('filterUbic'); if (!sel) return;
    const cv = sel.value;
    sel.innerHTML = '<option value="">Todas</option>' + ubics.map(u => `<option value="${u.id}">${u.tipo === 'furgoneta' ? '🚐 ' : '🏭 '}${u.nombre}</option>`).join('');
    sel.value = cv; filterInventory(mats, ubics, ubicMap);
}
async function filterInventory(mats, ubics, ubicMap) {
    if (!mats) { [mats, ubics] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones')]); ubicMap = {}; ubics.forEach(u => ubicMap[u.id] = u); }
    const q = norm(document.getElementById('searchInput')?.value || ''), fU = document.getElementById('filterUbic')?.value, canP = hasPermiso('verPrecios');
    let f = mats; if (q) f = f.filter(m => norm(m.nombre).includes(q) || norm(m.proveedor || '').includes(q)); if (fU) f = f.filter(m => String(m.ubicacionId) === String(fU));
    const el = document.getElementById('inventoryList'); if (!el) return;
    if (!f.length) { el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg><p>${q ? 'Sin resultados' : 'Sin materiales'}</p></div>`; return; }
    const canEdit = hasPermiso('editarMaterial');
    el.innerHTML = f.map(m => {
        const ub = ubicMap[m.ubicacionId];
        const ubL = ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : ub.tipo === 'almacen' ? '🏭 ' : '📍 ') + ub.nombre : '—';
        const qc = m.cantidad <= 0 ? 'stock-zero' : m.cantidad <= (m.minimo || 0) ? 'stock-low' : '';
        const audit = fmtAudit(m);
        return `<div class="item-card">
      <div class="item-card-row">
        <div class="item-info">
          <h3>${m.nombre}${m.referencia ? ` <span style="font-size:10px;color:var(--text3);">[${m.referencia}]</span>` : ''}</h3>
          <div class="meta">${ubL}${m.proveedor ? ' · ' + m.proveedor : ''}</div>
          ${m.descripcion ? `<div class="meta" style="margin-top:2px;font-style:italic;">${m.descripcion}</div>` : ''}
          ${m.minimo && m.cantidad <= m.minimo ? `<div class="meta" style="color:var(--warn);">⚠️ Stock bajo (mín: ${m.minimo})</div>` : ''}
          ${audit ? `<div class="audit">${audit}</div>` : ''}
        </div>
        <div class="item-stock">
          <div class="qty ${qc}">${m.cantidad}</div>
          <div class="unit">${m.unidad || 'ud'}</div>
          ${canP && m.precio ? `<div class="price-tag">${m.precio.toFixed(2)} €/ud</div>` : ''}
        </div>
      </div>
      ${canEdit ? `<div class="card-actions"><button class="btn btn-edit" onclick="editMaterial(${m.id})">✏️ Editar</button></div>` : ''}
    </div>`;
    }).join('');
}

async function renderMovements() {
    const [movs, mats, ubics] = await Promise.all([dbGetAll('movimientos'), dbGetAll('materiales'), dbGetAll('ubicaciones')]);
    const matMap = {}, ubicMap = {}; mats.forEach(m => matMap[m.id] = m); ubics.forEach(u => ubicMap[u.id] = u);
    let f = [...movs].reverse(); if (currentMovTab !== 'all') f = f.filter(m => m.tipo === currentMovTab);
    const el = document.getElementById('movementsList'); if (!el) return;
    if (!f.length) { el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg><p>Sin movimientos</p></div>`; return; }
    el.innerHTML = f.slice(0, 150).map(mv => {
        const mat = matMap[mv.materialId], ub = ubicMap[mv.ubicacionId], isIn = mv.tipo === 'entrada';
        return `<div class="mov-item">
      <div class="mov-icon ${isIn ? 'mov-in' : 'mov-out'}">${isIn ? '↑' : '↓'}</div>
      <div class="mov-info">
        <h4>${mat ? mat.nombre : 'Material eliminado'}</h4>
        <p>${ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre + ' · ' : ''}<strong style="color:var(--text2);">${mv.usuario || '—'}</strong> · ${fmtDate(mv.fecha)}${!mv.synced ? ' · ⏳' : ' · ☁️'}</p>
        ${mv.nota ? `<p style="font-size:10px;color:var(--text3);font-style:italic;">"${mv.nota}"</p>` : ''}
      </div>
      <div class="mov-qty ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${mv.cantidad}</div>
    </div>`;
    }).join('');
}

async function renderAdmin() {
    if (!hasPermiso('gestionAdmin')) { const lk = document.getElementById('lock-admin'), ac = document.getElementById('admin-content'); if (lk) lk.style.display = 'flex'; if (ac) ac.style.display = 'none'; return; }
    const lk = document.getElementById('lock-admin'), ac = document.getElementById('admin-content'); if (lk) lk.style.display = 'none'; if (ac) ac.style.display = 'block';
    const [mats, ubics, users] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones'), dbGetAll('usuarios')]);
    const ubicMap = {}; ubics.forEach(u => ubicMap[u.id] = u);
    // Mat list
    const ml = document.getElementById('matList');
    if (ml) ml.innerHTML = mats.length ? mats.map(m => {
        const ub = ubicMap[m.ubicacionId], audit = fmtAudit(m);
        return `<div class="item-card" style="margin-bottom:8px;">
      <div class="item-card-row">
        <div class="item-info">
          <h3 style="font-size:13px;">${m.nombre}${m.referencia ? ` <span style="font-size:10px;color:var(--text3);">[${m.referencia}]</span>` : ''}</h3>
          <div class="meta">${ub ? ub.nombre : '—'} · ${m.precio || 0}€/ud · mín:${m.minimo || 0}${m.proveedor ? ' · ' + m.proveedor : ''}</div>
          ${audit ? `<div class="audit">${audit}</div>` : ''}
        </div>
        <div class="item-stock"><div class="qty" style="font-size:16px;">${m.cantidad}</div><div class="unit">${m.unidad || 'ud'}</div></div>
      </div>
      <div class="card-actions">
        <button class="btn btn-edit" onclick="editMaterial(${m.id})">✏️ Editar</button>
        <button class="btn btn-danger" onclick="deleteMaterial(${m.id})">✕ Eliminar</button>
      </div>
    </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Sin materiales</p>';
    // Ubic select in form
    const ms = document.getElementById('matUbic');
    if (ms) ms.innerHTML = '<option value="">Sin ubicación</option>' + ubics.map(u => `<option value="${u.id}">${u.tipo === 'furgoneta' ? '🚐 ' : '🏭 '}${u.nombre}</option>`).join('');
    // Ubic list
    const ul = document.getElementById('ubicList');
    if (ul) ul.innerHTML = ubics.length ? ubics.map(u => {
        const icon = u.tipo === 'furgoneta' ? '🚐' : u.tipo === 'almacen' ? '🏭' : u.tipo === 'obra' ? '🏗️' : '📍';
        const audit = fmtAudit(u);
        return `<div class="ubic-card">
      <div class="ubic-card-row">
        <div class="ubic-icon">${icon}</div>
        <div class="ubic-info">
          <h3>${u.nombre}</h3>
          <div class="meta">${u.tipo.charAt(0).toUpperCase() + u.tipo.slice(1)}${u.direccion ? ' · ' + u.direccion : ''}</div>
          ${u.descripcion ? `<div class="desc">${u.descripcion}</div>` : ''}
          ${audit ? `<div class="audit">${audit}</div>` : ''}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-edit" onclick="editUbicacion(${u.id})">✏️ Editar</button>
        <button class="btn btn-danger" onclick="deleteUbicacion(${u.id})">✕ Eliminar</button>
      </div>
    </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Sin ubicaciones</p>';
    // Users list
    const userList = document.getElementById('userList');
    if (userList) userList.innerHTML = users.map(u => {
        const r = ROLES[u.rol], audit = fmtAudit(u);
        return `<div class="user-card">
      <div class="user-card-row">
        <div class="user-avatar" style="background:${r.color}22;color:${r.color};">${u.nombre.charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <h3>${u.nombre}</h3>
          <div><span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span></div>
          ${audit ? `<div class="audit">${audit}</div>` : ''}
        </div>
        <div style="display:flex;gap:5px;">
          <button class="btn-icon btn-edit" onclick="editUser(${u.id})">✏️</button>
          <button class="btn-icon btn-danger" onclick="deleteUser(${u.id})">✕</button>
        </div>
      </div>
    </div>`;
    }).join('');
}

async function updateStats() {
    const [mats, ubics, movs] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones'), dbGetAll('movimientos')]);
    const g = id => document.getElementById(id);
    if (g('statMat')) g('statMat').textContent = mats.length; if (g('statUbic')) g('statUbic').textContent = ubics.length;
    if (g('statMov')) g('statMov').textContent = movs.length; if (g('statPend')) g('statPend').textContent = movs.filter(m => !m.synced).length;
    updateSyncBadge();
}
async function updateSyncBadge() {
    const movs = await dbGetAll('movimientos'); const p = movs.filter(m => !m.synced).length;
    const b = document.getElementById('sync-badge'); if (!b) return;
    b.textContent = p > 0 ? `⏳${p}` : '☁️'; b.className = 'status ' + (p > 0 ? 'offline' : 'online');
}

// ══════════════════════════════════════════════
// EDICIÓN — Material
// ══════════════════════════════════════════════
async function editMaterial(id) {
    const mats = await dbGetAll('materiales'), m = mats.find(x => x.id === id); if (!m) return;
    const ubics = await dbGetAll('ubicaciones');
    const ubicOpts = ubics.map(u => `<option value="${u.id}" ${m.ubicacionId === u.id ? 'selected' : ''}>${u.tipo === 'furgoneta' ? '🚐 ' : '🏭 '}${u.nombre}</option>`).join('');
    document.getElementById('editModalTitle').textContent = 'Editar Material';
    document.getElementById('editModalBody').innerHTML = `
    <div class="form-group"><label>Nombre</label><input id="em-nombre" type="text" value="${esc(m.nombre)}"></div>
    <div class="form-row">
      <div class="form-group"><label>Cantidad</label><input id="em-qty" type="number" value="${m.cantidad || 0}" min="0"></div>
      <div class="form-group"><label>Unidad</label><input id="em-unit" type="text" value="${esc(m.unidad || 'ud')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Precio/ud (€)</label><input id="em-precio" type="number" value="${m.precio || 0}" min="0" step="0.01"></div>
      <div class="form-group"><label>Stock mínimo</label><input id="em-min" type="number" value="${m.minimo || 0}" min="0"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Proveedor</label><input id="em-proveedor" type="text" value="${esc(m.proveedor || '')}"></div>
      <div class="form-group"><label>Referencia</label><input id="em-ref" type="text" value="${esc(m.referencia || '')}"></div>
    </div>
    <div class="form-group"><label>Ubicación</label><select id="em-ubic"><option value="">Sin ubicación</option>${ubicOpts}</select></div>
    <div class="form-group"><label>Descripción / Notas</label><textarea id="em-desc" rows="2" style="resize:none;">${esc(m.descripcion || '')}</textarea></div>`;
    document.getElementById('editModalSave').onclick = async () => {
        const cantidadAnterior = m.cantidad;
        const cantidadNueva = parseFloat(document.getElementById('em-qty').value) || 0;
        m.nombre = document.getElementById('em-nombre').value.trim() || m.nombre;
        m.cantidad = cantidadNueva;
        m.unidad = document.getElementById('em-unit').value.trim() || 'ud';
        m.precio = parseFloat(document.getElementById('em-precio').value) || 0;
        m.minimo = parseInt(document.getElementById('em-min').value) || 0;
        m.proveedor = document.getElementById('em-proveedor').value.trim();
        m.referencia = document.getElementById('em-ref').value.trim();
        m.ubicacionId = parseInt(document.getElementById('em-ubic').value) || null;
        m.descripcion = document.getElementById('em-desc').value.trim();
        Object.assign(m, auditStamp()); m.synced = 0;
        await dbPut('materiales', m);
        // Registrar ajuste si cambia cantidad
        if (cantidadNueva !== cantidadAnterior) {
            const diff = cantidadNueva - cantidadAnterior;
            await registerMovement(m.id, diff > 0 ? 'entrada' : 'salida', Math.abs(diff), m.ubicacionId, null, 'Ajuste manual');
        }
        closeModal('editModal'); toast('✓ Material actualizado', 'success'); renderAll(); scheduleSyncSoon();
    };
    document.getElementById('editModal').classList.add('open');
}

// ══════════════════════════════════════════════
// EDICIÓN — Ubicación
// ══════════════════════════════════════════════
async function editUbicacion(id) {
    const ubics = await dbGetAll('ubicaciones'), u = ubics.find(x => x.id === id); if (!u) return;
    document.getElementById('editModalTitle').textContent = 'Editar Ubicación';
    document.getElementById('editModalBody').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Nombre</label><input id="eu-nombre" type="text" value="${esc(u.nombre)}"></div>
      <div class="form-group"><label>Tipo</label>
        <select id="eu-tipo">
          <option value="almacen" ${u.tipo === 'almacen' ? 'selected' : ''}>Almacén</option>
          <option value="furgoneta" ${u.tipo === 'furgoneta' ? 'selected' : ''}>Furgoneta</option>
          <option value="obra" ${u.tipo === 'obra' ? 'selected' : ''}>Obra</option>
          <option value="otro" ${u.tipo === 'otro' ? 'selected' : ''}>Otro</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Dirección / Matrícula</label><input id="eu-dir" type="text" value="${esc(u.direccion || '')}"></div>
    <div class="form-group"><label>Descripción</label><textarea id="eu-desc" rows="3" style="resize:none;">${esc(u.descripcion || '')}</textarea></div>`;
    document.getElementById('editModalSave').onclick = async () => {
        u.nombre = document.getElementById('eu-nombre').value.trim() || u.nombre;
        u.tipo = document.getElementById('eu-tipo').value;
        u.direccion = document.getElementById('eu-dir').value.trim();
        u.descripcion = document.getElementById('eu-desc').value.trim();
        Object.assign(u, auditStamp()); u.synced = 0;
        await dbPut('ubicaciones', u);
        closeModal('editModal'); toast('✓ Ubicación actualizada', 'success'); renderAll(); scheduleSyncSoon();
    };
    document.getElementById('editModal').classList.add('open');
}

// ══════════════════════════════════════════════
// EDICIÓN — Usuario
// ══════════════════════════════════════════════
async function editUser(id) {
    const users = await dbGetAll('usuarios'), u = users.find(x => x.id === id); if (!u) return;
    document.getElementById('editModalTitle').textContent = 'Editar Usuario';
    document.getElementById('editModalBody').innerHTML = `
    <div class="form-group"><label>Nombre</label><input id="eu2-nombre" type="text" value="${esc(u.nombre)}"></div>
    <div class="form-group"><label>Rol</label>
      <select id="eu2-rol">
        <option value="operario" ${u.rol === 'operario' ? 'selected' : ''}>👷 Operario</option>
        <option value="encargado" ${u.rol === 'encargado' ? 'selected' : ''}>🔑 Encargado</option>
        <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>👑 Administrador</option>
      </select>
    </div>
    <div class="form-group"><label>Nuevo PIN (dejar vacío para no cambiar)</label><input id="eu2-pin" type="password" maxlength="4" inputmode="numeric" placeholder="——"></div>`;
    document.getElementById('editModalSave').onclick = async () => {
        const nombre = document.getElementById('eu2-nombre').value.trim();
        const rol = document.getElementById('eu2-rol').value;
        const pin = document.getElementById('eu2-pin').value.trim();
        if (!nombre) { toast('El nombre no puede estar vacío', 'error'); return; }
        if (pin && !/^\d{4}$/.test(pin)) { toast('El PIN debe ser 4 dígitos', 'error'); return; }
        u.nombre = nombre; u.rol = rol; if (pin) u.pin = pin;
        Object.assign(u, auditStamp()); u.synced = 0;
        await dbPut('usuarios', u);
        // Si es el usuario actual, actualizar sesión
        if (currentUser?.id === u.id) { currentUser = u; updateTopbarUser(); applyRoleUI(); }
        closeModal('editModal'); toast('✓ Usuario actualizado', 'success'); renderAdmin(); scheduleSyncSoon();
    };
    document.getElementById('editModal').classList.add('open');
}

// ══════════════════════════════════════════════
// ACCIONES CRUD
// ══════════════════════════════════════════════
function esc(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function addUser() {
    const n = document.getElementById('newUserNombre').value.trim();
    const rol = document.getElementById('newUserRol').value;
    const pin = document.getElementById('newUserPin').value.trim();
    if (!n) { toast('Escribe el nombre', 'error'); return; }
    if (!/^\d{4}$/.test(pin)) { toast('PIN de 4 dígitos', 'error'); return; }
    const now = new Date().toISOString();
    await dbAdd('usuarios', { nombre: n, rol, pin, creado: now, creadoPor: currentUser?.nombre || '', ...auditStamp(), synced: 0 });
    document.getElementById('newUserNombre').value = ''; document.getElementById('newUserPin').value = '';
    toast('✓ Usuario añadido', 'success'); renderAdmin(); scheduleSyncSoon();
}
async function deleteUser(id) {
    if (currentUser?.id === id) { toast('No puedes eliminarte a ti mismo', 'error'); return; }
    showConfirmModal('Eliminar usuario', '<p style="font-size:13px;color:var(--text2);">¿Eliminar este usuario?</p>', async () => { await dbDelete('usuarios', id); toast('Usuario eliminado', 'success'); renderAdmin(); });
}
async function addMaterial() {
    const n = document.getElementById('matNombre').value.trim(); if (!n) { toast('Escribe el nombre', 'error'); return; }
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unit = document.getElementById('matUnit').value.trim() || 'ud';
    const precio = parseFloat(document.getElementById('matPrecio').value) || 0;
    const ubicId = parseInt(document.getElementById('matUbic').value) || null;
    const min = parseInt(document.getElementById('matMin').value) || 0;
    const proveedor = document.getElementById('matProveedor').value.trim();
    const ref = document.getElementById('matRef').value.trim();
    const desc = document.getElementById('matDesc').value.trim();
    const now = new Date().toISOString();
    const id = await dbAdd('materiales', { nombre: n, cantidad: qty, unidad: unit, precio, ubicacionId: ubicId, minimo: min, proveedor, referencia: ref, descripcion: desc, creado: now, creadoPor: currentUser?.nombre || '', ...auditStamp(), synced: 0 });
    if (qty > 0) await registerMovement(id, 'entrada', qty, ubicId, null, 'Inventario inicial');
    ['matNombre', 'matUnit', 'matProveedor', 'matRef', 'matDesc'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
    ['matQty', 'matPrecio', 'matMin'].forEach(i => { const el = document.getElementById(i); if (el) el.value = '0'; });
    toast('✓ Material añadido', 'success'); renderAll(); scheduleSyncSoon();
}
async function deleteMaterial(id) { showConfirmModal('Eliminar material', '<p style="font-size:13px;color:var(--text2);">¿Eliminar este material?</p>', async () => { await dbDelete('materiales', id); toast('Eliminado', 'success'); renderAll(); }); }

async function addUbicacion() {
    const n = document.getElementById('ubicNombre').value.trim(); if (!n) { toast('Escribe el nombre', 'error'); return; }
    const tipo = document.getElementById('ubicTipo').value;
    const dir = document.getElementById('ubicDireccion').value.trim();
    const desc = document.getElementById('ubicDesc').value.trim();
    const now = new Date().toISOString();
    await dbAdd('ubicaciones', { nombre: n, tipo, direccion: dir, descripcion: desc, creado: now, creadoPor: currentUser?.nombre || '', ...auditStamp(), synced: 0 });
    document.getElementById('ubicNombre').value = ''; document.getElementById('ubicDireccion').value = ''; document.getElementById('ubicDesc').value = '';
    toast('✓ Ubicación añadida', 'success'); renderAll(); scheduleSyncSoon();
}
async function deleteUbicacion(id) { await dbDelete('ubicaciones', id); toast('Eliminada', 'success'); renderAll(); }

async function exportCSV(tipo) {
    const [mats, ubics, movs, peds] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones'), dbGetAll('movimientos'), dbGetAll('pedidos')]);
    const matMap = {}, ubicMap = {}; mats.forEach(m => matMap[m.id] = m); ubics.forEach(u => ubicMap[u.id] = u);
    const canP = hasPermiso('verPrecios');
    let csv = '', fn = '';
    if (tipo === 'inventario' || tipo === 'todo') {
        csv += 'INVENTARIO\nID,Nombre,Referencia,Cantidad,Unidad,Precio (€),Proveedor,Ubicación,Stock Mínimo,Descripción,Creado por,Modificado por,Modificado en\n';
        csv += mats.map(m => [m.id, `"${m.nombre}"`, `"${m.referencia || ''}"`, m.cantidad, m.unidad || 'ud', canP ? m.precio || 0 : '***', `"${m.proveedor || ''}"`, `"${ubicMap[m.ubicacionId]?.nombre || ''}"`, m.minimo || 0, `"${m.descripcion || ''}"`, `"${m.creadoPor || ''}"`, `"${m.modificadoPor || ''}"`, m.modificadoEn || ''].join(',')).join('\n') + '\n\n';
        fn = 'inventario.csv';
    }
    if (tipo === 'ubicaciones' || tipo === 'todo') {
        csv += 'UBICACIONES\nID,Nombre,Tipo,Dirección,Descripción,Creado por,Modificado por,Modificado en\n';
        csv += ubics.map(u => [u.id, `"${u.nombre}"`, u.tipo, `"${u.direccion || ''}"`, `"${u.descripcion || ''}"`, `"${u.creadoPor || ''}"`, `"${u.modificadoPor || ''}"`, u.modificadoEn || ''].join(',')).join('\n') + '\n\n';
        if (tipo === 'ubicaciones') fn = 'ubicaciones.csv';
    }
    if (tipo === 'movimientos' || tipo === 'todo') {
        csv += 'MOVIMIENTOS\nID,Tipo,Material,Cantidad,Ubicación,Fecha,Usuario,Nota\n';
        csv += movs.map(mv => [mv.id, mv.tipo, `"${matMap[mv.materialId]?.nombre || ''}"`, mv.cantidad, `"${ubicMap[mv.ubicacionId]?.nombre || ''}"`, mv.fecha, `"${mv.usuario || ''}"`, `"${mv.nota || ''}"`].join(',')).join('\n') + '\n\n';
        if (tipo === 'movimientos') fn = 'movimientos.csv';
    }
    if (tipo === 'pedidos' || tipo === 'todo') {
        csv += 'PEDIDOS\nID,Proveedor,Estado,Total (€),Fecha,Creado por,Modificado por,Modificado en,Notas\n';
        csv += peds.map(p => [p.id, `"${p.proveedor || ''}"`, p.estado, canP ? (p.total || 0).toFixed(2) : '***', p.fecha, `"${p.creadoPor || ''}"`, `"${p.modificadoPor || ''}"`, p.modificadoEn || '', `"${p.notas || ''}"`].join(',')).join('\n') + '\n\n';
        if (tipo === 'pedidos') fn = 'pedidos.csv';
    }
    if (tipo === 'todo') fn = 'stockvoz_completo.csv';
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; a.click(); URL.revokeObjectURL(url);
    toast('✓ CSV exportado', 'success');
}

async function loadSampleData() {
    showConfirmModal('Cargar datos de ejemplo', '<p style="font-size:13px;color:var(--text2);">Se añadirán ubicaciones, materiales y usuarios de ejemplo.</p>', async () => {
        const now = new Date().toISOString(); const by = currentUser?.nombre || 'sistema';
        const audit0 = { creadoPor: by, ...auditStamp(), synced: 0, creado: now };
        const u1 = await dbAdd('ubicaciones', { nombre: 'Almacén Central', tipo: 'almacen', direccion: 'Polígono Industrial Norte, nave 3', descripcion: 'Almacén principal. Acceso con tarjeta. Horario 7-20h.', ...audit0 });
        const u2 = await dbAdd('ubicaciones', { nombre: 'Almacén B', tipo: 'almacen', direccion: 'Polígono Industrial Norte, nave 7', descripcion: 'Almacén secundario para materiales de obra.', ...audit0 });
        const u3 = await dbAdd('ubicaciones', { nombre: 'Furgoneta 1', tipo: 'furgoneta', direccion: 'Matrícula: 1234 ABC', descripcion: 'Furgoneta de Juan García. Revisión en marzo.', ...audit0 });
        const u4 = await dbAdd('ubicaciones', { nombre: 'Furgoneta 2', tipo: 'furgoneta', direccion: 'Matrícula: 5678 XYZ', descripcion: 'Furgoneta de María López.', ...audit0 });
        const u5 = await dbAdd('ubicaciones', { nombre: 'Obra Norte', tipo: 'obra', direccion: 'C/ Rosalía de Castro 42, Vigo', descripcion: 'Reforma local comercial. Fin previsto: junio.', ...audit0 });
        const samples = [
            { nombre: 'Tornillo M8 x 30', cantidad: 500, unidad: 'ud', precio: 0.05, ubicacionId: u1, minimo: 50, proveedor: 'Tornillería García', referencia: 'TG-M8-30', descripcion: 'Acero inoxidable A2' },
            { nombre: 'Cable eléctrico 2.5mm', cantidad: 150, unidad: 'm', precio: 1.20, ubicacionId: u2, minimo: 20, proveedor: 'ElecDist', referencia: 'ED-225', descripcion: 'Cable flexible H07V-K' },
            { nombre: 'Brida nylon negra', cantidad: 1000, unidad: 'ud', precio: 0.02, ubicacionId: u3, minimo: 100, proveedor: '', referencia: '', descripcion: '200x4.8mm' },
            { nombre: 'Cinta aislante roja', cantidad: 24, unidad: 'ud', precio: 1.80, ubicacionId: u3, minimo: 5, proveedor: 'ElecDist', referencia: 'ED-CTA-R', descripcion: '' },
            { nombre: 'Interruptor simple blanco', cantidad: 15, unidad: 'ud', precio: 3.50, ubicacionId: u4, minimo: 5, proveedor: 'ElecDist', referencia: 'ED-IS-BL', descripcion: '10A 250V' },
            { nombre: 'Hormigón seco 25kg', cantidad: 12, unidad: 'saco', precio: 6.90, ubicacionId: u5, minimo: 3, proveedor: 'Materiales López', referencia: 'ML-H25', descripcion: 'CEM II/B-L 32,5 N' },
        ];
        for (const m of samples) { const id = await dbAdd('materiales', { ...m, creado: now, ...audit0 }); await registerMovement(id, 'entrada', m.cantidad, m.ubicacionId, null, 'Stock inicial'); }
        const us = await dbGetAll('usuarios');
        if (!us.find(u => u.nombre === 'Encargado')) { await dbAdd('usuarios', { nombre: 'Encargado', rol: 'encargado', pin: '1234', creado: now, ...audit0 }); }
        if (!us.find(u => u.nombre === 'Operario 1')) { await dbAdd('usuarios', { nombre: 'Operario 1', rol: 'operario', pin: '0000', creado: now, ...audit0 }); }
        toast('✓ Datos de ejemplo cargados', 'success'); renderAll(); scheduleSyncSoon();
    });
}
async function clearAllData() {
    showConfirmModal('⚠️ Borrar TODO', '<p style="font-size:13px;color:var(--danger);font-weight:600;">Se eliminan TODOS los datos locales incluyendo usuarios.</p>', async () => {
        for (const s of ['materiales', 'ubicaciones', 'movimientos', 'pedidos']) await dbClear(s);
        localStorage.removeItem('last_pull'); toast('Datos eliminados', 'error'); doLogout();
    });
}

// ══════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════
function showScreen(name) {
    if (name === 'ped' && !hasPermiso('verPedidos')) { toast('Sin permiso', 'error'); return; }
    if (name === 'admin' && !hasPermiso('gestionAdmin')) { toast('Solo administradores', 'error'); return; }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
    document.getElementById('nav-' + name).classList.add('active');
    if (name === 'inv') renderInventory(); else if (name === 'mov') renderMovements();
    else if (name === 'ped') renderPedidos(); else if (name === 'admin') { renderAdmin(); updateStats(); }
}
function setMovTab(tab) { currentMovTab = tab; document.querySelectorAll('#screen-mov .tab').forEach((t, i) => t.classList.toggle('active', ['all', 'entrada', 'salida'][i] === tab)); renderMovements(); }
function setAdminTab(tab) {
    currentAdminTab = tab;
    ['mat', 'ubic', 'users', 'sync', 'export'].forEach(t => { const el = document.getElementById('admin-' + t); if (el) el.style.display = t === tab ? 'block' : 'none'; });
    document.querySelectorAll('#screen-admin .tabs .tab').forEach((t, i) => t.classList.toggle('active', ['mat', 'ubic', 'users', 'sync', 'export'][i] === tab));
    if (tab === 'sync') renderSyncScreen(); else if (tab !== 'mat') renderAdmin();
}
function showConfirmModal(title, body, onConfirm, confirmLabel = 'Confirmar') {
    document.getElementById('confirmTitle').textContent = title; document.getElementById('confirmBody').innerHTML = body;
    document.getElementById('confirmBtn').textContent = confirmLabel;
    document.getElementById('confirmBtn').onclick = () => { closeModal('confirmModal'); onConfirm(); };
    document.getElementById('confirmModal').classList.add('open');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
let toastTimer;
function toast(msg, type = '') { const el = document.getElementById('toast'); el.textContent = msg; el.className = 'show ' + type; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 3000); }
function updateNetStatus() {
    const el = document.getElementById('net-status'); if (!el) return;
    if (navigator.onLine) { el.textContent = 'Online'; el.className = 'status online'; scheduleSyncSoon(); }
    else { el.textContent = 'Offline'; el.className = 'status offline'; }
}
window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
(async () => {
    await initDB(); initVoice(); await initLogin();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
