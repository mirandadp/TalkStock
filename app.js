// ══════════════════════════════════════════════
// ROLES Y PERMISOS
// ══════════════════════════════════════════════
const ROLES = {
    admin: { label: 'Administrador', color: '#f1c40f', cls: 'role-admin', emoji: '👑' },
    encargado: { label: 'Encargado', color: '#4f8ef7', cls: 'role-encargado', emoji: '🔑' },
    operario: { label: 'Operario', color: '#2ecc71', cls: 'role-operario', emoji: '👷' },
    lector_presencia: { label: 'Lector Presencia', color: '#9b59b6', cls: 'role-lector', emoji: '📋' }
};

// Permisos por rol
const CAN = {
    verPrecios: r => r === 'admin' || r === 'encargado',
    verPedidos: r => r === 'admin' || r === 'encargado',
    crearPedidos: r => r === 'admin' || r === 'encargado',
    aprobarPedidos: r => r === 'admin',
    gestionAdmin: r => r === 'admin',
    moverStock: r => true,
    verMovimientos: r => true,
    verFichajes: r => r === 'admin' || r === 'lector_presencia'
};

let currentUser = null; // { id, nombre, rol, pin }

function getCurrentUser() { return currentUser; }
function hasPermiso(perm) { return currentUser && CAN[perm]?.(currentUser.rol); }

// ── Auditoría: quién creó / modificó cada registro ──
function auditNuevo() { const u = currentUser?.nombre || 'sistema'; const now = new Date().toISOString(); return { creadoPor: u, modificadoPor: u, modificadoEn: now }; }
function auditMod() { return { modificadoPor: currentUser?.nombre || '', modificadoEn: new Date().toISOString() }; }
function fmtAudit(r) {
    const parts = [];
    if (r.creadoPor) parts.push('Creado por ' + r.creadoPor);
    if (r.modificadoPor && r.modificadoPor !== r.creadoPor) parts.push('· Editado por ' + r.modificadoPor);
    if (r.modificadoEn) parts.push('· ' + new Date(r.modificadoEn).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }));
    return parts.join(' ');
}
function esc(s) { return (s || '').toString().replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ══════════════════════════════════════════════
// INDEXEDDB
// ══════════════════════════════════════════════
let db;
const DB_NAME = 'StockVozDB', DB_VER = 7;

function initDB() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('materiales')) d.createObjectStore('materiales', { keyPath: 'id', autoIncrement: true });
            if (!d.objectStoreNames.contains('ubicaciones')) d.createObjectStore('ubicaciones', { keyPath: 'id', autoIncrement: true });
            if (!d.objectStoreNames.contains('movimientos')) {
                const mv = d.createObjectStore('movimientos', { keyPath: 'id', autoIncrement: true });
                mv.createIndex('synced', 'synced', { unique: false });
            }
            if (!d.objectStoreNames.contains('usuarios')) d.createObjectStore('usuarios', { keyPath: 'id', autoIncrement: true });
            if (!d.objectStoreNames.contains('pedidos')) d.createObjectStore('pedidos', { keyPath: 'id', autoIncrement: true });
            if (!d.objectStoreNames.contains('fichajes')) d.createObjectStore('fichajes', { keyPath: 'id', autoIncrement: true });
            if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
        };
        req.onsuccess = e => { db = e.target.result; res(db); };
        req.onerror = () => rej(req.error);
    });
}

// ── Config global de la app (clave/valor), sincronizable ──
async function getConfigValue(key, defaultVal) {
    try {
        const row = await dbTx('config', 'readonly', s => s.get(key));
        return row ? row.value : defaultVal;
    } catch (e) { return defaultVal; }
}
async function setConfigValue(key, value) {
    const now = new Date().toISOString();
    await dbPut('config', { key, value, modificadoPor: currentUser?.nombre || '', modificadoEn: now, synced: 0 });
    if (typeof scheduleSyncSoon === 'function') scheduleSyncSoon();
}
function dbTx(store, mode, fn) {
    return new Promise((res, rej) => {
        const tx = db.transaction(store, mode), s = tx.objectStore(store), req = fn(s);
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
}
const dbGetAll = store => dbTx(store, 'readonly', s => s.getAll());
const dbAdd = (store, data) => dbTx(store, 'readwrite', s => s.add(data));
const dbPut = (store, data) => dbTx(store, 'readwrite', s => s.put(data));
const dbDelete = (store, key) => dbTx(store, 'readwrite', s => s.delete(key));
function dbClear(store) { return new Promise(res => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); tx.oncomplete = res; }); }

// ══════════════════════════════════════════════
// LOGIN / USUARIOS
// ══════════════════════════════════════════════
let pinBuffer = '';

// ── Helpers de visibilidad de secciones del login ──
function loginShowSection(name) {
    const sections = ['login-checking', 'cloud-check-section', 'user-select-wrap', 'pin-section', 'first-setup'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === name) ? 'block' : 'none';
    });
    const titleEl = document.getElementById('login-title-text');
    if (titleEl) titleEl.style.display = (name === 'user-select-wrap') ? 'block' : 'none';
    const notice = document.getElementById('cloud-empty-notice');
    if (notice && name !== 'first-setup') notice.style.display = 'none';
}

/**
 * Punto de entrada del login. Antes de decidir si mostrar
 * "crear primer administrador", comprueba si ya existe una base
 * de datos remota configurada en este dispositivo (localStorage)
 * y, de ser así, sincroniza primero para ver si ya hay usuarios
 * en la nube. Solo si no hay ninguna nube configurada Y tampoco
 * hay usuarios locales, se pregunta al usuario si es la primera
 * instalación o si debe conectarse a una nube existente.
 */
async function initLogin() {
    loginShowSection('login-checking');

    let usuarios = await dbGetAll('usuarios');

    // Si ya hay usuarios localmente, ir directo al selector (flujo normal)
    if (usuarios.length) {
        // Intentar sincronizar en segundo plano si hay credenciales guardadas
        const { url, key } = getSBConfig();
        if (url && key && initSupabase() && navigator.onLine) {
            try { await pullRemoteData(); usuarios = await dbGetAll('usuarios'); } catch (e) { }
        }
        showLoginUserSelect(usuarios);
        return;
    }

    // No hay usuarios locales. ¿Hay credenciales de nube guardadas en este dispositivo?
    const { url, key } = getSBConfig();
    if (url && key) {
        // Ya se configuró la nube antes en este dispositivo — comprobar ahí primero
        if (initSupabase()) {
            if (navigator.onLine) {
                try { await pullRemoteData(); } catch (e) { }
            }
            usuarios = await dbGetAll('usuarios');
            if (usuarios.length) { showLoginUserSelect(usuarios); return; }
            // Conectado pero la nube tampoco tiene usuarios — permitir crear el primero
            loginShowSection('first-setup');
            const notice = document.getElementById('cloud-empty-notice');
            if (notice) notice.style.display = 'block';
            return;
        }
    }

    // Sin usuarios locales y sin nube configurada — preguntar al usuario
    loginShowSection('cloud-check-section');
}

function showLoginUserSelect(usuarios) {
    const sel = document.getElementById('login-user-sel');
    sel.innerHTML = '<option value="">— Seleccionar —</option>';
    usuarios.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.nombre + ' (' + (ROLES[u.rol]?.emoji || '') + ')';
        sel.appendChild(opt);
    });
    loginShowSection('user-select-wrap');
    // Auto-login si hay sesión guardada
    const saved = localStorage.getItem('sv_session');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            const u = usuarios.find(x => x.id === s.id);
            if (u) { doLogin(u); return; }
        } catch (e) { }
    }
}

// ── Pantalla intermedia: conectar a la nube y comprobar usuarios ──
async function connectCloudAndCheck() {
    const url = document.getElementById('login-cloud-url').value.trim();
    const key = document.getElementById('login-cloud-key').value.trim();
    if (!url || !key) { toast('Rellena URL y API Key', 'error'); return; }
    if (!url.startsWith('https://')) { toast('La URL debe empezar con https://', 'error'); return; }
    if (!navigator.onLine) { toast('Sin conexión a internet', 'error'); return; }

    const btn = document.getElementById('cloud-connect-btn');
    const origText = btn.textContent;
    btn.textContent = 'Conectando…'; btn.disabled = true;

    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    SB = null;

    try {
        if (!initSupabase()) { throw new Error('No se pudo inicializar la conexión'); }
        await pullRemoteData();
        const usuarios = await dbGetAll('usuarios');
        if (usuarios.length) {
            toast('✓ Conectado — usuarios encontrados', 'success');
            showLoginUserSelect(usuarios);
        } else {
            toast('☁️ Conectado, pero sin usuarios en la nube', '');
            loginShowSection('first-setup');
            const notice = document.getElementById('cloud-empty-notice');
            if (notice) notice.style.display = 'block';
        }
    } catch (e) {
        toast('Error al conectar: ' + (e.message || e), 'error');
        localStorage.removeItem('sb_url');
        localStorage.removeItem('sb_key');
        SB = null;
    } finally {
        btn.textContent = origText; btn.disabled = false;
    }
}

// ── El usuario indica que es la primera instalación real (sin nube previa) ──
function skipCloudCheck() {
    loginShowSection('first-setup');
}

// ── Volver a la pantalla de comprobación de nube desde cualquier punto ──
function showCloudCheckAgain() {
    const { url, key } = getSBConfig();
    const urlInput = document.getElementById('login-cloud-url');
    const keyInput = document.getElementById('login-cloud-key');
    if (urlInput) urlInput.value = url || '';
    if (keyInput) keyInput.value = key || '';
    loginShowSection('cloud-check-section');
}

async function createFirstAdmin() {
    const n = document.getElementById('setup-nombre').value.trim();
    const p = document.getElementById('setup-pin').value.trim();
    if (!n) { toast('Escribe tu nombre', 'error'); return; }
    if (!/^\d{4}$/.test(p)) { toast('El PIN debe ser 4 dígitos', 'error'); return; }
    const now = new Date().toISOString();
    const id = await dbAdd('usuarios', { nombre: n, rol: 'admin', pin: p, creado: now, creadoPor: n, modificadoPor: n, modificadoEn: now, synced: 0 });
    toast('✓ Administrador creado. Accede ahora.', 'success');
    // Si hay conexión a la nube ya configurada, subir el nuevo admin inmediatamente
    if (SB && navigator.onLine) { try { await syncNow(); } catch (e) { } }
    const usuarios = await dbGetAll('usuarios');
    showLoginUserSelect(usuarios);
}

function onUserSelect() {
    const id = parseInt(document.getElementById('login-user-sel').value);
    if (!id) { document.getElementById('pin-section').style.display = 'none'; return; }
    document.getElementById('pin-section').style.display = 'block';
    document.getElementById('user-select-wrap').style.display = 'none';
    document.getElementById('login-title-text').textContent = 'Introduce tu PIN';
    pinBuffer = '';
    renderPinDots();
    // Mostrar badge de rol
    dbGetAll('usuarios').then(us => {
        const u = us.find(x => x.id === id);
        if (u) {
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

function pinPress(d) {
    if (pinBuffer.length >= 4) return;
    pinBuffer += d;
    renderPinDots();
    if (pinBuffer.length === 4) setTimeout(checkPin, 200);
}
function pinDel() { if (pinBuffer.length > 0) { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); } }
function renderPinDots() {
    for (let i = 0; i < 4; i++) document.getElementById('pd' + i).className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '');
}

async function checkPin() {
    const id = parseInt(document.getElementById('login-user-sel').value);
    const usuarios = await dbGetAll('usuarios');
    const u = usuarios.find(x => x.id === id);
    if (u && u.pin === pinBuffer) {
        doLogin(u);
    } else {
        toast('PIN incorrecto', 'error');
        pinBuffer = '';
        renderPinDots();
    }
}

function doLogin(u) {
    currentUser = u;
    localStorage.setItem('sv_session', JSON.stringify({ id: u.id }));
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    updateTopbarUser();
    applyRoleUI();
    if (currentUser.rol === 'lector_presencia') {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app').style.display = 'flex';
        if (initSupabase()) { startRealtime(); scheduleSyncSoon(); }
        updateNetStatus();
        showScreen('fichaje');
        return;
    }
    renderAll();
    if (initSupabase()) { startRealtime(); scheduleSyncSoon(); }
    updateNetStatus();
}

function doLogout() {
    closeModal('userMenuModal');
    if (typeof stopConfigPolling === 'function') stopConfigPolling();
    if (typeof stopRealtime === 'function') stopRealtime();
    currentUser = null;
    localStorage.removeItem('sv_session');
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').classList.remove('hidden');
    pinBuffer = '';
    renderPinDots();
    backToUserSelect();
    initLogin();
}

function updateTopbarUser() {
    if (!currentUser) return;
    const r = ROLES[currentUser.rol];
    document.getElementById('topbar-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
    document.getElementById('topbar-avatar').style.background = r.color + '33';
    document.getElementById('topbar-avatar').style.color = r.color;
    document.getElementById('topbar-name').textContent = currentUser.nombre;
}

function applyRoleUI() {
    if (!currentUser) return;
    const rol = currentUser.rol;
    const navbar = document.getElementById('navbar');
    if (rol === 'lector_presencia') {
        // El lector de presencia no navega por el resto de la app:
        // se oculta toda la barra inferior, solo ve la pantalla de fichaje.
        if (navbar) navbar.style.display = 'none';
        return;
    }
    if (navbar) navbar.style.display = '';
    document.getElementById('nav-ped').style.display = CAN.verPedidos(rol) ? '' : 'none';
    document.getElementById('nav-admin').style.display = CAN.gestionAdmin(rol) ? '' : 'none';
    const opPedir = document.getElementById('op-pedir');
    if (opPedir) opPedir.style.display = CAN.crearPedidos(rol) ? '' : 'none';
    const nbF = document.getElementById('nav-fichaje'); if (nbF) nbF.style.display = CAN.verFichajes(rol) ? '' : 'none';
}

function showUserMenu() {
    if (!currentUser) return;
    const r = ROLES[currentUser.rol];
    document.getElementById('um-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
    document.getElementById('um-avatar').style.background = r.color + '33';
    document.getElementById('um-avatar').style.color = r.color;
    document.getElementById('um-name').textContent = currentUser.nombre;
    document.getElementById('um-role').innerHTML = `<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
    document.getElementById('userMenuModal').classList.add('open');
}

function showChangePinModal() {
    closeModal('userMenuModal');
    showConfirmModal('Cambiar PIN',
        `<div class="form-group"><label>PIN actual</label><input type="password" id="pin-old" maxlength="4" inputmode="numeric" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);width:100%;"></div>
     <div class="form-group"><label>Nuevo PIN</label><input type="password" id="pin-new" maxlength="4" inputmode="numeric" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);width:100%;"></div>`,
        async () => {
            const old = document.getElementById('pin-old').value;
            const nw = document.getElementById('pin-new').value;
            if (old !== currentUser.pin) { toast('PIN actual incorrecto', 'error'); return; }
            if (!/^\d{4}$/.test(nw)) { toast('El PIN debe ser 4 dígitos', 'error'); return; }
            currentUser.pin = nw; currentUser.synced = 0;
            await dbPut('usuarios', currentUser);
            toast('✓ PIN actualizado', 'success');
            scheduleSyncSoon();
        }, 'Guardar');
}

// ══════════════════════════════════════════════
// SUPABASE SYNC
// ══════════════════════════════════════════════
let SB = null, rtChannel = null, syncBusy = false;

const SETUP_SQL = `-- StockVoz — SQL para Supabase (pega y ejecuta en SQL Editor)

create table if not exists ubicaciones(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,tipo text default 'almacen',direccion text,descripcion text,creado timestamptz default now(),creado_por text,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
create table if not exists materiales(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,cantidad numeric default 0,unidad text default 'ud',precio numeric default 0,minimo numeric default 0,proveedor text,descripcion text,ubicacion_id uuid references ubicaciones(id),creado timestamptz default now(),creado_por text,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
create table if not exists movimientos(id uuid primary key default gen_random_uuid(),local_id integer,tipo text not null,cantidad numeric not null,material_id uuid references materiales(id),ubicacion_id uuid references ubicaciones(id),fecha timestamptz default now(),usuario text,nota text,created_at timestamptz default now());
create table if not exists usuarios(id uuid primary key default gen_random_uuid(),local_id integer,nombre text not null,rol text default 'operario',pin text,creado timestamptz default now(),creado_por text,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
create table if not exists pedidos(id uuid primary key default gen_random_uuid(),local_id integer,proveedor text,estado text default 'pendiente',notas text,lineas jsonb,total numeric default 0,creado_por text,modificado_por text,modificado_en timestamptz,fecha timestamptz default now(),updated_at timestamptz default now());
create table if not exists fichajes(id uuid primary key default gen_random_uuid(),local_id integer,user_id integer,nombre_usuario text,rol_usuario text,tipo text not null,fecha timestamptz not null,fecha_local text,creado_por text,dispositivo text,nota text,created_at timestamptz default now());
create table if not exists config(key text primary key,value jsonb,modificado_por text,modificado_en timestamptz,updated_at timestamptz default now());
-- Si las tablas ya existían de una versión anterior, añade las columnas nuevas:
alter table ubicaciones add column if not exists direccion text;
alter table ubicaciones add column if not exists descripcion text;
alter table ubicaciones add column if not exists creado_por text;
alter table ubicaciones add column if not exists modificado_por text;
alter table ubicaciones add column if not exists modificado_en timestamptz;
alter table materiales add column if not exists descripcion text;
alter table materiales add column if not exists creado_por text;
alter table materiales add column if not exists modificado_por text;
alter table materiales add column if not exists modificado_en timestamptz;
alter table usuarios add column if not exists creado_por text;
alter table usuarios add column if not exists modificado_por text;
alter table usuarios add column if not exists modificado_en timestamptz;
alter table pedidos add column if not exists modificado_por text;
alter table pedidos add column if not exists modificado_en timestamptz;

create index if not exists idx_fichajes_user on fichajes(user_id);
create index if not exists idx_fichajes_fecha on fichajes(fecha);

create or replace function update_updated_at() returns trigger as $$ begin new.updated_at=now();return new;end;$$ language plpgsql;
do $$ begin if not exists(select 1 from pg_trigger where tgname='trg_ubic_upd') then create trigger trg_ubic_upd before update on ubicaciones for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_mat_upd') then create trigger trg_mat_upd before update on materiales for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_usr_upd') then create trigger trg_usr_upd before update on usuarios for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_ped_upd') then create trigger trg_ped_upd before update on pedidos for each row execute function update_updated_at();end if;if not exists(select 1 from pg_trigger where tgname='trg_cfg_upd') then create trigger trg_cfg_upd before update on config for each row execute function update_updated_at();end if;end$$;

alter table ubicaciones enable row level security;alter table materiales enable row level security;alter table movimientos enable row level security;alter table usuarios enable row level security;alter table pedidos enable row level security;alter table fichajes enable row level security;alter table config enable row level security;
do $$ begin if not exists(select 1 from pg_policies where tablename='ubicaciones' and policyname='public_all') then create policy public_all on ubicaciones for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='materiales' and policyname='public_all') then create policy public_all on materiales for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='movimientos' and policyname='public_all') then create policy public_all on movimientos for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='usuarios' and policyname='public_all') then create policy public_all on usuarios for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='pedidos' and policyname='public_all') then create policy public_all on pedidos for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='fichajes' and policyname='public_all') then create policy public_all on fichajes for all using(true) with check(true);end if;if not exists(select 1 from pg_policies where tablename='config' and policyname='public_all') then create policy public_all on config for all using(true) with check(true);end if;end$$;

alter publication supabase_realtime add table movimientos;
alter publication supabase_realtime add table materiales;
alter publication supabase_realtime add table pedidos;
alter publication supabase_realtime add table fichajes;
alter publication supabase_realtime add table config;`.trim();

function getSBConfig() { return { url: localStorage.getItem('sb_url') || '', key: localStorage.getItem('sb_key') || '' }; }
function initSupabase() { const { url, key } = getSBConfig(); if (!url || !key) return false; try { SB = window.supabase.createClient(url, key); return true; } catch (e) { return false; } }

async function syncNow() {
    if (!navigator.onLine) { toast('Sin conexión', 'error'); return; }
    if (!SB && !initSupabase()) { toast('⚙️ Configura Supabase en Admin → ☁️', 'error'); return; }
    if (syncBusy) return; syncBusy = true;
    try {
        const [ubics, mats, movs, users, peds] = await Promise.all([dbGetAll('ubicaciones'), dbGetAll('materiales'), dbGetAll('movimientos'), dbGetAll('usuarios'), dbGetAll('pedidos')]);
        // push ubicaciones
        for (const u of ubics.filter(x => !x.synced)) {
            const { data, error } = await SB.from('ubicaciones').upsert({ nombre: u.nombre, tipo: u.tipo, direccion: u.direccion || '', descripcion: u.descripcion || '', local_id: u.id, creado: u.creado, creado_por: u.creadoPor || '', modificado_por: u.modificadoPor || '', modificado_en: u.modificadoEn || null }, { onConflict: 'local_id' }).select().single();
            if (!error && data) { u.synced = 1; u.remote_id = data.id; await dbPut('ubicaciones', u); }
        }
        const ubicsSynced = await dbGetAll('ubicaciones');
        // push materiales
        for (const m of mats.filter(x => !x.synced)) {
            const ub = ubicsSynced.find(u => u.id === m.ubicacionId);
            const { data, error } = await SB.from('materiales').upsert({ nombre: m.nombre, cantidad: m.cantidad, unidad: m.unidad || 'ud', precio: m.precio || 0, minimo: m.minimo || 0, proveedor: m.proveedor || '', descripcion: m.descripcion || '', local_id: m.id, ubicacion_id: ub?.remote_id || null, creado: m.creado, creado_por: m.creadoPor || '', modificado_por: m.modificadoPor || '', modificado_en: m.modificadoEn || null }, { onConflict: 'local_id' }).select().single();
            if (!error && data) { m.synced = 1; m.remote_id = data.id; await dbPut('materiales', m); }
        }
        const matsSynced = await dbGetAll('materiales');
        // push movimientos
        let pushed = 0;
        for (const mv of movs.filter(x => !x.synced)) {
            const mt = matsSynced.find(m => m.id === mv.materialId); const ub = ubicsSynced.find(u => u.id === mv.ubicacionId);
            const { error } = await SB.from('movimientos').upsert({ tipo: mv.tipo, cantidad: mv.cantidad, nota: mv.nota || '', fecha: mv.fecha, usuario: mv.usuario || '', local_id: mv.id, material_id: mt?.remote_id || null, ubicacion_id: ub?.remote_id || null }, { onConflict: 'local_id' });
            if (!error) { mv.synced = 1; await dbPut('movimientos', mv); pushed++; }
        }
        // push usuarios
        for (const u of users.filter(x => !x.synced)) {
            const { data, error } = await SB.from('usuarios').upsert({ nombre: u.nombre, rol: u.rol, pin: u.pin, local_id: u.id, creado: u.creado, creado_por: u.creadoPor || '', modificado_por: u.modificadoPor || '', modificado_en: u.modificadoEn || null }, { onConflict: 'local_id' }).select().single();
            if (!error && data) { u.synced = 1; u.remote_id = data.id; await dbPut('usuarios', u); }
        }
        // push pedidos
        for (const p of peds.filter(x => !x.synced)) {
            const { error } = await SB.from('pedidos').upsert({ proveedor: p.proveedor || '', estado: p.estado, notas: p.notas || '', lineas: p.lineas || [], total: p.total || 0, creado_por: p.creadoPor || '', modificado_por: p.modificadoPor || '', modificado_en: p.modificadoEn || null, fecha: p.fecha, local_id: p.id }, { onConflict: 'local_id' });
            if (!error) { p.synced = 1; await dbPut('pedidos', p); }
        }
        if (pushed > 0) toast(`☁️ ${pushed} movimientos subidos`, 'success');
        const fichs = await dbGetAll('fichajes');
        for (const f of fichs.filter(x => !x.sinc)) { const { error } = await SB.from('fichajes').upsert({ local_id: f.id, user_id: f.userId, nombre_usuario: f.nombreUsuario, rol_usuario: f.rolUsuario, tipo: f.tipo, fecha: f.fecha, fecha_local: f.fechaLocal, creado_por: f.creadoPor, dispositivo: f.dispositivo, nota: f.nota || '' }, { onConflict: 'local_id' }); if (!error) { f.sinc = 1; await dbPut('fichajes', f); } }
        // push config (ajustes globales, ej. permitir fichaje manual)
        const cfgs = await dbGetAll('config');
        for (const c of cfgs.filter(x => !x.synced)) {
            const { error } = await SB.from('config').upsert({ key: c.key, value: c.value, modificado_por: c.modificadoPor || '', modificado_en: c.modificadoEn || null }, { onConflict: 'key' });
            if (!error) { c.synced = 1; await dbPut('config', c); }
        }
        await pullRemoteData();
    } catch (e) { toast('Error sync: ' + (e.message || e), 'error'); }
    finally { syncBusy = false; updateSyncBadge(); updateStats(); }
}

async function pullRemoteData() {
    if (!SB) return;
    const lastPull = localStorage.getItem('last_pull') || '1970-01-01T00:00:00Z';
    try {
        const { data: rU } = await SB.from('ubicaciones').select('*').gt('updated_at', lastPull);
        if (rU?.length) { const l = await dbGetAll('ubicaciones'); for (const ru of rU) { const ex = l.find(u => u.remote_id === ru.id || u.id === ru.local_id); if (ex) { Object.assign(ex, { nombre: ru.nombre, tipo: ru.tipo, direccion: ru.direccion, descripcion: ru.descripcion, creadoPor: ru.creado_por, modificadoPor: ru.modificado_por, modificadoEn: ru.modificado_en, remote_id: ru.id, synced: 1 }); await dbPut('ubicaciones', ex); } else { await dbAdd('ubicaciones', { nombre: ru.nombre, tipo: ru.tipo, direccion: ru.direccion, descripcion: ru.descripcion, remote_id: ru.id, local_id: ru.local_id, creadoPor: ru.creado_por, modificadoPor: ru.modificado_por, modificadoEn: ru.modificado_en, synced: 1, creado: ru.creado }); } } }
        const { data: rM } = await SB.from('materiales').select('*').gt('updated_at', lastPull);
        if (rM?.length) { const lm = await dbGetAll('materiales'); const lu = await dbGetAll('ubicaciones'); for (const rm of rM) { const ex = lm.find(m => m.remote_id === rm.id || m.id === rm.local_id); if (ex) { const ub = lu.find(u => u.remote_id === rm.ubicacion_id); Object.assign(ex, { nombre: rm.nombre, cantidad: rm.cantidad, unidad: rm.unidad, precio: rm.precio || 0, minimo: rm.minimo, proveedor: rm.proveedor || '', descripcion: rm.descripcion || '', ubicacionId: ub?.id || ex.ubicacionId, creadoPor: rm.creado_por, modificadoPor: rm.modificado_por, modificadoEn: rm.modificado_en, remote_id: rm.id, synced: 1 }); await dbPut('materiales', ex); } else { const ub = lu.find(u => u.remote_id === rm.ubicacion_id); await dbAdd('materiales', { nombre: rm.nombre, cantidad: rm.cantidad, unidad: rm.unidad, precio: rm.precio || 0, minimo: rm.minimo, proveedor: rm.proveedor || '', descripcion: rm.descripcion || '', remote_id: rm.id, local_id: rm.local_id, ubicacionId: ub?.id || null, creadoPor: rm.creado_por, modificadoPor: rm.modificado_por, modificadoEn: rm.modificado_en, synced: 1, creado: rm.creado }); } } }
        const { data: rMv } = await SB.from('movimientos').select('*').gt('created_at', lastPull);
        if (rMv?.length) { const lmv = await dbGetAll('movimientos'); const lmt = await dbGetAll('materiales'); const lub = await dbGetAll('ubicaciones'); for (const rm of rMv) { if (!lmv.find(m => m.local_id === rm.local_id && rm.local_id)) { const mt = lmt.find(m => m.remote_id === rm.material_id); const ub = lub.find(u => u.remote_id === rm.ubicacion_id); await dbAdd('movimientos', { tipo: rm.tipo, cantidad: rm.cantidad, nota: rm.nota, fecha: rm.fecha, usuario: rm.usuario, local_id: rm.local_id, materialId: mt?.id || null, ubicacionId: ub?.id || null, synced: 1 }); } } }
        const { data: rUs } = await SB.from('usuarios').select('*').gt('updated_at', lastPull);
        if (rUs?.length) { const lu = await dbGetAll('usuarios'); for (const ru of rUs) { const ex = lu.find(u => u.remote_id === ru.id || u.id === ru.local_id); if (ex) { ex.nombre = ru.nombre; ex.rol = ru.rol; ex.pin = ru.pin; ex.creadoPor = ru.creado_por; ex.modificadoPor = ru.modificado_por; ex.modificadoEn = ru.modificado_en; ex.remote_id = ru.id; ex.synced = 1; await dbPut('usuarios', ex); } else { await dbAdd('usuarios', { nombre: ru.nombre, rol: ru.rol, pin: ru.pin, remote_id: ru.id, local_id: ru.local_id, creadoPor: ru.creado_por, modificadoPor: ru.modificado_por, modificadoEn: ru.modificado_en, synced: 1, creado: ru.creado }); } } }
        const { data: rP } = await SB.from('pedidos').select('*').gt('updated_at', lastPull);
        if (rP?.length) { const lp = await dbGetAll('pedidos'); for (const rped of rP) { const ex = lp.find(p => p.local_id === rped.local_id && rped.local_id); if (ex) { Object.assign(ex, { proveedor: rped.proveedor, estado: rped.estado, notas: rped.notas, lineas: rped.lineas, total: rped.total, creadoPor: rped.creado_por, modificadoPor: rped.modificado_por, modificadoEn: rped.modificado_en, synced: 1 }); await dbPut('pedidos', ex); } else if (!ex) { await dbAdd('pedidos', { proveedor: rped.proveedor, estado: rped.estado, notas: rped.notas, lineas: rped.lineas, total: rped.total, creadoPor: rped.creado_por, modificadoPor: rped.modificado_por, modificadoEn: rped.modificado_en, fecha: rped.fecha, local_id: rped.local_id, synced: 1 }); } } }
        // Descargar fichajes remotos (imprescindible para que otros dispositivos vean la presencia)
        const { data: rFichs } = await SB.from('fichajes').select('*').gt('created_at', lastPull);
        if (rFichs?.length) {
            const lf = await dbGetAll('fichajes');
            for (const r of rFichs) {
                if (!lf.find(f => f.local_id === r.local_id && r.local_id)) {
                    await dbAdd('fichajes', { userId: r.user_id, nombreUsuario: r.nombre_usuario, rolUsuario: r.rol_usuario, tipo: r.tipo, fecha: r.fecha, fechaLocal: r.fecha_local, creadoPor: r.creado_por, dispositivo: r.dispositivo, nota: r.nota || '', local_id: r.local_id, sinc: 1 });
                }
            }
        }
        // Descargar configuración global (ej. permitir fichaje manual)
        const { data: rCfg } = await SB.from('config').select('*').gt('updated_at', lastPull);
        if (rCfg?.length) {
            for (const r of rCfg) {
                await dbPut('config', { key: r.key, value: r.value, modificadoPor: r.modificado_por, modificadoEn: r.modificado_en, synced: 1 });
            }
        }
        localStorage.setItem('last_pull', new Date().toISOString());
        renderAll();
        if (typeof applyFichajeConfigUI === 'function') applyFichajeConfigUI();
    } catch (e) { console.error('pull', e); }
}

function startRealtime() {
    if (!SB || rtChannel) return;
    rtChannel = SB.channel('sv-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, () => { toast('🔄 Actualización recibida', ''); pullRemoteData(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'materiales' }, () => pullRemoteData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => { pullRemoteData(); renderPedidos(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, () => pullRemoteData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, async () => { await pullRemoteData(); if (typeof applyFichajeConfigUI === 'function') await applyFichajeConfigUI(); })
        .subscribe(st => { const el = document.getElementById('rt-status'); if (!el) return; el.textContent = st === 'SUBSCRIBED' ? '🟢 Tiempo real activo' : '🔴 ' + st; el.style.color = st === 'SUBSCRIBED' ? 'var(--success)' : 'var(--danger)'; });
}
function stopRealtime() { if (rtChannel && SB) { SB.removeChannel(rtChannel); rtChannel = null; } }

function saveSupabaseConfig() {
    const url = document.getElementById('sb-url').value.trim();
    const key = document.getElementById('sb-key').value.trim();
    if (!url || !key) { toast('Rellena URL y API Key', 'error'); return; }
    localStorage.setItem('sb_url', url); localStorage.setItem('sb_key', key);
    SB = null; stopRealtime();
    if (initSupabase()) { toast('✓ Supabase conectado', 'success'); startRealtime(); syncNow(); renderSyncScreen(); }
    else toast('Error al conectar', 'error');
}
function clearSupabaseConfig() {
    showConfirmModal('Desconectar Supabase', '<p style="font-size:13px;color:var(--text2);">Los datos locales se conservan. Solo se elimina la conexión remota.</p>', () => {
        localStorage.removeItem('sb_url'); localStorage.removeItem('sb_key'); localStorage.removeItem('last_pull');
        stopRealtime(); SB = null; toast('Desconectado', 'success'); renderSyncScreen();
    });
}
function renderSyncScreen() {
    const { url, key } = getSBConfig(); const c = !!(url && key);
    const ue = document.getElementById('sb-url'), ke = document.getElementById('sb-key');
    if (ue) ue.value = c ? '' : url; if (ke) ke.value = '';
    const ce = document.getElementById('sb-connected'), fe = document.getElementById('sb-form');
    if (ce) ce.style.display = c ? 'block' : 'none'; if (fe) fe.style.display = c ? 'none' : 'block';
    const su = document.getElementById('sb-url-show'); if (su && c) su.textContent = url;
}
function copySetupSQL() {
    navigator.clipboard.writeText(SETUP_SQL).then(() => toast('✓ SQL copiado', 'success')).catch(() => { const ta = document.createElement('textarea'); ta.value = SETUP_SQL; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('✓ SQL copiado', 'success'); });
}
let syncTimer;
function scheduleSyncSoon() { if (!SB) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1800); }

// ══════════════════════════════════════════════
// VOZ
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// VOZ — ASISTENTE GUIADO PASO A PASO
// Reconocimiento con Whisper (modelo "base") ejecutado
// 100% en local en el navegador vía transformers.js + WASM.
// No depende de servicios externos de voz ni requiere red
// una vez descargado el modelo la primera vez (queda cacheado).
// ══════════════════════════════════════════════
let isRecording = false;

// Estado del asistente
const WIZ = {
    tipo: null,       // entrada|salida|mover|buscar|pedir
    steps: [],        // lista de pasos para esta operación
    stepIdx: 0,       // índice del paso actual
    data: {},         // datos acumulados: { cantidad, material, ubicacion, ubicacionDestino, nota }
    mats: [],         // cache materiales
    ubics: []         // cache ubicaciones
};

// Definición de pasos por operación
const FLOW = {
    entrada: [
        { key: 'cantidad', label: 'Cantidad', hint: 'Número de unidades que entran', type: 'number', skippable: false },
        { key: 'material', label: 'Material', hint: 'Nombre del material (di el nombre claro)', type: 'material', skippable: false },
        { key: 'ubicacion', label: 'Ubicación / Almacén', hint: '¿Dónde se guarda? (almacén, furgoneta…)', type: 'ubicacion', skippable: true },
        { key: 'nota', label: 'Nota o descripción', hint: 'Opcional — referencia, motivo, etc.', type: 'text', skippable: true }
    ],
    salida: [
        { key: 'cantidad', label: 'Cantidad', hint: 'Número de unidades que salen', type: 'number', skippable: false },
        { key: 'material', label: 'Material', hint: 'Nombre del material', type: 'material', skippable: false },
        { key: 'ubicacion', label: 'Ubicación / Almacén', hint: '¿De dónde sale?', type: 'ubicacion', skippable: true },
        { key: 'nota', label: 'Nota o descripción', hint: 'Opcional — motivo, destino, etc.', type: 'text', skippable: true }
    ],
    mover: [
        { key: 'cantidad', label: 'Cantidad', hint: 'Número de unidades a mover', type: 'number', skippable: false },
        { key: 'material', label: 'Material', hint: 'Nombre del material', type: 'material', skippable: false },
        { key: 'ubicacion', label: 'Ubicación origen', hint: '¿Desde dónde se mueve?', type: 'ubicacion', skippable: false },
        { key: 'ubicacionDestino', label: 'Ubicación destino', hint: '¿A dónde va?', type: 'ubicacion', skippable: false },
        { key: 'nota', label: 'Nota', hint: 'Opcional', type: 'text', skippable: true }
    ],
    pedir: [
        { key: 'cantidad', label: 'Cantidad a pedir', hint: '¿Cuántas unidades necesitas?', type: 'number', skippable: false },
        { key: 'material', label: 'Material', hint: 'Nombre del material a pedir', type: 'material', skippable: false },
        { key: 'nota', label: 'Nota o referencia', hint: 'Opcional — proveedor, referencia, urgencia', type: 'text', skippable: true }
    ],
    buscar: [
        { key: 'material', label: '¿Qué buscas?', hint: 'Nombre del material o parte del nombre', type: 'material', skippable: false }
    ]
};

const TIPO_META = {
    entrada: { label: '↑ ENTRADA', color: 'var(--success)', bg: 'rgba(46,204,113,.15)' },
    salida: { label: '↓ SALIDA', color: 'var(--danger)', bg: 'rgba(231,76,60,.15)' },
    mover: { label: '⇄ MOVER', color: 'var(--accent)', bg: 'rgba(79,142,247,.15)' },
    buscar: { label: '🔍 BUSCAR', color: 'var(--text2)', bg: 'rgba(255,255,255,.05)' },
    pedir: { label: '🛒 PEDIDO', color: 'var(--warn)', bg: 'rgba(243,156,18,.15)' }
};

function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }

// ══════════════════════════════════════════════
// CORRECCIÓN DE VOZ — normalización fonética y numérica
// Whisper confunde con frecuencia b/v, s/z/c, y a veces
// transcribe números como palabras en vez de dígitos.
// Estas funciones corrigen ambos problemas antes de
// interpretar el texto reconocido.
// ══════════════════════════════════════════════

// Clave fonética: reduce un texto a su "sonido" aproximado en español,
// para que "tuvo" y "tubo" (o "codo"/"codo") generen la misma clave
// aunque Whisper haya transcrito una letra por otra.
function phoneticKey(s) {
    let t = norm(s);
    t = t
        .replace(/[bv]/g, 'b')        // b/v suenan igual en español
        .replace(/z/g, 's')           // z suena como s (seseo)
        .replace(/c(?=[ei])/g, 's')   // "ce/ci" suena como s
        .replace(/qu/g, 'k')
        .replace(/c(?=[aou])/g, 'k')  // "ca/co/cu" suena como k
        .replace(/h/g, '')            // h muda
        .replace(/ll/g, 'y')
        .replace(/rr/g, 'r')
        .replace(/[^a-z0-9]/g, '');   // fuera espacios y puntuación para comparar el núcleo
    return t;
}

// Distancia de Levenshtein (nº mínimo de ediciones entre dos cadenas)
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = [];
    for (let i = 0; i <= m; i++) { dp.push(new Array(n + 1).fill(0)); dp[i][0] = i; }
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[m][n];
}

// ¿Coinciden dos textos aunque Whisper haya transcrito alguna letra mal?
// Compara por clave fonética y tolera pequeñas diferencias (distancia de edición).
function fuzzyMatch(a, b) {
    const ka = phoneticKey(a), kb = phoneticKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    if (ka.length >= 3 && kb.length >= 3 && (ka.includes(kb) || kb.includes(ka))) return true;
    const dist = levenshtein(ka, kb);
    const maxLen = Math.max(ka.length, kb.length);
    return dist <= Math.max(1, Math.floor(maxLen * 0.28));
}

// Puntuación de similitud (0 a 1) para ordenar varios candidatos por parecido
function fuzzyScore(a, b) {
    const ka = phoneticKey(a), kb = phoneticKey(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    const dist = levenshtein(ka, kb);
    const maxLen = Math.max(ka.length, kb.length);
    return 1 - dist / maxLen;
}

// ── Números en palabras (español) → dígitos ──
const NUM_UNITS = {
    cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
};
const NUM_TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const NUM_HUNDREDS = { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };

// Convierte una secuencia de palabras numéricas en español a su valor entero.
// Soporta compuestos: "cuarenta y cinco" → 45, "ciento diez" → 110, "dos mil" → 2000.
// IMPORTANTE: exige que TODAS las palabras del segmento sean numéricas — si aparece
// una palabra ajena (ej. "tubo" en "tubo noventa"), se rechaza el segmento entero
// para no "comerse" el nombre del material al convertir el número.
function parseSpanishNumberWords(text) {
    const words = norm(text).split(/\s+/).filter(w => w && w !== 'y');
    if (!words.length) return null;
    let total = 0, current = 0;
    for (const w of words) {
        if (w === 'mil') { current = (current || 1) * 1000; total += current; current = 0; continue; }
        if (NUM_HUNDREDS[w] !== undefined) { current += NUM_HUNDREDS[w]; continue; }
        if (NUM_TENS[w] !== undefined) { current += NUM_TENS[w]; continue; }
        if (NUM_UNITS[w] !== undefined) { current += NUM_UNITS[w]; continue; }
        return null; // palabra no numérica en el segmento → todo el segmento no es válido
    }
    total += current;
    return total > 0 ? total : null;
}

// Busca, dentro de un texto, el primer tramo de palabras que forme un número
// hablado y lo sustituye por su valor en dígitos. Si el texto ya trae dígitos,
// se deja tal cual. Ej: "tubo noventa" → "tubo 90", "codo cuarenta y cinco" → "codo 45".
function normalizeNumbersInText(text) {
    if (/\d/.test(text)) return text;
    const words = text.trim().split(/\s+/);
    for (let start = 0; start < words.length; start++) {
        // probar de más largo a más corto para capturar compuestos como "cuarenta y cinco"
        for (let end = words.length; end > start; end--) {
            const segment = words.slice(start, end).join(' ');
            const val = parseSpanishNumberWords(segment);
            if (val !== null && val > 0) {
                return [...words.slice(0, start), String(val), ...words.slice(end)].join(' ');
            }
        }
    }
    return text;
}

// ══════════════════════════════════════════════
// WHISPER LOCAL — carga perezosa del modelo
// ══════════════════════════════════════════════
let whisperPipeline = null;
let whisperLoading = false;
let whisperReady = false;
let transformersLib = null;
let qwenTextPipeline = null;
let qwenTextLoading = false;
let qwenTextReady = false;

// MediaRecorder / detección de silencio
let mediaStream = null, mediaRecorder = null, audioChunks = [];
let vadContext = null, vadAnalyser = null, vadRaf = null;
let recordStartTime = null, silenceStart = null, spokeAtLeastOnce = false;
let pendingBtnId = null, pendingLabelId = null;

const SILENCE_THRESHOLD = 0.015;  // umbral RMS para considerar silencio
const SILENCE_DURATION = 1100;   // ms de silencio para detener automáticamente
const MAX_RECORD_MS = 12000;  // tope de seguridad por grabación

// ── Inicializar: comprobar soporte de micrófono y precargar el modelo en segundo plano ──
function initVoice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const hint = document.querySelector('#wiz-idle p');
        if (hint) hint.textContent = '⚠️ Este navegador no permite acceso al micrófono.';
        return;
    }
    // Precarga silenciosa del stack de voz en segundo plano.
    // Primero intenta cargar Transformers de forma robusta y luego prepara el
    // modelo Qwen para normalizar el texto reconocido, con Whisper como fallback.
    ensureWhisperLoaded().catch(() => { });
}

async function loadTransformersLibrary() {
    if (transformersLib) return transformersLib;
    try {
        transformersLib = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    } catch (e1) {
        try {
            transformersLib = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
        } catch (e2) {
            throw e2;
        }
    }
    return transformersLib;
}

async function ensureWhisperLoaded(onProgress) {
    if (whisperPipeline) return whisperPipeline;
    if (whisperLoading) {
        while (whisperLoading) await new Promise(r => setTimeout(r, 200));
        return whisperPipeline;
    }
    whisperLoading = true;
    try {
        const mod = await loadTransformersLibrary();
        const { pipeline, env } = mod;
        if (env) {
            env.allowRemoteModels = true;
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
            }
        }
        whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
            progress_callback: p => { if (onProgress) onProgress(p); }
        });
        whisperReady = true;
    } catch (e) {
        console.error('Error cargando Whisper local:', e);
        toast('No se pudo cargar el reconocimiento de voz local', 'error');
    } finally {
        whisperLoading = false;
    }
    return whisperPipeline;
}

async function ensureQwenVoiceModel(onProgress) {
    if (qwenTextPipeline) return qwenTextPipeline;
    if (qwenTextLoading) {
        while (qwenTextLoading) await new Promise(r => setTimeout(r, 200));
        return qwenTextPipeline;
    }
    qwenTextLoading = true;
    try {
        const mod = await loadTransformersLibrary();
        const { pipeline, env } = mod;
        if (env) {
            env.allowRemoteModels = true;
            env.allowLocalModels = false;
            env.useBrowserCache = true;
        }
        const candidates = ['Qwen/Qwen2.5-Coder-3B-Instruct', 'Xenova/Qwen2.5-Coder-3B-Instruct'];
        let lastError = null;
        for (const modelId of candidates) {
            try {
                qwenTextPipeline = await pipeline('text-generation', modelId, {
                    progress_callback: p => { if (onProgress) onProgress(p); }
                });
                qwenTextReady = true;
                return qwenTextPipeline;
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('No se pudo cargar el modelo Qwen');
    } catch (e) {
        console.warn('No se pudo cargar Qwen para normalizar voz:', e);
        return null;
    } finally {
        qwenTextLoading = false;
    }
}

async function normalizeVoiceTextWithQwen(rawText) {
    if (!rawText) return rawText;
    try {
        const model = await ensureQwenVoiceModel();
        if (!model) return rawText;
        const prompt = `Corrige y normaliza este texto de voz al español. Responde solo con el texto corregido, sin explicaciones.\nTexto: ${rawText}\nTexto corregido:`;
        const result = await model(prompt, { max_new_tokens: 80, temperature: 0.2, do_sample: false });
        const generated = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
        const normalized = typeof generated === 'string'
            ? generated.replace(/^.*Texto corregido:\s*/is, '').trim()
            : '';
        return normalized || rawText;
    } catch (e) {
        console.warn('Error aplicando Qwen a la voz:', e);
        return rawText;
    }
}

// ── Iniciar grabación de audio con detección automática de silencio ──
function startListening(btnId, labelId) {
    if (isRecording) return;
    pendingBtnId = btnId; pendingLabelId = labelId;

    navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
    }).then(stream => {
        mediaStream = stream;
        audioChunks = [];
        const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
            ? 'audio/webm;codecs=opus' : '';
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => finishRecording();
        mediaRecorder.start();

        isRecording = true;
        recordStartTime = Date.now();
        spokeAtLeastOnce = false;
        silenceStart = null;

        document.querySelectorAll('.mic-btn,.mic-btn-sm').forEach(b => b.classList.add('recording'));
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.add('recording');
        if (labelId) { const lbl = document.getElementById(labelId); if (lbl) lbl.textContent = 'Escuchando...'; }

        // Avisar si el modelo aún no está listo (primera vez, descargando)
        if (!whisperReady) {
            updateWizVoiceText('🎙️ Escuchando… (preparando reconocimiento local)', true);
        }

        startSilenceDetection(stream);
    }).catch(() => {
        toast('Micrófono no permitido — actívalo en el navegador', 'error');
    });
}

// ── Detección de silencio: detiene la grabación automáticamente ──
function startSilenceDetection(stream) {
    vadContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = vadContext.createMediaStreamSource(stream);
    vadAnalyser = vadContext.createAnalyser();
    vadAnalyser.fftSize = 512;
    source.connect(vadAnalyser);
    const data = new Uint8Array(vadAnalyser.fftSize);

    const tick = () => {
        if (!isRecording) return;
        vadAnalyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sumSq += v * v; }
        const rms = Math.sqrt(sumSq / data.length);
        const elapsed = Date.now() - recordStartTime;

        if (rms > SILENCE_THRESHOLD) {
            spokeAtLeastOnce = true;
            silenceStart = null;
        } else if (spokeAtLeastOnce) {
            if (silenceStart === null) silenceStart = Date.now();
            else if (Date.now() - silenceStart > SILENCE_DURATION) { stopListening(); return; }
        }

        if (elapsed > MAX_RECORD_MS) { stopListening(); return; }
        vadRaf = requestAnimationFrame(tick);
    };
    vadRaf = requestAnimationFrame(tick);
}

function stopSilenceDetection() {
    if (vadRaf) cancelAnimationFrame(vadRaf);
    vadRaf = null;
    if (vadContext) { try { vadContext.close(); } catch (e) { } vadContext = null; }
    vadAnalyser = null;
}

// ── Detener grabación manualmente (o disparado por silencio) ──
function stopListening() {
    if (!isRecording) return;
    isRecording = false;
    stopSilenceDetection();
    document.querySelectorAll('.mic-btn,.mic-btn-sm').forEach(b => b.classList.remove('recording'));
    try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (e) { }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}

// ── Al terminar de grabar: transcribir con Whisper local ──
async function finishRecording() {
    const lbl = document.getElementById('micBtnStepLabel');
    if (lbl) lbl.textContent = 'Hablar';

    if (!audioChunks.length) return;
    const blob = new Blob(audioChunks, { type: audioChunks[0].type || 'audio/webm' });
    audioChunks = [];

    updateWizVoiceText('🧠 Transcribiendo…', true);

    try {
        const float32 = await blobToWhisperInput(blob);
        const pipe = await ensureWhisperLoaded(p => {
            if (p && p.status === 'progress') {
                const pct = Math.round(p.progress || 0);
                updateWizVoiceText(`⬇️ Descargando modelo de voz local… ${pct}%`, true);
            }
        });
        if (!pipe) { updateWizVoiceText('No se pudo cargar el reconocimiento de voz', 'false'); return; }

        const result = await pipe(float32, { language: 'spanish', task: 'transcribe', chunk_length_s: 15 });
        const rawText = (result?.text || '').trim();

        if (!rawText) {
            updateWizVoiceText('No se detectó voz clara — inténtalo de nuevo', false);
            return;
        }
        const normalizedDraft = normalizeNumbersInText(rawText);
        const finalText = await normalizeVoiceTextWithQwen(normalizedDraft);
        const text = normalizeNumbersInText(finalText || normalizedDraft);
        updateWizVoiceText(text, false);
        wizProcessSpeech(text);
    } catch (e) {
        console.error('Error de transcripción Whisper:', e);
        updateWizVoiceText('Error al transcribir — inténtalo de nuevo', false);
    }
}

// ── Decodifica el audio grabado y lo remuestrea a 16kHz mono Float32 (formato Whisper) ──
async function blobToWhisperInput(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const targetRate = 16000;
    let channelData = decoded.getChannelData(0);

    if (decoded.sampleRate !== targetRate) {
        const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
        const src = offlineCtx.createBufferSource();
        src.buffer = decoded;
        src.connect(offlineCtx.destination);
        src.start();
        const rendered = await offlineCtx.startRendering();
        channelData = rendered.getChannelData(0);
    }
    try { audioCtx.close(); } catch (e) { }
    return channelData;
}

function updateWizVoiceText(text, interim) {
    const el = document.getElementById('wiz-voice-text');
    if (!el) return;
    el.textContent = (interim ? '🎙️ ' : '') + text + (interim ? '…' : '');
    el.classList.toggle('wiz-voice-active', true);
    if (!interim) setTimeout(() => el.classList.remove('wiz-voice-active'), 1000);
}

// ── Escucha para selección de tipo en pantalla idle ──
function wizListenTipo() {
    if (isRecording) { stopListening(); return; }
    startListening('micBtnIdle', null);
}

// ── Escucha del paso actual ──
function wizListenStep() {
    if (isRecording) { stopListening(); return; }
    // Limpiar texto anterior del paso
    const el = document.getElementById('wiz-voice-text');
    if (el) { el.textContent = '🎙️ Escuchando...'; el.classList.add('wiz-voice-active'); }
    startListening('micBtnStep', 'micBtnStepLabel');
}

// ── Procesar lo que dijo el usuario ──
async function wizProcessSpeech(text) {
    stopListening();
    const t = norm(text);

    // Si aún no hay operación, detectar tipo
    if (!WIZ.tipo) {
        const ENTRADA_KW = ['entrada', 'entrar', 'recibir', 'añadir', 'meter', 'ingresa'];
        const SALIDA_KW = ['salida', 'salir', 'sacar', 'usar', 'consumir', 'quitar', 'retirar', 'gasta'];
        const MOVER_KW = ['mover', 'mueve', 'trasladar', 'transferir', 'pasar'];
        const BUSCAR_KW = ['buscar', 'busca', 'stock', 'cantidad', 'cuanto', 'quedan', 'hay'];
        const PEDIR_KW = ['pedir', 'pide', 'pedido', 'solicitar', 'comprar'];
        if (ENTRADA_KW.some(k => t.includes(k))) wizStart('entrada');
        else if (SALIDA_KW.some(k => t.includes(k))) wizStart('salida');
        else if (MOVER_KW.some(k => t.includes(k))) wizStart('mover');
        else if (BUSCAR_KW.some(k => t.includes(k))) wizStart('buscar');
        else if (PEDIR_KW.some(k => t.includes(k)) && hasPermiso('crearPedidos')) wizStart('pedir');
        else toast('No reconocí la operación. Pulsa uno de los botones.', 'error');
        return;
    }

    // Confirmar operación (en cualquier paso se puede decir OK)
    const OK_KW = ['ok', 'vale', 'confirmar', 'confirma', 'ejecutar', 'ejecuta', 'listo', 'ya', 'acepto', 'correcto', 'si', 'sí'];
    if (OK_KW.some(k => t === k || t.startsWith(k + ' ') || t.endsWith(' ' + k))) {
        if (wizAllRequiredFilled()) { wizExecute(); return; }
        else { toast('Faltan campos obligatorios', 'error'); return; }
    }
    // Cancelar
    if (t === 'cancelar' || t === 'cancel' || t === 'salir' || t === 'no') { wizCancel(); return; }
    // Saltar campo opcional
    if ((t === 'saltar' || t === 'omitir' || t === 'ninguno' || t === 'sin nota' || t === 'nada') && WIZ.steps[WIZ.stepIdx]?.skippable) { wizSkipStep(); return; }

    const step = WIZ.steps[WIZ.stepIdx];
    if (!step) return;

    if (step.type === 'number') {
        // Extraer número del texto: primero dígitos, si no hay, números en palabras
        // (soporta compuestos como "cuarenta y cinco" → 45)
        const m = t.match(/(\d+(?:[.,]\d+)?)/);
        let num = m ? parseFloat(m[1].replace(',', '.')) : null;
        if (!num) { num = parseSpanishNumberWords(t); }
        if (num && num > 0) {
            wizAcceptValue(num);
        } else {
            updateWizVoiceText('No entendí el número. Di solo el número, por ejemplo: "50"', false);
            speak('¿Cuántas unidades? Di solo el número.');
        }

    } else if (step.type === 'material') {
        await wizProcessMaterial(t);

    } else if (step.type === 'ubicacion') {
        await wizProcessUbicacion(t);

    } else if (step.type === 'text') {
        // Texto libre — aceptar tal cual
        wizAcceptValue(text.trim());
    }
}

// Busca materiales tolerando errores de transcripción de Whisper
// (b/v, s/z, números en palabras, etc.) mediante coincidencia fonética.
function buscarMaterialesFuzzy(t) {
    // 1) Coincidencia exacta o por substring normal (más fiable si aplica)
    let found = WIZ.mats.filter(m => norm(m.nombre) === t || norm(m.nombre).includes(t) || t.includes(norm(m.nombre)));
    if (found.length) return found;
    // 2) Coincidencia fonética/difusa (tolera "tuvo" por "tubo", etc.)
    const scored = WIZ.mats
        .map(m => ({ m, score: fuzzyScore(t, m.nombre) }))
        .filter(x => x.score >= 0.6 || fuzzyMatch(t, x.m.nombre))
        .sort((a, b) => b.score - a.score);
    return scored.map(x => x.m);
}

function buscarUbicacionesFuzzy(t) {
    let found = WIZ.ubics.filter(u => norm(u.nombre) === t || norm(u.nombre).includes(t) || t.includes(norm(u.nombre)));
    if (found.length) return found;
    const scored = WIZ.ubics
        .map(u => ({ u, score: fuzzyScore(t, u.nombre) }))
        .filter(x => x.score >= 0.6 || fuzzyMatch(t, x.u.nombre))
        .sort((a, b) => b.score - a.score);
    return scored.map(x => x.u);
}

async function wizProcessMaterial(t) {
    if (!WIZ.mats.length) WIZ.mats = await dbGetAll('materiales');
    const found = buscarMaterialesFuzzy(t);
    if (found.length === 1) {
        wizAcceptValue(found[0]);
        return;
    }
    if (found.length > 1) {
        showWizSuggestions(found.slice(0, 10).map(m => ({ label: m.nombre + (m.cantidad !== undefined ? ` (${m.cantidad} ${m.unidad || 'ud'})` : ''), value: m })), wizAcceptValue);
        updateWizVoiceText(`Encontré ${found.length} materiales parecidos a "${t}". Elige uno:`, false);
        speak('Encontré varios materiales parecidos. Elige uno tocando la pantalla.');
        return;
    }
    // No encontrado ni por parecido — mostrar todos y permitir elección
    showWizSuggestions(WIZ.mats.slice(0, 30).map(m => ({ label: m.nombre, value: m })), wizAcceptValue, t);
    updateWizVoiceText(`No encontré "${t}". Elige de la lista o escríbelo.`, false);
    speak('No lo encontré. Elige de la lista o escríbelo manualmente.');
}

async function wizProcessUbicacion(t) {
    if (!WIZ.ubics.length) WIZ.ubics = await dbGetAll('ubicaciones');
    const found = buscarUbicacionesFuzzy(t);
    if (found.length === 1) {
        wizAcceptValue(found[0]);
        return;
    }
    if (found.length > 1) {
        showWizSuggestions(found.slice(0, 10).map(u => ({ label: (u.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + u.nombre + (u.descripcion ? ' — ' + u.descripcion.substring(0, 30) : ''), value: u })), wizAcceptValue);
        updateWizVoiceText(`Encontré ${found.length} ubicaciones parecidas. Elige una:`, false);
        return;
    }
    showWizSuggestions(WIZ.ubics.map(u => ({ label: (u.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + u.nombre, value: u })), wizAcceptValue, t);
    updateWizVoiceText(`No encontré "${t}". Elige de la lista.`, false);
}

function showWizSuggestions(items, onSelect, highlight = '') {
    const el = document.getElementById('wiz-suggestions');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = items.map((item, i) => `<span class="sug-chip${highlight && norm(item.label).includes(norm(highlight)) ? ' match' : ''}" onclick="wizSugClick(${i})">${item.label}</span>`).join('');
    el._items = items;
    el._onSelect = onSelect;
}

function wizSugClick(i) {
    const el = document.getElementById('wiz-suggestions');
    if (!el || !el._items) return;
    el._onSelect(el._items[i].value);
}

// ── Iniciar operación ──
async function wizStart(tipo) {
    WIZ.tipo = tipo;
    WIZ.steps = FLOW[tipo] || [];
    WIZ.stepIdx = 0;
    WIZ.data = {};
    WIZ.mats = await dbGetAll('materiales');
    WIZ.ubics = await dbGetAll('ubicaciones');

    document.getElementById('wiz-idle').style.display = 'none';
    document.getElementById('wiz-active').style.display = 'block';
    document.getElementById('wiz-search-result').style.display = 'none';

    const meta = TIPO_META[tipo];
    const badge = document.getElementById('wiz-tipo-badge');
    badge.textContent = meta.label;
    badge.style.background = meta.bg;
    badge.style.color = meta.color;

    wizRenderStep();
    // Arrancar escucha automáticamente para el primer paso
    setTimeout(() => wizListenStep(), 400);
    speak(WIZ.steps[0]?.label ? 'Di ' + WIZ.steps[0].label : '');
}

// ── Renderizar paso actual ──
function wizRenderStep() {
    const step = WIZ.steps[WIZ.stepIdx];
    const isLast = WIZ.stepIdx >= WIZ.steps.length;

    // Progress dots
    const prog = document.getElementById('wiz-progress');
    prog.innerHTML = WIZ.steps.map((s, i) => `<div class="wiz-dot ${i < WIZ.stepIdx ? 'done' : i === WIZ.stepIdx ? 'active' : 'pending'}"></div>`).join('');

    // Resumen de campos ya completados
    const summary = document.getElementById('wiz-summary');
    const completedFields = WIZ.steps.slice(0, WIZ.stepIdx).filter(s => WIZ.data[s.key] !== undefined && WIZ.data[s.key] !== null);
    if (completedFields.length) {
        summary.innerHTML = completedFields.map(s => {
            const v = WIZ.data[s.key];
            const display = typeof v === 'object' ? (v.nombre || v.label || JSON.stringify(v)) : String(v);
            return `<div class="wiz-field-row"><span class="lbl">${s.label}</span><span class="val">${display}</span></div>`;
        }).join('');
    } else {
        summary.innerHTML = '<span style="font-size:12px;color:var(--text3);">Completando campos…</span>';
    }

    // Ocultar confirm, reset suggestions y manual
    document.getElementById('wiz-confirm-wrap').style.display = 'none';
    document.getElementById('wiz-suggestions').style.display = 'none';
    document.getElementById('wiz-suggestions').innerHTML = '';
    document.getElementById('wiz-manual-wrap').style.display = 'none';
    document.getElementById('wiz-manual-input').value = '';
    document.getElementById('wiz-voice-text').textContent = 'Pulsa el micrófono o habla…';
    document.getElementById('wiz-voice-text').classList.remove('wiz-voice-active');

    if (!step) {
        // Todos los pasos completados
        wizShowConfirm();
        return;
    }

    document.getElementById('wiz-step-num').textContent = WIZ.stepIdx + 1;
    document.getElementById('wiz-step-label').textContent = step.label;
    document.getElementById('wiz-step-hint').textContent = step.hint;

    // Mostrar botón saltar si es opcional
    document.getElementById('wiz-skip-btn').style.display = step.skippable ? '' : 'none';

    // Si hay sugerencias automáticas (ubicaciones o materiales), mostrarlas
    if (step.type === 'ubicacion' && WIZ.ubics.length) {
        showWizSuggestions(WIZ.ubics.map(u => ({ label: (u.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + u.nombre, value: u })), wizAcceptValue);
    } else if (step.type === 'material' && WIZ.mats.length <= 20) {
        showWizSuggestions(WIZ.mats.map(m => ({ label: m.nombre + ` (${m.cantidad || 0} ${m.unidad || 'ud'})`, value: m })), wizAcceptValue);
    }
}

// ── Aceptar valor del paso actual ──
function wizAcceptValue(value) {
    const step = WIZ.steps[WIZ.stepIdx];
    if (!step) return;
    WIZ.data[step.key] = value;
    WIZ.stepIdx++;

    // Vibración táctil de confirmación
    if (navigator.vibrate) navigator.vibrate(40);

    // Ocultar sugerencias y manual
    document.getElementById('wiz-suggestions').style.display = 'none';
    document.getElementById('wiz-manual-wrap').style.display = 'none';

    const displayVal = typeof value === 'object' ? (value.nombre || '?') : String(value);
    updateWizVoiceText('✓ ' + displayVal, false);

    setTimeout(() => {
        wizRenderStep();
        if (WIZ.stepIdx < WIZ.steps.length) {
            setTimeout(() => wizListenStep(), 350);
        }
    }, 600);
}

function wizSkipStep() {
    const step = WIZ.steps[WIZ.stepIdx];
    if (!step || !step.skippable) return;
    WIZ.data[step.key] = null;
    WIZ.stepIdx++;
    wizRenderStep();
    if (WIZ.stepIdx < WIZ.steps.length) setTimeout(() => wizListenStep(), 350);
}

function wizToggleManual() {
    const wrap = document.getElementById('wiz-manual-wrap');
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    if (wrap.style.display === 'block') document.getElementById('wiz-manual-input').focus();
}

async function wizAcceptManual() {
    const val = document.getElementById('wiz-manual-input').value.trim();
    if (!val) return;
    const step = WIZ.steps[WIZ.stepIdx];
    if (!step) return;

    if (step.type === 'number') {
        const n = parseFloat(val.replace(',', '.'));
        if (!n || n <= 0) { toast('Introduce un número válido', 'error'); return; }
        wizAcceptValue(n);
    } else if (step.type === 'material') {
        const q = norm(val);
        const found = WIZ.mats.filter(m => norm(m.nombre).includes(q));
        if (found.length === 1) { wizAcceptValue(found[0]); return; }
        if (found.length > 1) { showWizSuggestions(found.map(m => ({ label: m.nombre, value: m })), wizAcceptValue); return; }
        // No existe — crear nuevo material con ese nombre (objeto provisional)
        wizAcceptValue({ id: null, nombre: val, unidad: 'ud', cantidad: 0, precio: 0, _new: true });
    } else if (step.type === 'ubicacion') {
        const q = norm(val);
        const found = WIZ.ubics.filter(u => norm(u.nombre).includes(q));
        if (found.length === 1) { wizAcceptValue(found[0]); return; }
        if (found.length > 1) { showWizSuggestions(found.map(u => ({ label: u.nombre, value: u })), wizAcceptValue); return; }
        toast('Ubicación no encontrada. Elige de la lista.', 'error');
    } else {
        wizAcceptValue(val);
    }
}

function wizAllRequiredFilled() {
    return WIZ.steps.every(s => s.skippable || WIZ.data[s.key] !== undefined && WIZ.data[s.key] !== null);
}

function wizShowConfirm() {
    document.getElementById('wiz-step-card').style.display = 'none';
    document.getElementById('wiz-confirm-wrap').style.display = 'block';

    // Resumen final completo
    const summary = document.getElementById('wiz-summary');
    const canP = hasPermiso('verPrecios');
    const mat = WIZ.data.material;
    const qty = WIZ.data.cantidad;
    let rows = WIZ.steps.map(s => {
        const v = WIZ.data[s.key];
        if (v === null || v === undefined) return '';
        const display = typeof v === 'object' ? (v.nombre || '?') : String(v);
        return `<div class="wiz-field-row"><span class="lbl">${s.label}</span><span class="val">${display}</span></div>`;
    }).join('');
    if (canP && mat?.precio && qty) {
        rows += `<div class="wiz-field-row"><span class="lbl">Coste estimado</span><span class="val" style="color:var(--gold);">${(qty * mat.precio).toFixed(2)} €</span></div>`;
    }
    summary.innerHTML = rows || '—';

    speak('Todo listo. Di ok para confirmar.');

    // Escuchar "ok" automáticamente
    setTimeout(() => startListening('micBtnStep', 'micBtnStepLabel'), 600);
}

// ── Ejecutar la operación final ──
async function wizExecute() {
    stopListening();
    const { tipo, data } = WIZ;

    if (tipo === 'buscar') {
        await wizDoSearch(data.material);
        return;
    }
    if (tipo === 'pedir') {
        await wizDoPedido(data);
        return;
    }

    // Resolver material
    let mat = data.material;
    if (!mat) { toast('Falta el material', 'error'); return; }

    // Si es nuevo material creado manualmente
    if (mat._new) {
        const now = new Date().toISOString();
        const newId = await dbAdd('materiales', {
            nombre: mat.nombre, cantidad: 0, unidad: 'ud', precio: 0,
            ubicacionId: data.ubicacion?.id || null, minimo: 0, creado: now, creadoPor: currentUser?.nombre || '', synced: 0
        });
        mat = (await dbGetAll('materiales')).find(m => m.id === newId) || { id: newId, ...mat };
        toast('Material creado automáticamente', 'success');
    }

    const cantidad = data.cantidad || 1;
    const ubicId = data.ubicacion?.id || mat.ubicacionId || null;
    const ubicDestId = data.ubicacionDestino?.id || null;
    const nota = data.nota || '';

    if (tipo === 'salida' && mat.cantidad < cantidad) {
        showConfirmModal('Stock insuficiente',
            `<p style="font-size:13px;color:var(--danger);">Solo hay <strong>${mat.cantidad} ${mat.unidad || 'ud'}</strong> de ${mat.nombre}. ¿Confirmar igualmente?</p>`,
            () => wizDoMovement(mat, tipo, cantidad, ubicId, ubicDestId, nota));
        return;
    }
    await wizDoMovement(mat, tipo, cantidad, ubicId, ubicDestId, nota);
}

async function wizDoMovement(mat, tipo, cantidad, ubicId, ubicDestId, nota) {
    if (tipo === 'mover') {
        // Salida de origen
        mat.cantidad = Math.max(0, (mat.cantidad || 0) - cantidad);
        mat.synced = 0;
        await dbPut('materiales', mat);
        await registerMovement(mat.id, 'salida', cantidad, ubicId, ubicDestId, 'Mover: ' + nota);
        // Entrada en destino (mismo material, diferente ubicación)
        const matCopy = { ...mat, ubicacionId: ubicDestId, cantidad: (mat.cantidad + cantidad), synced: 0 };
        // Si es una ubicación diferente, actualizamos la ubicación del material o creamos entrada
        await registerMovement(mat.id, 'entrada', cantidad, ubicDestId, null, 'Mover desde: ' + (WIZ.data.ubicacion?.nombre || ''));
        toast(`⇄ ${cantidad} ${mat.unidad || 'ud'} de ${mat.nombre} movidos`, 'success');
    } else {
        const delta = tipo === 'entrada' ? cantidad : -cantidad;
        mat.cantidad = Math.max(0, (mat.cantidad || 0) + delta);
        mat.synced = 0;
        if (ubicId) mat.ubicacionId = ubicId;
        await dbPut('materiales', mat);
        await registerMovement(mat.id, tipo, cantidad, ubicId || mat.ubicacionId, null, nota);
        toast(`✓ ${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${cantidad} ${mat.unidad || 'ud'} de ${mat.nombre}`, 'success');
    }
    wizReset();
    renderAll();
    scheduleSyncSoon();
}

async function wizDoSearch(mat) {
    const query = typeof mat === 'object' ? mat.nombre : (mat || '');
    const q = norm(query);
    const mats = await dbGetAll('materiales');
    let found = q ? mats.filter(m => norm(m.nombre).includes(q)) : mats;
    // Si la búsqueda exacta no da resultados, probar coincidencia fonética/difusa
    // (tolera errores de transcripción por voz como "tuvo" en vez de "tubo")
    if (q && !found.length) {
        found = mats
            .map(m => ({ m, score: fuzzyScore(q, m.nombre) }))
            .filter(x => x.score >= 0.55 || fuzzyMatch(q, x.m.nombre))
            .sort((a, b) => b.score - a.score)
            .map(x => x.m);
    }
    const canP = hasPermiso('verPrecios');
    const el = document.getElementById('wiz-search-result');
    el.style.display = 'block';
    document.getElementById('wiz-active').style.display = 'none';

    if (!found.length) {
        el.innerHTML = `<div class="result-card" style="border-left-color:var(--warn);"><h3>Sin resultados</h3><p style="font-size:13px;color:var(--text2);">No se encontró "${query}"</p><button class="btn btn-secondary" style="margin-top:8px;" onclick="wizCancel()">Volver</button></div>`;
        return;
    }
    const ubics = await dbGetAll('ubicaciones'); const ubicMap = {}; ubics.forEach(u => ubicMap[u.id] = u);
    el.innerHTML = `<div class="result-card"><h3>🔍 "${query}" — ${found.length} resultado${found.length > 1 ? 's' : ''}</h3>
    ${found.map(m => {
        const ub = ubicMap[m.ubicacionId];
        const ubL = ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre : '—';
        return `<div class="result-row">
        <div><strong style="font-size:13px;">${m.nombre}</strong><div style="font-size:11px;color:var(--text2);">${ubL}</div></div>
        <div style="text-align:right;"><span class="val" style="color:${m.cantidad <= 0 ? 'var(--danger)' : m.cantidad <= (m.minimo || 0) ? 'var(--warn)' : 'var(--success)'};font-size:16px;">${m.cantidad}</span><div style="font-size:10px;color:var(--text3);">${m.unidad || 'ud'}</div>${canP && m.precio ? `<div style="font-size:10px;color:var(--gold);">${m.precio.toFixed(2)} €/ud</div>` : ''}</div>
      </div>`;
    }).join('')}
  </div><button class="btn btn-secondary" onclick="wizCancel()">← Volver</button>`;
}

async function wizDoPedido(data) {
    if (!hasPermiso('crearPedidos')) { toast('Sin permiso', 'error'); return; }
    const mat = data.material;
    if (!mat) { toast('Falta el material', 'error'); return; }
    const cantidad = data.cantidad || 1;
    const precio = mat.precio || 0;
    const lineas = [{ materialId: mat.id, nombre: mat.nombre, cantidad, precio, subtotal: cantidad * precio }];
    await dbAdd('pedidos', { proveedor: mat.proveedor || '', estado: 'pendiente', notas: data.nota || 'Creado por asistente de voz', lineas, total: cantidad * precio, creadoPor: currentUser?.nombre || '', fecha: new Date().toISOString(), synced: 0 });
    toast('✓ Pedido creado', 'success');
    wizReset(); scheduleSyncSoon();
}

function wizReset() {
    WIZ.tipo = null; WIZ.steps = []; WIZ.stepIdx = 0; WIZ.data = {}; WIZ.mats = []; WIZ.ubics = [];
    document.getElementById('wiz-idle').style.display = 'block';
    document.getElementById('wiz-active').style.display = 'none';
    document.getElementById('wiz-search-result').style.display = 'none';
    document.getElementById('wiz-step-card').style.display = 'block';
}

function wizCancel() { stopListening(); wizReset(); }

// Texto a voz (opcional — usa Web Speech Synthesis)
function speak(text) {
    try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'es-ES'; utter.rate = 1.05; utter.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
    } catch (e) { }
}

// ── Búsqueda de materiales desde la pantalla de inventario ──
async function searchMaterialVoice(query) {
    await wizDoSearch(query);
}

// ── Mostrar etiqueta QR rápida de un ítem ──
async function showItemQrLabel(id, type) {
    await openQrLabels();
    labelsTab = type === 'material' ? 'materiales' : type === 'usuario' ? 'usuarios' : 'ubicaciones';
    await renderLabelsList();
    // Desmarcar todos y marcar solo el seleccionado
    selectAllLabels(false);
    const cb = document.querySelector(`#labels-list input[value="${id}"]`);
    if (cb) cb.checked = true;
}

let qrPreselectedMat = null;

async function registerMovement(matId, tipo, cantidad, ubicId, destUbicId, nota) {
    await dbAdd('movimientos', { materialId: matId, tipo, cantidad, ubicacionId: ubicId || null, ubicacionDestinoId: destUbicId || null, fecha: new Date().toISOString(), nota: nota || '', synced: 0, usuario: currentUser?.nombre || '' });
    updateSyncBadge();
}

// ══════════════════════════════════════════════
// PEDIDOS
// ══════════════════════════════════════════════
let currentPedTab = 'pendiente';
let pedLines = [];
let editingPedidoId = null;

async function openNewPedido() {
    editingPedidoId = null;
    pedLines = [{ materialId: null, nombre: '', cantidad: 1, precio: 0, subtotal: 0 }];
    renderPedLines();
    document.getElementById('ped-proveedor').value = '';
    document.getElementById('ped-notas').value = '';
    const t = document.querySelector('#pedidoModal h2'); if (t) t.textContent = 'Nuevo Pedido';
    const b = document.querySelector('#pedidoModal .btn-primary'); if (b) b.textContent = '📋 Crear pedido';
    document.getElementById('pedidoModal').classList.add('open');
}

// ── EDITAR PEDIDO (solo si es pendiente o aprobado) ──
async function editPedido(id) {
    const peds = await dbGetAll('pedidos'); const p = peds.find(x => x.id === id); if (!p) return;
    editingPedidoId = id;
    pedLines = (p.lineas || []).map(l => ({ ...l }));
    document.getElementById('ped-proveedor').value = p.proveedor || '';
    document.getElementById('ped-notas').value = p.notas || '';
    const t = document.querySelector('#pedidoModal h2'); if (t) t.textContent = 'Editar Pedido';
    const b = document.querySelector('#pedidoModal .btn-primary'); if (b) b.textContent = '💾 Guardar cambios';
    renderPedLines();
    document.getElementById('pedidoModal').classList.add('open');
}

async function renderPedLines() {
    const mats = await dbGetAll('materiales');
    const canVerPrecios = hasPermiso('verPrecios');
    const el = document.getElementById('ped-lines');
    el.innerHTML = pedLines.map((l, i) => `
    <div style="background:var(--bg3);border-radius:var(--rs);padding:10px;margin-bottom:8px;">
      <div class="form-group" style="margin-bottom:6px;">
        <select onchange="pedLineMatChange(${i},this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:8px;color:var(--text);font-size:13px;">
          <option value="">— Seleccionar material —</option>
          ${mats.map(m => `<option value="${m.id}" ${l.materialId === m.id ? 'selected' : ''}>${m.nombre}${canVerPrecios && m.precio ? ' (' + m.precio.toFixed(2) + '€/ud)' : ''}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" value="${l.cantidad}" min="1" onchange="pedLineQtyChange(${i},this.value)" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:8px;color:var(--text);font-size:13px;">
        ${canVerPrecios ? `<span style="font-size:13px;color:var(--gold);min-width:70px;text-align:right;">${l.subtotal.toFixed(2)} €</span>` : ''}
        <button onclick="pedLineRemove(${i})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:6px 10px;cursor:pointer;">✕</button>
      </div>
    </div>`).join('');
    updatePedTotal();
}

async function pedLineMatChange(i, matId) {
    const mats = await dbGetAll('materiales');
    const mat = mats.find(m => m.id === parseInt(matId));
    if (mat) { pedLines[i].materialId = mat.id; pedLines[i].nombre = mat.nombre; pedLines[i].precio = mat.precio || 0; pedLines[i].subtotal = pedLines[i].cantidad * (mat.precio || 0); }
    renderPedLines();
}
function pedLineQtyChange(i, qty) { pedLines[i].cantidad = parseFloat(qty) || 1; pedLines[i].subtotal = pedLines[i].cantidad * pedLines[i].precio; renderPedLines(); }
function pedLineRemove(i) { pedLines.splice(i, 1); renderPedLines(); }
function addPedLine() { pedLines.push({ materialId: null, nombre: '', cantidad: 1, precio: 0, subtotal: 0 }); renderPedLines(); }
function updatePedTotal() { const t = pedLines.reduce((s, l) => s + l.subtotal, 0); const el = document.getElementById('ped-total'); if (el) el.textContent = t.toFixed(2) + ' €'; }

async function savePedido() {
    const prov = document.getElementById('ped-proveedor').value.trim();
    const notas = document.getElementById('ped-notas').value.trim();
    const validLines = pedLines.filter(l => l.materialId && l.cantidad > 0);
    if (!validLines.length) { toast('Añade al menos un material', 'error'); return; }
    const total = validLines.reduce((s, l) => s + l.subtotal, 0);
    if (editingPedidoId) {
        const peds = await dbGetAll('pedidos'); const p = peds.find(x => x.id === editingPedidoId);
        if (p) {
            Object.assign(p, { proveedor: prov, notas, lineas: validLines, total, ...auditMod(), synced: 0 });
            await dbPut('pedidos', p);
            toast('✓ Pedido actualizado', 'success');
        }
    } else {
        await dbAdd('pedidos', { proveedor: prov, estado: 'pendiente', notas, lineas: validLines, total, creadoPor: currentUser?.nombre || '', ...auditNuevo(), fecha: new Date().toISOString(), synced: 0 });
        toast('✓ Pedido creado', 'success');
    }
    editingPedidoId = null;
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
    const canVerPrecios = hasPermiso('verPrecios');
    const canAprobar = hasPermiso('aprobarPedidos');
    const el = document.getElementById('pedidosList');
    if (!filtered.length) { el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>No hay pedidos ${currentPedTab === 'pendiente' ? 'pendientes' : currentPedTab === 'aprobado' ? 'aprobados' : 'recibidos'}</p></div>`; return; }
    const canEditar = hasPermiso('crearPedidos');
    el.innerHTML = filtered.map(p => {
        const statusCls = 'ps-' + p.estado;
        const statusLabel = p.estado === 'pendiente' ? '⏳ Pendiente' : p.estado === 'aprobado' ? '✓ Aprobado' : p.estado === 'recibido' ? '📦 Recibido' : '✕ Cancelado';
        const fd = new Date(p.fecha);
        const fs = fd.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
        const lineas = (p.lineas || []).map(l => `<div class="pedido-item-row"><span>${l.nombre || 'Material'} × ${l.cantidad}</span><span>${canVerPrecios ? l.subtotal?.toFixed(2) + ' €' : '—'}</span></div>`).join('');
        const audit = fmtAudit(p);
        const acciones = [];
        if (p.estado === 'pendiente' && canAprobar) acciones.push(`<button class="btn btn-primary" onclick="cambiarEstadoPedido(${p.id},'aprobado')">✓ Aprobar</button>`);
        if (p.estado === 'aprobado') acciones.push(`<button class="btn btn-success" onclick="cambiarEstadoPedido(${p.id},'recibido')">📦 Recibido</button>`);
        if ((p.estado === 'pendiente' || p.estado === 'aprobado') && canEditar) acciones.push(`<button class="btn btn-edit" onclick="editPedido(${p.id})">✏️ Editar</button>`);
        if ((p.estado === 'pendiente' || p.estado === 'aprobado') && canAprobar) acciones.push(`<button class="btn btn-secondary" onclick="cambiarEstadoPedido(${p.id},'cancelado')">✕</button>`);
        return `<div class="pedido-card">
      <div class="pedido-header"><div><h3>${p.proveedor || 'Sin proveedor'}</h3></div><span class="pedido-status ${statusCls}">${statusLabel}</span></div>
      <div class="pedido-meta">${fs}${p.notas ? ` · ${p.notas}` : ''}${audit ? `<br><span style="color:var(--text3);font-size:10px;">${audit}</span>` : ''}</div>
      <div class="pedido-items">${lineas}</div>
      ${canVerPrecios ? `<div class="pedido-total"><span>Total</span><span>${(p.total || 0).toFixed(2)} €</span></div>` : ''}
      ${acciones.length ? `<div class="pedido-actions">${acciones.join('')}</div>` : ''}
    </div>`;
    }).join('');
}

async function cambiarEstadoPedido(id, nuevoEstado) {
    const peds = await dbGetAll('pedidos');
    const ped = peds.find(p => p.id === id);
    if (!ped) return;
    // Si se recibe, actualizar stock
    if (nuevoEstado === 'recibido' && ped.lineas?.length) {
        for (const l of ped.lineas) {
            if (!l.materialId) continue;
            const mats = await dbGetAll('materiales');
            const mat = mats.find(m => m.id === l.materialId);
            if (mat) { mat.cantidad = (mat.cantidad || 0) + l.cantidad; mat.synced = 0; await dbPut('materiales', mat); await registerMovement(mat.id, 'entrada', l.cantidad, mat.ubicacionId, null, 'Pedido recibido: ' + ped.proveedor); }
        }
        toast('📦 Stock actualizado automáticamente', 'success');
    }
    Object.assign(ped, { estado: nuevoEstado, ...auditMod(), synced: 0 });
    await dbPut('pedidos', ped); renderPedidos(); renderInventory(); scheduleSyncSoon();
    toast(`✓ Pedido ${nuevoEstado}`, 'success');
}

// ══════════════════════════════════════════════
// RENDER
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
    const q = norm(document.getElementById('searchInput')?.value || '');
    const fU = document.getElementById('filterUbic')?.value;
    const canVerPrecios = hasPermiso('verPrecios');
    let f = mats; if (q) f = f.filter(m => norm(m.nombre).includes(q)); if (fU) f = f.filter(m => String(m.ubicacionId) === String(fU));
    const el = document.getElementById('inventoryList'); if (!el) return;
    if (!f.length) { el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg><p>${q ? 'Sin resultados' : 'Sin materiales. ¡Empieza añadiendo!'}</p></div>`; return; }
    el.innerHTML = f.map(m => {
        const ub = ubicMap[m.ubicacionId];
        const ubL = ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : ub.tipo === 'almacen' ? '🏭 ' : '📍 ') + ub.nombre : '—';
        const qc = m.cantidad <= 0 ? 'stock-zero' : m.cantidad <= (m.minimo || 0) ? 'stock-low' : '';
        return `<div class="item-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div class="item-info">
          <h3>${m.nombre}</h3>
          <p>${ubL}${m.proveedor ? ' · ' + m.proveedor : ''}</p>
          ${m.descripcion ? `<p style="font-size:10px;color:var(--text3);font-style:italic;">${m.descripcion}</p>` : ''}
          ${m.minimo && m.cantidad <= m.minimo ? `<p style="color:var(--warn);font-size:10px;">⚠️ Stock bajo (mín: ${m.minimo})</p>` : ''}
        </div>
        <div class="item-stock">
          <div class="qty ${qc}">${m.cantidad}</div>
          <div class="unit">${m.unidad || 'ud'}</div>
          ${canVerPrecios && m.precio ? `<div class="price-tag">${m.precio.toFixed(2)} €/ud</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;border-top:1px solid rgba(255,255,255,.05);padding-top:8px;">
        <button onclick="openQrScanner('movimiento');qrPreselectedMat=${m.id}" style="flex:1;background:rgba(79,142,247,.1);border:1px solid rgba(79,142,247,.2);color:var(--accent);border-radius:var(--rs);padding:7px;font-size:11px;font-weight:600;cursor:pointer;">↕ Movimiento</button>
        <button onclick="showItemQrLabel(${m.id},'material')" style="flex:1;background:var(--bg3);border:1px solid var(--border);color:var(--text2);border-radius:var(--rs);padding:7px;font-size:11px;font-weight:600;cursor:pointer;">🏷️ Etiqueta QR</button>
      </div>
    </div>`;
    }).join('');
}

async function renderMovements() {
    const [movs, mats, ubics] = await Promise.all([dbGetAll('movimientos'), dbGetAll('materiales'), dbGetAll('ubicaciones')]);
    const matMap = {}, ubicMap = {}; mats.forEach(m => matMap[m.id] = m); ubics.forEach(u => ubicMap[u.id] = u);
    let f = [...movs].reverse(); if (currentMovTab !== 'all') f = f.filter(m => m.tipo === currentMovTab);
    const el = document.getElementById('movementsList'); if (!el) return;
    if (!f.length) { el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg><p>Sin movimientos</p></div>`; return; }
    el.innerHTML = f.slice(0, 100).map(mv => {
        const mat = matMap[mv.materialId], ub = ubicMap[mv.ubicacionId], isIn = mv.tipo === 'entrada';
        const fd = new Date(mv.fecha);
        const fs = fd.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + fd.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return `<div class="mov-item"><div class="mov-icon ${isIn ? 'mov-in' : 'mov-out'}">${isIn ? '↑' : '↓'}</div><div class="mov-info"><h4>${mat ? mat.nombre : '—'}</h4><p>${ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre + ' · ' : ''} ${fs}${mv.usuario ? ' · ' + mv.usuario : ''}${!mv.synced ? ' · ⏳' : ' · ☁️'}</p></div><div class="mov-qty ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${mv.cantidad}</div></div>`;
    }).join('');
}

async function renderAdmin() {
    if (!hasPermiso('gestionAdmin')) {
        const lk = document.getElementById('lock-admin'); const ac = document.getElementById('admin-content');
        if (lk) lk.style.display = 'flex'; if (ac) ac.style.display = 'none'; return;
    }
    const lk = document.getElementById('lock-admin'); const ac = document.getElementById('admin-content');
    if (lk) lk.style.display = 'none'; if (ac) ac.style.display = 'block';
    const [mats, ubics, users] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones'), dbGetAll('usuarios')]);
    const ubicMap = {}; ubics.forEach(u => ubicMap[u.id] = u);

    // Mat list — con descripción, auditoría y botón editar
    const ml = document.getElementById('matList');
    if (ml) ml.innerHTML = mats.length ? mats.map(m => {
        const ub = ubicMap[m.ubicacionId]; const audit = fmtAudit(m);
        return `<div class="item-card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div class="item-info">
          <h3 style="font-size:13px;">${m.nombre}</h3>
          <p>${ub ? ub.nombre : '—'} · ${m.precio || 0}€/ud · mín:${m.minimo || 0}${m.proveedor ? ' · ' + m.proveedor : ''}</p>
          ${m.descripcion ? `<p style="font-size:10px;color:var(--text3);font-style:italic;">${m.descripcion}</p>` : ''}
          ${audit ? `<p style="font-size:10px;color:var(--text3);margin-top:2px;">${audit}</p>` : ''}
        </div>
        <div class="item-stock"><div class="qty" style="font-size:16px;">${m.cantidad}</div><div class="unit">${m.unidad || 'ud'}</div></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;border-top:1px solid rgba(255,255,255,.05);padding-top:8px;">
        <button onclick="editMaterial(${m.id})" style="flex:1;background:rgba(79,142,247,.1);border:1px solid rgba(79,142,247,.2);color:var(--accent);border-radius:6px;padding:7px;cursor:pointer;font-size:11px;font-weight:600;">✏️ Editar</button>
        <button onclick="deleteMaterial(${m.id})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:7px 12px;cursor:pointer;font-size:11px;font-weight:600;">✕</button>
      </div>
    </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Sin materiales</p>';

    // Ubic select en formulario de material
    const ms = document.getElementById('matUbic');
    if (ms) ms.innerHTML = '<option value="">Sin ubicación</option>' + ubics.map(u => `<option value="${u.id}">${u.tipo === 'furgoneta' ? '🚐 ' : '🏭 '}${u.nombre}</option>`).join('');

    // Ubic list — con descripción, dirección y auditoría
    const ul = document.getElementById('ubicList');
    if (ul) ul.innerHTML = ubics.length ? ubics.map(u => {
        const icon = u.tipo === 'furgoneta' ? '🚐' : u.tipo === 'almacen' ? '🏭' : u.tipo === 'obra' ? '🏗️' : '📍';
        const audit = fmtAudit(u);
        return `<div class="item-card" style="margin-bottom:8px;">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <div style="font-size:20px;flex-shrink:0;">${icon}</div>
        <div class="item-info" style="flex:1;">
          <h3 style="font-size:13px;">${u.nombre}</h3>
          <p>${u.tipo.charAt(0).toUpperCase() + u.tipo.slice(1)}${u.direccion ? ' · ' + u.direccion : ''}</p>
          ${u.descripcion ? `<p style="font-size:10px;color:var(--text3);font-style:italic;">${u.descripcion}</p>` : ''}
          ${audit ? `<p style="font-size:10px;color:var(--text3);margin-top:2px;">${audit}</p>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;border-top:1px solid rgba(255,255,255,.05);padding-top:8px;">
        <button onclick="editUbicacion(${u.id})" style="flex:1;background:rgba(79,142,247,.1);border:1px solid rgba(79,142,247,.2);color:var(--accent);border-radius:6px;padding:7px;cursor:pointer;font-size:11px;font-weight:600;">✏️ Editar</button>
        <button onclick="deleteUbicacion(${u.id})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:7px 12px;cursor:pointer;font-size:11px;font-weight:600;">✕</button>
      </div>
    </div>`;
    }).join('') : '<p style="color:var(--text3);font-size:13px;">Sin ubicaciones</p>';

    // User list — con auditoría y botón editar
    const userList = document.getElementById('userList');
    if (userList) userList.innerHTML = users.map(u => {
        const r = ROLES[u.rol] || ROLES.operario; const audit = fmtAudit(u);
        return `<div class="user-card">
      <div class="user-avatar" style="background:${r.color}22;color:${r.color};">${u.nombre.charAt(0).toUpperCase()}</div>
      <div class="user-info">
        <h3>${u.nombre}</h3>
        <p><span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span></p>
        ${audit ? `<p style="font-size:10px;color:var(--text3);margin-top:3px;">${audit}</p>` : ''}
      </div>
      <div style="display:flex;gap:5px;">
        ${(u.rol === 'operario' || u.rol === 'encargado') ? `<button onclick="showItemQrLabel(${u.id},'usuario')" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);border-radius:6px;padding:6px 9px;cursor:pointer;font-size:11px;" title="Imprimir credencial QR">🏷️</button>` : ''}
        <button onclick="editUser(${u.id})" style="background:rgba(79,142,247,.1);border:1px solid rgba(79,142,247,.2);color:var(--accent);border-radius:6px;padding:6px 9px;cursor:pointer;font-size:11px;">✏️</button>
        <button onclick="deleteUser(${u.id})" style="background:rgba(231,76,60,.15);border:none;color:var(--danger);border-radius:6px;padding:6px 9px;cursor:pointer;">✕</button>
      </div>
    </div>`;
    }).join('');
}

async function updateStats() {
    const [mats, ubics, movs] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones'), dbGetAll('movimientos')]);
    const el = id => document.getElementById(id);
    if (el('statMat')) el('statMat').textContent = mats.length; if (el('statUbic')) el('statUbic').textContent = ubics.length;
    if (el('statMov')) el('statMov').textContent = movs.length; if (el('statPend')) el('statPend').textContent = movs.filter(m => !m.synced).length;
    updateSyncBadge();
}
async function updateSyncBadge() {
    const movs = await dbGetAll('movimientos'); const p = movs.filter(m => !m.synced).length;
    const b = document.getElementById('sync-badge'); if (!b) return;
    b.textContent = p > 0 ? `⏳${p}` : '☁️'; b.className = 'status ' + (p > 0 ? 'offline' : 'online');
}

// ══════════════════════════════════════════════
// ACCIONES
// ══════════════════════════════════════════════
async function addUser() {
    const n = document.getElementById('newUserNombre').value.trim();
    const rol = document.getElementById('newUserRol').value;
    const pin = document.getElementById('newUserPin').value.trim();
    if (!n) { toast('Escribe el nombre', 'error'); return; }
    if (!/^\d{4}$/.test(pin)) { toast('PIN de 4 dígitos', 'error'); return; }
    await dbAdd('usuarios', { nombre: n, rol, pin, creado: new Date().toISOString(), ...auditNuevo(), synced: 0 });
    document.getElementById('newUserNombre').value = ''; document.getElementById('newUserPin').value = '';
    toast('✓ Usuario añadido', 'success'); renderAdmin(); scheduleSyncSoon();
}

async function deleteUser(id) {
    if (currentUser?.id === id) { toast('No puedes eliminarte a ti mismo', 'error'); return; }
    showConfirmModal('Eliminar usuario', '<p style="font-size:13px;color:var(--text2);">¿Eliminar este usuario?</p>', async () => {
        await dbDelete('usuarios', id); toast('Usuario eliminado', 'success'); renderAdmin();
    });
}

// ── EDITAR USUARIO ──
async function editUser(id) {
    const users = await dbGetAll('usuarios'); const u = users.find(x => x.id === id); if (!u) return;
    document.getElementById('editModalTitle').textContent = 'Editar Usuario';
    document.getElementById('editModalBody').innerHTML = `
    <div class="form-group"><label>Nombre</label><input id="eu-nombre" type="text" value="${esc(u.nombre)}"></div>
    <div class="form-group"><label>Rol</label>
      <select id="eu-rol">
        <option value="operario" ${u.rol === 'operario' ? 'selected' : ''}>👷 Operario</option>
        <option value="encargado" ${u.rol === 'encargado' ? 'selected' : ''}>🔑 Encargado</option>
        <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>👑 Administrador</option>
        <option value="lector_presencia" ${u.rol === 'lector_presencia' ? 'selected' : ''}>📋 Lector de Presencia</option>
      </select>
    </div>
    <div class="form-group"><label>Nuevo PIN (dejar vacío para no cambiar)</label><input id="eu-pin" type="password" maxlength="4" inputmode="numeric" placeholder="••••"></div>
    ${fmtAudit(u) ? `<p style="font-size:11px;color:var(--text3);margin-top:8px;">${fmtAudit(u)}</p>` : ''}`;
    document.getElementById('editModalSave').onclick = async () => {
        const nombre = document.getElementById('eu-nombre').value.trim();
        const rol = document.getElementById('eu-rol').value;
        const pin = document.getElementById('eu-pin').value.trim();
        if (!nombre) { toast('El nombre no puede estar vacío', 'error'); return; }
        if (pin && !/^\d{4}$/.test(pin)) { toast('El PIN debe ser 4 dígitos', 'error'); return; }
        u.nombre = nombre; u.rol = rol; if (pin) u.pin = pin;
        Object.assign(u, auditMod()); u.synced = 0;
        await dbPut('usuarios', u);
        if (currentUser?.id === u.id) { currentUser = u; updateTopbarUser(); applyRoleUI(); }
        closeModal('editModal'); toast('✓ Usuario actualizado', 'success'); renderAdmin(); scheduleSyncSoon();
    };
    document.getElementById('editModal').classList.add('open');
}

async function addMaterial() {
    const n = document.getElementById('matNombre').value.trim(); if (!n) { toast('Escribe el nombre', 'error'); return; }
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unit = document.getElementById('matUnit').value.trim() || 'ud';
    const precio = parseFloat(document.getElementById('matPrecio').value) || 0;
    const ubicId = parseInt(document.getElementById('matUbic').value) || null;
    const min = parseInt(document.getElementById('matMin').value) || 0;
    const proveedor = document.getElementById('matProveedor').value.trim();
    const desc = document.getElementById('matDesc')?.value.trim() || '';
    const id = await dbAdd('materiales', { nombre: n, cantidad: qty, unidad: unit, precio, ubicacionId: ubicId, minimo: min, proveedor, descripcion: desc, creado: new Date().toISOString(), ...auditNuevo(), synced: 0 });
    if (qty > 0) await registerMovement(id, 'entrada', qty, ubicId, null, 'Inventario inicial');
    document.getElementById('matNombre').value = ''; document.getElementById('matQty').value = '0'; document.getElementById('matUnit').value = ''; document.getElementById('matPrecio').value = '0'; document.getElementById('matMin').value = '0'; document.getElementById('matProveedor').value = '';
    const de = document.getElementById('matDesc'); if (de) de.value = '';
    toast('✓ Material añadido', 'success'); renderAll(); scheduleSyncSoon();
}
async function deleteMaterial(id) { showConfirmModal('Eliminar material', '<p style="font-size:13px;color:var(--text2);">¿Eliminar este material?</p>', async () => { await dbDelete('materiales', id); toast('Eliminado', 'success'); renderAll(); }); }

// ── EDITAR MATERIAL ──
async function editMaterial(id) {
    const mats = await dbGetAll('materiales'); const m = mats.find(x => x.id === id); if (!m) return;
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
    <div class="form-group"><label>Proveedor</label><input id="em-proveedor" type="text" value="${esc(m.proveedor || '')}"></div>
    <div class="form-group"><label>Ubicación</label><select id="em-ubic"><option value="">Sin ubicación</option>${ubicOpts}</select></div>
    <div class="form-group"><label>Descripción / Notas</label><textarea id="em-desc" rows="2" style="resize:none;">${esc(m.descripcion || '')}</textarea></div>
    ${fmtAudit(m) ? `<p style="font-size:11px;color:var(--text3);margin-top:6px;">${fmtAudit(m)}</p>` : ''}`;
    document.getElementById('editModalSave').onclick = async () => {
        const cantAnterior = m.cantidad;
        const cantNueva = parseFloat(document.getElementById('em-qty').value) || 0;
        m.nombre = document.getElementById('em-nombre').value.trim() || m.nombre;
        m.cantidad = cantNueva;
        m.unidad = document.getElementById('em-unit').value.trim() || 'ud';
        m.precio = parseFloat(document.getElementById('em-precio').value) || 0;
        m.minimo = parseInt(document.getElementById('em-min').value) || 0;
        m.proveedor = document.getElementById('em-proveedor').value.trim();
        m.ubicacionId = parseInt(document.getElementById('em-ubic').value) || null;
        m.descripcion = document.getElementById('em-desc').value.trim();
        Object.assign(m, auditMod()); m.synced = 0;
        await dbPut('materiales', m);
        if (cantNueva !== cantAnterior) {
            const diff = cantNueva - cantAnterior;
            await registerMovement(m.id, diff > 0 ? 'entrada' : 'salida', Math.abs(diff), m.ubicacionId, null, 'Ajuste manual (edición)');
        }
        closeModal('editModal'); toast('✓ Material actualizado', 'success'); renderAll(); scheduleSyncSoon();
    };
    document.getElementById('editModal').classList.add('open');
}

async function addUbicacion() {
    const n = document.getElementById('ubicNombre').value.trim(); if (!n) { toast('Escribe el nombre', 'error'); return; }
    const tipo = document.getElementById('ubicTipo').value;
    const dir = document.getElementById('ubicDireccion')?.value.trim() || '';
    const desc = document.getElementById('ubicDesc')?.value.trim() || '';
    await dbAdd('ubicaciones', { nombre: n, tipo, direccion: dir, descripcion: desc, creado: new Date().toISOString(), ...auditNuevo(), synced: 0 });
    document.getElementById('ubicNombre').value = '';
    const de = document.getElementById('ubicDireccion'); if (de) de.value = '';
    const dd = document.getElementById('ubicDesc'); if (dd) dd.value = '';
    toast('✓ Ubicación añadida', 'success'); renderAll(); scheduleSyncSoon();
}
async function deleteUbicacion(id) { await dbDelete('ubicaciones', id); toast('Eliminada', 'success'); renderAll(); }

// ── EDITAR UBICACIÓN ──
async function editUbicacion(id) {
    const ubics = await dbGetAll('ubicaciones'); const u = ubics.find(x => x.id === id); if (!u) return;
    document.getElementById('editModalTitle').textContent = 'Editar Ubicación';
    document.getElementById('editModalBody').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Nombre</label><input id="eub-nombre" type="text" value="${esc(u.nombre)}"></div>
      <div class="form-group"><label>Tipo</label>
        <select id="eub-tipo">
          <option value="almacen" ${u.tipo === 'almacen' ? 'selected' : ''}>Almacén</option>
          <option value="furgoneta" ${u.tipo === 'furgoneta' ? 'selected' : ''}>Furgoneta</option>
          <option value="obra" ${u.tipo === 'obra' ? 'selected' : ''}>Obra</option>
          <option value="otro" ${u.tipo === 'otro' ? 'selected' : ''}>Otro</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Dirección / Matrícula</label><input id="eub-dir" type="text" value="${esc(u.direccion || '')}"></div>
    <div class="form-group"><label>Descripción</label><textarea id="eub-desc" rows="3" style="resize:none;">${esc(u.descripcion || '')}</textarea></div>
    ${fmtAudit(u) ? `<p style="font-size:11px;color:var(--text3);margin-top:6px;">${fmtAudit(u)}</p>` : ''}`;
    document.getElementById('editModalSave').onclick = async () => {
        u.nombre = document.getElementById('eub-nombre').value.trim() || u.nombre;
        u.tipo = document.getElementById('eub-tipo').value;
        u.direccion = document.getElementById('eub-dir').value.trim();
        u.descripcion = document.getElementById('eub-desc').value.trim();
        Object.assign(u, auditMod()); u.synced = 0;
        await dbPut('ubicaciones', u);
        closeModal('editModal'); toast('✓ Ubicación actualizada', 'success'); renderAll(); scheduleSyncSoon();
    };
    document.getElementById('editModal').classList.add('open');
}

async function exportCSV(tipo) {
    const [mats, ubics, movs, peds] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones'), dbGetAll('movimientos'), dbGetAll('pedidos')]);
    const matMap = {}, ubicMap = {}; mats.forEach(m => matMap[m.id] = m); ubics.forEach(u => ubicMap[u.id] = u);
    const canVerPrecios = hasPermiso('verPrecios');
    let csv = '', fn = '';
    if (tipo === 'inventario' || tipo === 'todo') {
        csv += 'INVENTARIO\nID,Nombre,Cantidad,Unidad,Precio (€),Proveedor,Ubicación,Stock Mínimo,Descripción,Creado por,Modificado por,Modificado en\n';
        csv += mats.map(m => [m.id, `"${m.nombre}"`, m.cantidad, m.unidad || 'ud', canVerPrecios ? m.precio || 0 : '***', `"${m.proveedor || ''}"`, `"${ubicMap[m.ubicacionId]?.nombre || ''}"`, m.minimo || 0, `"${m.descripcion || ''}"`, `"${m.creadoPor || ''}"`, `"${m.modificadoPor || ''}"`, m.modificadoEn || ''].join(',')).join('\n') + '\n\n';
        fn = 'inventario.csv';
    }
    if (tipo === 'ubicaciones' || tipo === 'todo') {
        csv += 'UBICACIONES\nID,Nombre,Tipo,Dirección,Descripción,Creado por,Modificado por,Modificado en\n';
        csv += ubics.map(u => [u.id, `"${u.nombre}"`, u.tipo, `"${u.direccion || ''}"`, `"${u.descripcion || ''}"`, `"${u.creadoPor || ''}"`, `"${u.modificadoPor || ''}"`, u.modificadoEn || ''].join(',')).join('\n') + '\n\n';
        if (tipo === 'ubicaciones') fn = 'ubicaciones.csv';
    }
    if (tipo === 'movimientos' || tipo === 'todo') { csv += 'MOVIMIENTOS\nID,Tipo,Material,Cantidad,Ubicación,Fecha,Usuario\n'; csv += movs.map(mv => [mv.id, mv.tipo, `"${matMap[mv.materialId]?.nombre || ''}"`, mv.cantidad, `"${ubicMap[mv.ubicacionId]?.nombre || ''}"`, mv.fecha, mv.usuario || ''].join(',')).join('\n') + '\n\n'; if (tipo === 'movimientos') fn = 'movimientos.csv'; }
    if (tipo === 'pedidos' || tipo === 'todo') {
        csv += 'PEDIDOS\nID,Proveedor,Estado,Total (€),Fecha,Creado por,Modificado por,Modificado en,Notas\n';
        csv += peds.map(p => [p.id, `"${p.proveedor || ''}"`, p.estado, canVerPrecios ? p.total?.toFixed(2) || 0 : '***', p.fecha, `"${p.creadoPor || ''}"`, `"${p.modificadoPor || ''}"`, p.modificadoEn || '', `"${p.notas || ''}"`].join(',')).join('\n') + '\n\n';
        if (tipo === 'pedidos') fn = 'pedidos.csv';
    }
    if (tipo === 'todo') fn = 'stockvoz_completo.csv';
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fn; a.click(); URL.revokeObjectURL(url);
    toast('✓ CSV exportado', 'success');
}

async function loadSampleData() {
    showConfirmModal('Cargar datos de ejemplo', '<p style="font-size:13px;color:var(--text2);">Se añadirán ubicaciones, materiales y usuarios de ejemplo.</p>', async () => {
        const now = new Date().toISOString();
        const audit0 = { ...auditNuevo(), synced: 0, creado: now };
        const u1 = await dbAdd('ubicaciones', { nombre: 'Almacén Central', tipo: 'almacen', direccion: 'Polígono Industrial Norte, nave 3', descripcion: 'Almacén principal. Acceso con tarjeta. Horario 7-20h.', ...audit0 });
        const u2 = await dbAdd('ubicaciones', { nombre: 'Almacén B', tipo: 'almacen', direccion: 'Polígono Industrial Norte, nave 7', descripcion: 'Almacén secundario para materiales de obra.', ...audit0 });
        const u3 = await dbAdd('ubicaciones', { nombre: 'Furgoneta 1', tipo: 'furgoneta', direccion: 'Matrícula: 1234 ABC', descripcion: 'Furgoneta de reparto diario. Revisión en marzo.', ...audit0 });
        const u4 = await dbAdd('ubicaciones', { nombre: 'Furgoneta 2', tipo: 'furgoneta', direccion: 'Matrícula: 5678 XYZ', descripcion: 'Furgoneta de instalaciones eléctricas.', ...audit0 });
        const u5 = await dbAdd('ubicaciones', { nombre: 'Obra Norte', tipo: 'obra', direccion: 'C/ Rosalía de Castro 42, Vigo', descripcion: 'Reforma local comercial. Fin previsto: junio.', ...audit0 });
        const samples = [
            { nombre: 'Tornillo M8', cantidad: 500, unidad: 'ud', precio: 0.05, ubicacionId: u1, minimo: 50, proveedor: 'Tornillería García', descripcion: 'Acero inoxidable A2, cabeza hexagonal' },
            { nombre: 'Cable eléctrico 2.5mm', cantidad: 150, unidad: 'm', precio: 1.20, ubicacionId: u2, minimo: 20, proveedor: 'ElecDist', descripcion: 'Cable flexible H07V-K libre de halógenos' },
            { nombre: 'Brida nylon', cantidad: 1000, unidad: 'ud', precio: 0.02, ubicacionId: u3, minimo: 100, proveedor: '', descripcion: '200x4.8mm, color negro' },
            { nombre: 'Cinta aislante', cantidad: 24, unidad: 'ud', precio: 1.80, ubicacionId: u3, minimo: 5, proveedor: 'ElecDist', descripcion: '' },
            { nombre: 'Interruptor simple', cantidad: 15, unidad: 'ud', precio: 3.50, ubicacionId: u4, minimo: 5, proveedor: 'ElecDist', descripcion: '10A 250V, blanco' },
            { nombre: 'Hormigón seco 25kg', cantidad: 12, unidad: 'saco', precio: 6.90, ubicacionId: u5, minimo: 3, proveedor: 'Materiales López', descripcion: 'CEM II/B-L 32,5 N' },
        ];
        for (const m of samples) { const id = await dbAdd('materiales', { ...m, ...audit0 }); await registerMovement(id, 'entrada', m.cantidad, m.ubicacionId, null, 'Stock inicial'); }
        // Añadir usuarios de ejemplo (incluye lector de presencia)
        const users = await dbGetAll('usuarios');
        if (!users.find(u => u.nombre === 'Encargado')) { await dbAdd('usuarios', { nombre: 'Encargado', rol: 'encargado', pin: '1234', ...audit0 }); }
        if (!users.find(u => u.nombre === 'Operario 1')) { await dbAdd('usuarios', { nombre: 'Operario 1', rol: 'operario', pin: '0000', ...audit0 }); }
        if (!users.find(u => u.nombre === 'Operario 2')) { await dbAdd('usuarios', { nombre: 'Operario 2', rol: 'operario', pin: '1111', ...audit0 }); }
        if (!users.find(u => u.nombre === 'Recepción')) { await dbAdd('usuarios', { nombre: 'Recepción', rol: 'lector_presencia', pin: '2222', ...audit0 }); }
        toast('✓ Datos de ejemplo cargados', 'success'); renderAll(); scheduleSyncSoon();
    });
}

async function clearAllData() {
    showConfirmModal('⚠️ Borrar TODO', '<p style="font-size:13px;color:var(--danger);font-weight:600;">Se eliminan TODOS los datos locales incluyendo usuarios.</p>', async () => {
        for (const s of ['materiales', 'ubicaciones', 'movimientos', 'pedidos']) await dbClear(s);
        localStorage.removeItem('last_pull');
        toast('Datos eliminados', 'error'); doLogout();
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
    const nb = document.getElementById('nav-' + name); if (nb) nb.classList.add('active');
    if (name === 'inv') renderInventory();
    else if (name === 'mov') renderMovements();
    else if (name === 'ped') renderPedidos();
    else if (name === 'admin') { renderAdmin(); updateStats(); }
    else if (name === 'qr') {/* QR screen rendered statically */ }
    else if (name === 'fichaje') renderFichaje();
}

function setMovTab(tab) { currentMovTab = tab; document.querySelectorAll('#screen-mov .tab').forEach((t, i) => t.classList.toggle('active', ['all', 'entrada', 'salida'][i] === tab)); renderMovements(); }

function setAdminTab(tab) {
    currentAdminTab = tab;
    ['mat', 'ubic', 'users', 'sync', 'export'].forEach(t => { const el = document.getElementById('admin-' + t); if (el) el.style.display = t === tab ? 'block' : 'none'; });
    document.querySelectorAll('#screen-admin .tabs .tab').forEach((t, i) => t.classList.toggle('active', ['mat', 'ubic', 'users', 'sync', 'export'][i] === tab));
    if (tab === 'sync') renderSyncScreen(); else if (tab !== 'mat') renderAdmin();
}

function showConfirmModal(title, body, onConfirm, confirmLabel = 'Confirmar') {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').innerHTML = body;
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
    await initDB();
    initVoice();
    await initLogin();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();

// ══════════════════════════════════════════════
// QR — ESCÁNER Y ETIQUETAS
// ══════════════════════════════════════════════
let qrStream = null, qrWorking = false, qrMode = 'movimiento', qrAnimId = null;
let qrCameraDevices = [], qrSelectedDeviceId = null;
let labelsTab = 'materiales', labelsData = [];

function getQrVideoConstraints() {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (qrSelectedDeviceId) {
        return { video: { ...base, deviceId: { exact: qrSelectedDeviceId } } };
    }
    return { video: { ...base, facingMode: { ideal: 'user' } } };
}

async function populateQrCameraSelector() {
    const select = document.getElementById('qr-camera-select');
    if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        qrCameraDevices = devices;
        if (!devices.length) {
            select.innerHTML = '<option value="">Sin cámaras</option>';
            select.style.display = 'none';
            return;
        }
        select.innerHTML = '';
        devices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Cámara ${index + 1}`;
            select.appendChild(option);
        });
        const preferredDeviceId = qrSelectedDeviceId
            || devices.find(d => /front|frontal|user|self/i.test(d.label))?.deviceId
            || devices[0].deviceId;
        qrSelectedDeviceId = preferredDeviceId;
        select.value = preferredDeviceId;
        select.style.display = 'inline-block';
    } catch (e) {
        select.style.display = 'none';
    }
}

async function switchQrCamera(deviceId) {
    if (!deviceId) return;
    qrSelectedDeviceId = deviceId;
    const status = document.getElementById('qr-status');
    if (status) status.textContent = 'Cambiando cámara…';
    stopQrDetection();
    if (qrStream) {
        qrStream.getTracks().forEach(track => track.stop());
        qrStream = null;
    }
    try {
        qrStream = await navigator.mediaDevices.getUserMedia(getQrVideoConstraints());
        const video = document.getElementById('qr-video');
        video.srcObject = qrStream;
        await video.play();
        qrWorking = false;
        if (status) status.textContent = 'Apunta la cámara al código QR';
        startQrDetection();
    } catch (e) {
        if (status) status.textContent = '⚠️ No se pudo cambiar a la cámara seleccionada: ' + e.message;
    }
}

// ── Abrir escáner ──
async function openQrScanner(mode) {
    qrMode = mode;
    setQrMode(mode);
    const title = document.getElementById('qr-scanner-title');
    if (title) title.textContent = mode === 'fichaje' ? '📋 Escanear credencial de fichaje' : '📷 Escanear QR';
    document.getElementById('qr-scanner-overlay').classList.add('open');
    document.getElementById('qr-status').textContent = mode === 'fichaje'
        ? 'Apunta al QR del operario — se registrará entrada o salida automáticamente'
        : 'Iniciando cámara…';
    try {
        qrStream = await navigator.mediaDevices.getUserMedia(getQrVideoConstraints());
        const video = document.getElementById('qr-video');
        video.srcObject = qrStream;
        await video.play();
        await populateQrCameraSelector();
        qrWorking = false;
        if (mode !== 'fichaje') document.getElementById('qr-status').textContent = 'Apunta la cámara al código QR';
        startQrDetection();
    } catch (e) {
        document.getElementById('qr-status').textContent = '⚠️ Cámara no disponible: ' + e.message;
    }
}

function closeQrScanner() {
    stopQrDetection();
    if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
    document.getElementById('qr-scanner-overlay').classList.remove('open');
    const title = document.getElementById('qr-scanner-title');
    if (title) title.textContent = '📷 Escanear QR';
}

function setQrMode(mode) {
    qrMode = mode;
    const tabs = document.getElementById('qr-mode-tabs');
    if (mode === 'fichaje') {
        // El modo fichaje no usa las pestañas movimiento/info
        if (tabs) tabs.style.display = 'none';
        return;
    }
    if (tabs) tabs.style.display = '';
    const tMov = document.getElementById('qr-tab-mov');
    const tInfo = document.getElementById('qr-tab-info');
    if (tMov) tMov.className = mode === 'movimiento' ? 'qr-tab-active' : 'qr-tab-inactive';
    if (tInfo) tInfo.className = mode === 'info' ? 'qr-tab-active' : 'qr-tab-inactive';
}

// ── Detección QR con BarcodeDetector (nativo Android Chrome) ──
function startQrDetection() {
    if (!('BarcodeDetector' in window)) {
        // Fallback: usar el canvas manualmente con jsQR
        startQrFallback();
        return;
    }
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const video = document.getElementById('qr-video');
    const detect = async () => {
        if (qrWorking) { qrAnimId = requestAnimationFrame(detect); return; }
        try {
            const codes = await detector.detect(video);
            if (codes.length > 0) {
                qrWorking = true;
                handleQrResult(codes[0].rawValue);
                return;
            }
        } catch (e) { }
        qrAnimId = requestAnimationFrame(detect);
    };
    qrAnimId = requestAnimationFrame(detect);
}

function startQrFallback() {
    // Canvas + jsQR library loaded lazily
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.onload = () => {
        const video = document.getElementById('qr-video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const tick = () => {
            if (qrWorking) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = window.jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
                if (code) { qrWorking = true; handleQrResult(code.data); return; }
            }
            qrAnimId = requestAnimationFrame(tick);
        };
        qrAnimId = requestAnimationFrame(tick);
    };
    document.head.appendChild(script);
}

function stopQrDetection() {
    if (qrAnimId) { cancelAnimationFrame(qrAnimId); qrAnimId = null; }
    qrWorking = false;
}

// ── Procesar resultado del QR ──
async function handleQrResult(raw) {
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    document.getElementById('qr-status').textContent = '✓ Código leído — ' + raw.substring(0, 40);

    let payload;
    try { payload = JSON.parse(raw); } catch (e) { payload = { type: 'unknown', raw }; }

    closeQrScanner();

    const [mats, ubics] = await Promise.all([dbGetAll('materiales'), dbGetAll('ubicaciones')]);

    if (payload.type === 'material') {
        const mat = mats.find(m => m.id === payload.id);
        if (mat) {
            if (qrMode === 'info') showQrInfo('material', mat, ubics);
            else showQrMovimiento(mat, ubics);
        } else {
            toast('Material no encontrado en la base de datos local', 'error');
        }
    } else if (payload.type === 'ubicacion') {
        const ubic = ubics.find(u => u.id === payload.id);
        if (ubic) {
            if (qrMode === 'info') showQrUbicInfo(ubic, mats);
            else showQrUbicMovimiento(ubic, mats);
        } else {
            toast('Ubicación no encontrada', 'error');
        }
    } else if (payload.type === 'usuario') {
        await handleQrFichaje(payload.id);
    } else {
        toast('QR no reconocido: ' + raw.substring(0, 60), 'error');
    }
}

// ── Fichaje automático mediante lectura de QR de usuario ──
// Detecta el estado actual del operario (dentro/fuera) y registra
// automáticamente el tipo de movimiento contrario (entrada si estaba
// fuera, salida si estaba dentro), sin mostrar registros de otros usuarios.
async function handleQrFichaje(userId) {
    const usuarios = await dbGetAll('usuarios');
    const usuario = usuarios.find(u => u.id === userId);
    if (!usuario) {
        toast('Usuario no encontrado en este dispositivo', 'error');
        return;
    }
    if (usuario.rol !== 'operario' && usuario.rol !== 'encargado') {
        toast(usuario.nombre + ' no tiene un perfil de fichaje válido', 'error');
        return;
    }

    // Determinar automáticamente si corresponde ENTRADA o SALIDA
    const ultimo = (typeof getUltFichaje === 'function') ? await getUltFichaje(userId) : null;
    const tipo = (ultimo && ultimo.tipo === 'entrada') ? 'salida' : 'entrada';

    if (typeof guardarFichaje === 'function') {
        await guardarFichaje({ userId, usuario, tipo, nota: 'Fichaje por QR', creadoPor: currentUser?.nombre || '' });
    } else {
        // Fallback si el módulo de presencia no está cargado en esta pantalla
        const now = new Date().toISOString();
        await dbAdd('fichajes', {
            userId, nombreUsuario: usuario.nombre, rolUsuario: usuario.rol,
            tipo, fecha: now, fechaLocal: new Date().toLocaleString('es-ES'),
            creadoPor: currentUser?.nombre || '', dispositivo: navigator.userAgent.substring(0, 80),
            sinc: 0, nota: 'Fichaje por QR'
        });
        if (navigator.vibrate) navigator.vibrate(tipo === 'entrada' ? [50, 30, 50] : [100]);
        toast(`${tipo === 'entrada' ? '↑' : '↓'} ${usuario.nombre} — ${tipo} registrada`, 'success');
    }

    // Refrescar las vistas de presencia si están activas
    if (typeof onFicharUserChange === 'function') {
        const sel = document.getElementById('fichar-user-sel');
        if (sel) { sel.value = String(userId); await onFicharUserChange(); }
    }
    if (typeof recargarPresencia === 'function' && currentUser?.rol === 'admin') {
        await renderAdminAhora(); await renderAdminStats();
    }
    if (typeof scheduleSyncSoon === 'function') scheduleSyncSoon();
}

// ── Mostrar info de material ──
async function showQrInfo(type, mat, ubics) {
    const ub = ubics.find(u => u.id === mat.ubicacionId);
    const canP = hasPermiso('verPrecios');
    document.getElementById('qra-title').textContent = mat.nombre;
    document.getElementById('qra-desc').textContent = (ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre : 'Sin ubicación');
    document.getElementById('qra-body').innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--rs);padding:12px;margin-bottom:12px;">
      <div class="wiz-field-row"><span class="lbl">Stock actual</span><span class="val" style="font-size:18px;color:${mat.cantidad <= 0 ? 'var(--danger)' : mat.cantidad <= (mat.minimo || 0) ? 'var(--warn)' : 'var(--success)'}">${mat.cantidad} ${mat.unidad || 'ud'}</span></div>
      ${mat.referencia ? `<div class="wiz-field-row"><span class="lbl">Referencia</span><span class="val">${mat.referencia}</span></div>` : ''}
      ${mat.proveedor ? `<div class="wiz-field-row"><span class="lbl">Proveedor</span><span class="val">${mat.proveedor}</span></div>` : ''}
      ${canP && mat.precio ? `<div class="wiz-field-row"><span class="lbl">Precio</span><span class="val" style="color:var(--gold);">${mat.precio.toFixed(2)} €/ud</span></div>` : ''}
      ${mat.minimo ? `<div class="wiz-field-row"><span class="lbl">Stock mínimo</span><span class="val">${mat.minimo}</span></div>` : ''}
      ${mat.descripcion ? `<div class="wiz-field-row"><span class="lbl">Descripción</span><span class="val" style="font-size:12px;">${mat.descripcion}</span></div>` : ''}
    </div>
    <div class="btn-row">
      <button class="btn btn-success" onclick="closeQrSheet();wizStart('entrada');wizAcceptValue(${JSON.stringify(mat)});">↑ Entrada</button>
      <button class="btn btn-danger" onclick="closeQrSheet();wizStart('salida');wizAcceptValue(${JSON.stringify(mat)});">↓ Salida</button>
    </div>`;
    document.getElementById('qr-action-sheet').classList.add('open');
}

// ── Mostrar info de ubicación ──
async function showQrUbicInfo(ubic, mats) {
    const matsEnUbic = mats.filter(m => m.ubicacionId === ubic.id);
    const icon = ubic.tipo === 'furgoneta' ? '🚐' : ubic.tipo === 'almacen' ? '🏭' : ubic.tipo === 'obra' ? '🏗️' : '📍';
    document.getElementById('qra-title').textContent = icon + ' ' + ubic.nombre;
    document.getElementById('qra-desc').textContent = ubic.descripcion || ubic.tipo;
    document.getElementById('qra-body').innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--rs);padding:12px;margin-bottom:12px;">
      ${ubic.direccion ? `<div class="wiz-field-row"><span class="lbl">Dirección</span><span class="val">${ubic.direccion}</span></div>` : ''}
      <div class="wiz-field-row"><span class="lbl">Materiales</span><span class="val">${matsEnUbic.length}</span></div>
    </div>
    ${matsEnUbic.length ? `<p style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px;">Contenido:</p>
    <div style="max-height:200px;overflow-y:auto;">
    ${matsEnUbic.map(m => `<div class="wiz-field-row"><span>${m.nombre}</span><span class="val" style="color:${m.cantidad <= 0 ? 'var(--danger)' : m.cantidad <= (m.minimo || 0) ? 'var(--warn)' : 'var(--success)'}">${m.cantidad} ${m.unidad || 'ud'}</span></div>`).join('')}
    </div>`: '<p style="font-size:13px;color:var(--text3);">No hay materiales en esta ubicación</p>'}
    <div style="margin-top:12px;">
      <button class="btn btn-secondary" onclick="closeQrSheet();">Cerrar</button>
    </div>`;
    document.getElementById('qr-action-sheet').classList.add('open');
}

// ── Escanear material → iniciar movimiento con ubicación preseleccionada ──
async function showQrMovimiento(mat, ubics) {
    const ub = ubics.find(u => u.id === mat.ubicacionId);
    document.getElementById('qra-title').textContent = '📦 ' + mat.nombre;
    document.getElementById('qra-desc').textContent = `Stock: ${mat.cantidad} ${mat.unidad || 'ud'} ${ub ? '· ' + (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre : ''}`;
    document.getElementById('qra-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px;">¿Qué quieres registrar?</p>
    <div class="btn-row" style="margin-bottom:8px;">
      <button class="btn btn-success" onclick="closeQrSheet();qrStartMovimiento('entrada',${JSON.stringify(mat)})">↑ Entrada</button>
      <button class="btn btn-danger" onclick="closeQrSheet();qrStartMovimiento('salida',${JSON.stringify(mat)})">↓ Salida</button>
    </div>
    <button class="btn btn-secondary" onclick="closeQrSheet();qrStartMovimiento('mover',${JSON.stringify(mat)})">⇄ Mover a otra ubicación</button>`;
    document.getElementById('qr-action-sheet').classList.add('open');
}

// ── Escanear ubicación → ver contenido + acción ──
async function showQrUbicMovimiento(ubic, mats) {
    const icon = ubic.tipo === 'furgoneta' ? '🚐' : ubic.tipo === 'almacen' ? '🏭' : '📍';
    document.getElementById('qra-title').textContent = icon + ' ' + ubic.nombre;
    document.getElementById('qra-desc').textContent = ubic.descripcion || 'Elige qué hacer';
    const matsEnUbic = mats.filter(m => m.ubicacionId === ubic.id).slice(0, 8);
    document.getElementById('qra-body').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">¿Qué material entra o sale de esta ubicación?</p>
    ${matsEnUbic.length ? `<div style="max-height:140px;overflow-y:auto;margin-bottom:10px;">` +
            matsEnUbic.map(m => `<div class="wiz-field-row" style="cursor:pointer;padding:8px 4px;" onclick="closeQrSheet();showQrMovimiento(${JSON.stringify(m)},${JSON.stringify(mats.filter(x => x.ubicacionId === ubic.id))})">
        <span>${m.nombre}</span><span class="val" style="color:${m.cantidad <= (m.minimo || 0) ? 'var(--warn)' : 'var(--success)'}">${m.cantidad} ${m.unidad || 'ud'}</span>
      </div>`).join('') + `</div>` : ``}
    <button class="btn btn-primary" onclick="closeQrSheet();wizStart('entrada');wizSkipToField('ubicacion',${JSON.stringify(ubic)})">↑ Registrar entrada aquí</button>
    <button class="btn btn-secondary" onclick="closeQrSheet()">Cerrar</button>`;
    document.getElementById('qr-action-sheet').classList.add('open');
}

function closeQrSheet() {
    document.getElementById('qr-action-sheet').classList.remove('open');
}

// ── Iniciar asistente de voz con material preseleccionado ──
async function qrStartMovimiento(tipo, mat) {
    await wizStart(tipo);
    // Saltar directamente al paso material (índice 1) con el material ya seleccionado
    // El asistente empieza por cantidad
    // Primero pedimos la cantidad con un diálogo rápido
    const cantStr = prompt(`¿Cuántas unidades de "${mat.nombre}"? (stock actual: ${mat.cantidad} ${mat.unidad || 'ud'})`, '1');
    const cant = parseFloat(cantStr);
    if (!cant || cant <= 0) { wizCancel(); return; }
    wizAcceptValue(cant);       // acepta cantidad
    setTimeout(() => { wizAcceptValue(mat); }, 300); // acepta material
}

// ── Saltar a campo de ubicación con valor preseleccionado ──
function wizSkipToField(fieldKey, value) {
    const idx = WIZ.steps.findIndex(s => s.key === fieldKey);
    if (idx < 0) return;
    // Rellenar pasos anteriores si los hay
    for (let i = 0; i < idx; i++) {
        if (WIZ.data[WIZ.steps[i].key] === undefined) WIZ.data[WIZ.steps[i].key] = null;
    }
    WIZ.stepIdx = idx;
    wizAcceptValue(value);
}

// ══════════════════════════════════════════════
// QR — GENERACIÓN Y ETIQUETAS
// ══════════════════════════════════════════════
let labelsType = 'materiales';

async function openQrLabels() {
    labelsTab = 'materiales';
    document.querySelectorAll('#qr-labels-modal .tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    await renderLabelsList();
    document.getElementById('qr-labels-modal').classList.add('open');
}

async function setLabelsTab(type) {
    labelsTab = type;
    document.querySelectorAll('#qr-labels-modal .tab').forEach((t, i) => t.classList.toggle('active', ['materiales', 'ubicaciones', 'usuarios'][i] === type));
    await renderLabelsList();
}

async function renderLabelsList() {
    const q = norm(document.getElementById('labels-search')?.value || '');
    if (labelsTab === 'materiales') labelsData = await dbGetAll('materiales');
    else if (labelsTab === 'ubicaciones') labelsData = await dbGetAll('ubicaciones');
    else labelsData = (await dbGetAll('usuarios')).filter(u => u.rol === 'operario' || u.rol === 'encargado');
    const filtered = q ? labelsData.filter(item => norm(item.nombre).includes(q)) : labelsData;
    const el = document.getElementById('labels-list');
    el.innerHTML = filtered.map((item, i) => {
        let sub;
        if (labelsTab === 'materiales') sub = (item.unidad || 'ud') + ' · ' + (item.proveedor || '—');
        else if (labelsTab === 'ubicaciones') sub = (item.tipo || '') + ' · ' + (item.direccion || '—');
        else sub = (ROLES[item.rol]?.label || item.rol);
        return `<div class="label-card">
      <input type="checkbox" id="lbl-${i}" value="${item.id}" checked>
      <div class="label-card-info">
        <h4>${item.nombre}</h4>
        <p>${sub}</p>
      </div>
    </div>`;
    }).join('');
}

function selectAllLabels(val) {
    document.querySelectorAll('#labels-list input[type=checkbox]').forEach(cb => cb.checked = val);
}

async function printLabels() {
    // Cargar QRCode.js si no está
    if (!window.QRCode) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
        }
        );
    }

    const checked = [...document.querySelectorAll('#labels-list input[type=checkbox]:checked')].map(cb => parseInt(cb.value));
    const items = labelsData.filter(item => checked.includes(item.id));
    if (!items.length) {
        toast('Selecciona al menos una etiqueta', 'error');
        return;
    }

    const cols = parseInt(document.getElementById('label-cols').value) || 2;
    const sizeMm = parseInt(document.getElementById('label-size').value) || 60;
    const sizePx = sizeMm * 3.78;
    // mm a px aprox 96dpi

    const printArea = document.getElementById('print-label-area');
    printArea.innerHTML = '';

    const ubics = await dbGetAll('ubicaciones');
    const ubicMap = {};
    ubics.forEach(u => ubicMap[u.id] = u);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `display:flex;flex-wrap:wrap;gap:6px;padding:8px;`;

    for (const item of items) {
        const payload = JSON.stringify({
            type: labelsTab === 'materiales' ? 'material' : 'ubicacion',
            id: item.id,
            nombre: item.nombre
        });

        const div = document.createElement('div');
        div.className = 'print-label';
        div.style.cssText = `width:${sizeMm}mm;padding:3mm;border:1px solid #ccc;border-radius:2mm;font-family:Arial,sans-serif;box-sizing:border-box;page-break-inside:avoid;background:#fff;`;

        const icon = labelsTab === 'ubicaciones' ? (item.tipo === 'furgoneta' ? '🚐' : item.tipo === 'almacen' ? '🏭' : '📍') : '📦';
        let subtitle = '';
        if (labelsTab === 'materiales') {
            const ub = ubicMap[item.ubicacionId];
            subtitle = [(ub ? ub.nombre : ''), item.referencia || '', item.unidad || ''].filter(Boolean).join(' · ');
        } else {
            subtitle = [item.tipo || '', item.direccion || ''].filter(Boolean).join(' · ');
        }

        div.innerHTML = `
      <div style="font-size:9pt;font-weight:bold;margin-bottom:1mm;line-height:1.3;">${icon} ${item.nombre}</div>
      ${subtitle ? `<div style="font-size:6.5pt;color:#666;margin-bottom:2mm;">${subtitle}</div>` : ''}
      <div id="qrc-${item.id}" style="display:block;margin:0 auto;"></div>
      <div style="font-size:5.5pt;color:#999;text-align:center;margin-top:1mm;">StockVoz · ID:${item.id}</div>`;

        wrapper.appendChild(div);
    }
    printArea.appendChild(wrapper);

    // Generar QRs
    for (const item of items) {
        const payload = JSON.stringify({
            type: labelsTab === 'materiales' ? 'material' : labelsTab === 'ubicaciones' ? 'ubicacion' : 'usuario',            
            id: item.id,
            nombre: item.nombre
        });
        const canvas = printArea.querySelector(`#qrc-${item.id}`);
        if (canvas) {
            try {
                var qrc = new QRCode(canvas, {
                    width: Math.min(sizePx * 0.55, 120),
                    height: Math.min(sizePx * 0.55, 120)
                })
                qrc.makeCode(payload);                 
                // await QRCode.toCanvas(canvas, payload, {
                //   width: Math.min(sizePx*0.55, 120),
                //   margin:1,
                //   color:{ dark:'#1a1a2e', light:'#ffffff' }
                // });
            } catch (e) {
                console.error('QR error', e);
            }
        }
    }

    closeModal('qr-labels-modal');
    setTimeout(() => window.print(), 300);
}

async function printLabels2() {
    // Cargar QRCode.js si no está
    if (!window.QRCode) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    const checked = [...document.querySelectorAll('#labels-list input[type=checkbox]:checked')].map(cb => parseInt(cb.value));
    const items = labelsData.filter(item => checked.includes(item.id));
    if (!items.length) { toast('Selecciona al menos una etiqueta', 'error'); return; }

    const cols = parseInt(document.getElementById('label-cols').value) || 2;
    const sizeMm = parseInt(document.getElementById('label-size').value) || 60;
    const sizePx = sizeMm * 3.78; // mm a px aprox 96dpi

    const printArea = document.getElementById('print-label-area');
    printArea.innerHTML = '';

    const ubics = await dbGetAll('ubicaciones');
    const ubicMap = {}; ubics.forEach(u => ubicMap[u.id] = u);

    const qrType = labelsTab === 'materiales' ? 'material' : labelsTab === 'ubicaciones' ? 'ubicacion' : 'usuario';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `display:flex;flex-wrap:wrap;gap:6px;padding:8px;`;

    for (const item of items) {
        const div = document.createElement('div');
        div.className = 'print-label';
        div.style.cssText = `width:${sizeMm}mm;padding:3mm;border:1px solid #ccc;border-radius:2mm;font-family:Arial,sans-serif;box-sizing:border-box;page-break-inside:avoid;background:#fff;`;

        let icon, subtitle;
        if (labelsTab === 'materiales') {
            icon = '📦';
            const ub = ubicMap[item.ubicacionId];
            subtitle = [(ub ? ub.nombre : ''), item.referencia || '', item.unidad || ''].filter(Boolean).join(' · ');
        } else if (labelsTab === 'ubicaciones') {
            icon = item.tipo === 'furgoneta' ? '🚐' : item.tipo === 'almacen' ? '🏭' : '📍';
            subtitle = [item.tipo || '', item.direccion || ''].filter(Boolean).join(' · ');
        } else {
            // Credencial de usuario para fichaje
            const r = ROLES[item.rol] || {};
            icon = r.emoji || '👤';
            subtitle = 'Credencial de fichaje · ' + (r.label || item.rol);
        }

        div.innerHTML = `
      <div style="font-size:9pt;font-weight:bold;margin-bottom:1mm;line-height:1.3;">${icon} ${item.nombre}</div>
      ${subtitle ? `<div style="font-size:6.5pt;color:#666;margin-bottom:2mm;">${subtitle}</div>` : ''}
      <canvas id="qrc-${item.id}" style="display:block;margin:0 auto;"></canvas>
      <div style="font-size:5.5pt;color:#999;text-align:center;margin-top:1mm;">StockVoz · ID:${item.id}</div>`;

        wrapper.appendChild(div);
    }
    printArea.appendChild(wrapper);

    // Generar QRs
    for (const item of items) {
        const payload = JSON.stringify({ type: qrType, id: item.id, nombre: item.nombre });
        const canvas = printArea.querySelector(`#qrc-${item.id}`);
        if (canvas) {
            try {
                await QRCode.toCanvas(canvas, payload, {
                    width: Math.min(sizePx * 0.55, 120),
                    margin: 1,
                    color: { dark: '#1a1a2e', light: '#ffffff' }
                });
            } catch (e) { console.error('QR error', e); }
        }
    }

    closeModal('qr-labels-modal');
    setTimeout(() => window.print(), 300);
}

// ── Botón flotante QR desde inventario ──
function showScreen_orig(name) { } // placeholder - overridden below

// ════════════════════════════════════════════
// MÓDULO LECTOR DE PRESENCIA
// ════════════════════════════════════════════
/* ══════════════════════════════════════════════════════════
   LECTOR DE PRESENCIA v2 — lector.js
   ══════════════════════════════════════════════════════════
   Dos vistas completamente separadas:
   · Vista operario  → solo fichar, no ve registros ajenos
   · Vista admin     → todo en tiempo real via Supabase RT
   ══════════════════════════════════════════════════════════ */

// ── Estado del módulo ──
const PRES = {
    clockTimer: null,   // setInterval del reloj
    adminTab: 'ahora',
    histPage: 0,
    histPageSize: 25,
    rtChannel: null,   // canal Supabase realtime
    timersPresentes: [],  // setInterval por presente (actualizar tiempo)
    configPollTimer: null // refresco periódico de config en dispositivos lectores
};

// ══════════════════════════════════════════════════════════
// CONFIG: fichaje manual habilitado/deshabilitado
// ══════════════════════════════════════════════════════════
const CFG_FICHAJE_MANUAL = 'permitirFichajeManual';

// Lee el ajuste y actualiza la UI correspondiente según el rol activo
async function applyFichajeConfigUI() {
    const permitido = await getConfigValue(CFG_FICHAJE_MANUAL, false);

    // Vista operario / lector de presencia
    const wrap = document.getElementById('fichar-manual-wrap');
    const notice = document.getElementById('fichar-manual-disabled-notice');
    if (wrap) wrap.style.display = permitido ? 'block' : 'none';
    if (notice) notice.style.display = permitido ? 'none' : 'block';

    // Vista admin: reflejar el estado del interruptor
    const toggle = document.getElementById('cfg-fichaje-manual');
    if (toggle) toggle.checked = !!permitido;
}

// Llamado al pulsar el interruptor en el panel de administración
async function onToggleFichajeManual(checked) {
    await setConfigValue(CFG_FICHAJE_MANUAL, checked);
    toast(checked ? '✓ Fichaje manual activado en lectores' : '🔒 Fichaje manual desactivado — solo QR', 'success');
    await applyFichajeConfigUI();
}

// Refresco periódico silencioso para que los dispositivos lectores
// detecten cambios de configuración hechos por el administrador
// sin necesidad de reiniciar sesión.
function startConfigPolling() {
    clearInterval(PRES.configPollTimer);
    PRES.configPollTimer = setInterval(async () => {
        if (!navigator.onLine) return;
        try {
            if (SB || initSupabase()) { await pullRemoteData(); }
        } catch (e) { }
        await applyFichajeConfigUI();
    }, 25000);
}
function stopConfigPolling() {
    clearInterval(PRES.configPollTimer);
    PRES.configPollTimer = null;
}

// ══════════════════════════════════════════════════════════
// PUNTO DE ENTRADA — llamado desde showScreen('fichaje')
// ══════════════════════════════════════════════════════════
async function renderFichaje() {
    const rol = currentUser?.rol;
    const esAdmin = rol === 'admin';
    const esLector = rol === 'lector_presencia';

    document.getElementById('vista-admin').style.display = esAdmin ? 'block' : 'none';
    document.getElementById('vista-operario').style.display = esLector ? 'block' : 'none';

    if (esAdmin) {
        await initAdminView();
    } else if (esLector) {
        await initOperarioView();
    }
}

// ══════════════════════════════════════════════════════════
// RELOJ COMPARTIDO
// ══════════════════════════════════════════════════════════
function startClock(timeId, dateId) {
    clearInterval(PRES.clockTimer);
    const tick = () => {
        const now = new Date();
        const tEl = document.getElementById(timeId);
        const dEl = document.getElementById(dateId);
        if (tEl) tEl.textContent = now.toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        if (dEl) dEl.textContent = now.toLocaleDateString('es-ES', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
        });
    };
    tick();
    PRES.clockTimer = setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════
// VISTA OPERARIO
// ══════════════════════════════════════════════════════════
async function initOperarioView() {
    startClock('fichar-clock-time', 'fichar-clock-date');
    await applyFichajeConfigUI();
    await populateOperarioSelector();
    startConfigPolling();
}

async function populateOperarioSelector() {
    const usuarios = await dbGetAll('usuarios');
    // Mostrar solo operarios y encargados (los que fichan)
    const fichables = usuarios.filter(u =>
        u.rol === 'operario' || u.rol === 'encargado'
    );
    const sel = document.getElementById('fichar-user-sel');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar operario —</option>';
    fichables.forEach(u => {
        const r = ROLES[u.rol] || {};
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = (r.emoji || '') + ' ' + u.nombre;
        sel.appendChild(opt);
    });
    if (prev) { sel.value = prev; await onFicharUserChange(); }
}

async function onFicharUserChange() {
    const userId = parseInt(document.getElementById('fichar-user-sel')?.value);
    const dot = document.getElementById('fichar-estado-dot');
    const txt = document.getElementById('fichar-estado-txt');
    const ul = document.getElementById('fichar-ultimo');

    if (!userId) {
        if (dot) dot.className = 'estado-dot estado-unknown';
        if (txt) txt.textContent = 'Selecciona un operario';
        if (ul) ul.style.display = 'none';
        return;
    }

    const usuarios = await dbGetAll('usuarios');
    const usuario = usuarios.find(u => u.id === userId);
    const ultimo = await getUltFichaje(userId);
    const dentro = ultimo?.tipo === 'entrada';

    if (dot) dot.className = 'estado-dot ' + (dentro ? 'estado-dentro' : 'estado-fuera');
    if (txt) {
        if (dentro) {
            const desde = new Date(ultimo.fecha);
            const dur = calcDur(ultimo.fecha, new Date().toISOString());
            txt.innerHTML =
                `<strong style="color:var(--success)">${usuario?.nombre}</strong>
         está dentro desde las
         ${desde.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
         <span style="color:var(--text3)">(${dur})</span>`;
        } else {
            const lastTxt = ultimo
                ? ` · Última salida: ${new Date(ultimo.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                : '';
            txt.innerHTML =
                `<strong style="color:var(--text2)">${usuario?.nombre}</strong>
         no está en el trabajo${lastTxt}`;
        }
    }

    // Mostrar SOLO los fichajes de HOY de ESTE operario (no de otros)
    await renderUltimosFichajesHoy(userId);
}

async function renderUltimosFichajesHoy(userId) {
    const ul = document.getElementById('fichar-ultimo');
    const list = document.getElementById('fichar-ultimo-list');
    if (!ul || !list) return;

    const todos = await dbGetAll('fichajes');
    const hoyStr = new Date().toISOString().substring(0, 10);
    // FILTRO ESTRICTO: solo del operario seleccionado, solo hoy
    const hoy = todos
        .filter(f => f.userId === userId && f.fecha.startsWith(hoyStr))
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    if (!hoy.length) { ul.style.display = 'none'; return; }
    ul.style.display = 'block';
    ul.classList.add('visible');

    list.innerHTML = hoy.map(f => {
        const hora = new Date(f.fecha).toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        return `<div class="fichar-ul-row">
      <span style="font-size:18px;">${f.tipo === 'entrada' ? '↑' : '↓'}</span>
      <span class="${f.tipo === 'entrada' ? 'fich-in' : 'fich-out'}" style="flex:1;">
        ${f.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'}
      </span>
      <span style="color:var(--text);font-size:13px;">${hora}</span>
    </div>`;
    }).join('');
}

// ── Registrar fichaje desde vista operario ──
async function registrarFichaje(tipo) {
    const userId = parseInt(document.getElementById('fichar-user-sel')?.value);
    if (!userId) { toast('Selecciona un operario', 'error'); return; }

    const usuarios = await dbGetAll('usuarios');
    const usuario = usuarios.find(u => u.id === userId);
    if (!usuario) { toast('Operario no encontrado', 'error'); return; }

    // Advertir si el último fichaje ya es del mismo tipo
    const ultimo = await getUltFichaje(userId);
    if (ultimo?.tipo === tipo) {
        const ok = confirm(
            `⚠️ ${usuario.nombre} ya tiene una ${tipo} registrada.\n¿Registrar de nuevo?`
        );
        if (!ok) return;
    }

    await guardarFichaje({ userId, usuario, tipo, nota: '', creadoPor: currentUser?.nombre || '' });

    // Actualizar UI operario
    await onFicharUserChange();

    // Disparar sync si Supabase disponible
    if (typeof scheduleSyncSoon === 'function') scheduleSyncSoon();
}

// ── Registrar fichaje manual desde vista admin ──
async function adminRegistrarFichaje(tipo) {
    const userId = parseInt(document.getElementById('admin-fich-user')?.value);
    const nota = document.getElementById('admin-fich-nota')?.value?.trim() || '';
    if (!userId) { toast('Selecciona un operario', 'error'); return; }

    const usuarios = await dbGetAll('usuarios');
    const usuario = usuarios.find(u => u.id === userId);
    if (!usuario) { toast('Operario no encontrado', 'error'); return; }

    await guardarFichaje({ userId, usuario, tipo, nota, creadoPor: currentUser?.nombre || '' });
    document.getElementById('admin-fich-nota').value = '';

    await recargarPresencia();
    if (typeof scheduleSyncSoon === 'function') scheduleSyncSoon();
}

// ── Guardar fichaje en IndexedDB y mostrar toast ──
async function guardarFichaje({ userId, usuario, tipo, nota, creadoPor }) {
    const now = new Date().toISOString();
    const fichaje = {
        userId,
        nombreUsuario: usuario.nombre,
        rolUsuario: usuario.rol,
        tipo,
        fecha: now,
        fechaLocal: new Date().toLocaleString('es-ES'),
        creadoPor,
        dispositivo: navigator.userAgent.substring(0, 80),
        sinc: 0,
        nota
    };
    await dbAdd('fichajes', fichaje);
    if (navigator.vibrate) navigator.vibrate(tipo === 'entrada' ? [50, 30, 50] : [100]);
    showFichajeToast(tipo, usuario.nombre, now);
}

// ── Toast grande de confirmación ──
function showFichajeToast(tipo, nombre, isoDate) {
    const overlay = document.getElementById('fich-toast');
    const inner = document.getElementById('fich-toast-inner');
    if (!overlay) return;
    const hora = new Date(isoDate).toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    document.getElementById('fct-icon').textContent = tipo === 'entrada' ? '✅' : '👋';
    document.getElementById('fct-title').textContent = tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada';
    document.getElementById('fct-nombre').textContent = nombre;
    document.getElementById('fct-hora').textContent = hora;
    inner.className = 'fich-toast-inner' + (tipo === 'salida' ? ' out' : '');
    overlay.classList.remove('hidden');
    setTimeout(hideFichajeToast, 3500);
}
function hideFichajeToast() {
    const el = document.getElementById('fich-toast');
    if (el) el.classList.add('hidden');
}

// ══════════════════════════════════════════════════════════
// VISTA ADMIN
// ══════════════════════════════════════════════════════════
async function initAdminView() {
    await applyFichajeConfigUI();
    await renderAdminAhora();
    await renderAdminStats();
    await populateAdminSelectors();
    iniciarRTFichajes();
    // Poner semana actual en el filtro de jornadas
    const wEl = document.getElementById('fjorn-week');
    if (wEl && !wEl.value) {
        const now = new Date();
        const y = now.getFullYear();
        const w = getWeekNumber(now);
        wEl.value = `${y}-W${String(w).padStart(2, '0')}`;
    }
}

// ── Recargar todo (botón actualizar) ──
async function recargarPresencia() {
    const btn = document.getElementById('btn-reload-pres');
    if (btn) btn.classList.add('spinning');

    // Si Supabase disponible, forzar descarga primero
    if (typeof pullRemoteData === 'function' && navigator.onLine) {
        await pullRemoteData();
    }

    await applyFichajeConfigUI();
    await renderAdminStats();
    await renderAdminAhora();
    await populateAdminSelectors();
    if (PRES.adminTab === 'historial') await renderAdminHistorial();
    if (PRES.adminTab === 'jornadas') await renderAdminJornadas();

    setTimeout(() => { if (btn) btn.classList.remove('spinning'); }, 600);
    toast('✓ Presencia actualizada', 'success');
}

// ── Stats resumen ──
async function renderAdminStats() {
    const fichajes = await dbGetAll('fichajes');
    const hoyStr = new Date().toISOString().substring(0, 10);
    const ahora = new Date();
    const lunes = new Date(ahora);
    lunes.setDate(ahora.getDate() - ((ahora.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);

    // Quién está dentro: último fichaje de cada usuario
    const ultPorUser = {};
    [...fichajes]
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
        .forEach(f => { ultPorUser[f.userId] = f; });
    const numPresentes = Object.values(ultPorUser).filter(f => f.tipo === 'entrada').length;

    const setN = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setN('ps-presentes', numPresentes);
    setN('ps-hoy', fichajes.filter(f => f.fecha.startsWith(hoyStr)).length);
    setN('ps-semana', fichajes.filter(f => new Date(f.fecha) >= lunes).length);
    setN('ps-total', fichajes.length);
}

// ── Tab Ahora: lista de presentes con tiempo acumulado ──
async function renderAdminAhora() {
    const fichajes = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const userMap = {}; usuarios.forEach(u => userMap[u.id] = u);

    const ultPorUser = {};
    [...fichajes]
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
        .forEach(f => { ultPorUser[f.userId] = f; });
    const presentes = Object.values(ultPorUser).filter(f => f.tipo === 'entrada');

    const el = document.getElementById('presentes-ahora-list');
    if (!el) return;

    // Limpiar timers anteriores
    PRES.timersPresentes.forEach(clearInterval);
    PRES.timersPresentes = [];

    if (!presentes.length) {
        el.innerHTML = `<p style="color:var(--text3);font-size:13px;
                    text-align:center;padding:24px 0;">
      Nadie fichado ahora mismo</p>`;
        return;
    }

    el.innerHTML = presentes.map(f => {
        const u = userMap[f.userId] || { nombre: f.nombreUsuario || '?', rol: 'operario' };
        const r = ROLES[u.rol] || ROLES.operario;
        const desde = new Date(f.fecha);
        return `<div class="presente-item" id="pi-${f.userId}">
      <div class="pres-avatar" style="background:${r.color}22;color:${r.color};">
        ${u.nombre.charAt(0).toUpperCase()}
      </div>
      <div class="pres-info">
        <h4>${u.nombre}</h4>
        <p>${r.emoji} ${r.label} · desde ${desde.toLocaleTimeString('es-ES',
            { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div class="pres-timer" id="pt-${f.userId}">—</div>
    </div>`;
    }).join('');

    // Timer que actualiza el tiempo de cada presente cada segundo
    presentes.forEach(f => {
        const update = () => {
            const el2 = document.getElementById('pt-' + f.userId);
            if (el2) el2.textContent = calcDur(f.fecha, new Date().toISOString());
        };
        update();
        PRES.timersPresentes.push(setInterval(update, 1000));
    });

    // Rellenar selector manual de admin
    const adminSel = document.getElementById('admin-fich-user');
    if (adminSel) {
        adminSel.innerHTML = '<option value="">— Seleccionar —</option>';
        usuarios.filter(u => u.rol === 'operario' || u.rol === 'encargado').forEach(u => {
            const o = document.createElement('option');
            o.value = u.id; o.textContent = u.nombre;
            adminSel.appendChild(o);
        });
    }
}

// ── Tab Historial ──
async function renderAdminHistorial() {
    const fichajes = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const userMap = {}; usuarios.forEach(u => userMap[u.id] = u);

    const userFilt = parseInt(document.getElementById('fhist-user')?.value) || null;
    const dateFilt = document.getElementById('fhist-date')?.value || null;

    let f = [...fichajes];
    if (userFilt) f = f.filter(x => x.userId === userFilt);
    if (dateFilt) f = f.filter(x => x.fecha.startsWith(dateFilt));
    f.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const total = f.length;
    const pages = Math.max(1, Math.ceil(total / PRES.histPageSize));
    PRES.histPage = Math.min(PRES.histPage, pages - 1);
    const page = f.slice(PRES.histPage * PRES.histPageSize, (PRES.histPage + 1) * PRES.histPageSize);

    const pi = document.getElementById('fhist-pag-info');
    if (pi) pi.textContent = `Pág. ${PRES.histPage + 1}/${pages} (${total} registros)`;
    const btns = document.querySelectorAll('#fhist-pag button');
    if (btns[0]) btns[0].disabled = PRES.histPage === 0;
    if (btns[1]) btns[1].disabled = PRES.histPage >= pages - 1;

    const tbody = document.getElementById('fhist-tbody');
    if (!tbody) return;

    if (!page.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;
      padding:24px;color:var(--text3);">Sin registros</td></tr>`;
        return;
    }

    tbody.innerHTML = page.map(fich => {
        const u = userMap[fich.userId] || { nombre: fich.nombreUsuario || '?', rol: 'operario' };
        const r = ROLES[u.rol] || ROLES.operario;
        const tipo = fich.tipo === 'entrada'
            ? '<span class="fich-in">↑ ENTRADA</span>'
            : '<span class="fich-out">↓ SALIDA</span>';
        const fecha = new Date(fich.fecha);
        const fs = fecha.toLocaleDateString('es-ES',
            { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
            fecha.toLocaleTimeString('es-ES',
                { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Calcular duración si es salida buscando entrada previa del mismo usuario
        let dur = '—';
        if (fich.tipo === 'salida') {
            const entrada = f.find(x =>
                x.userId === fich.userId &&
                x.tipo === 'entrada' &&
                new Date(x.fecha) < fecha
            );
            if (entrada) dur = calcDur(entrada.fecha, fich.fecha);
        }

        const nota = (fich.nota || fich.creadoPor)
            ? `${fich.nota || ''} ${fich.creadoPor ? '· por ' + fich.creadoPor : ''}`.trim()
            : '—';

        return `<tr>
      <td>
        <span class="mini-av" style="background:${r.color}22;color:${r.color};">
          ${u.nombre.charAt(0).toUpperCase()}
        </span>
        <span style="color:var(--text);">${u.nombre}</span>
      </td>
      <td>${tipo}</td>
      <td style="color:var(--text);white-space:nowrap;">${fs}</td>
      <td><span class="fich-dur">${dur}</span></td>
      <td style="font-size:11px;color:var(--text3);max-width:120px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nota}</td>
    </tr>`;
    }).join('');
}

function fHistPage(delta) {
    PRES.histPage = Math.max(0, PRES.histPage + delta);
    renderAdminHistorial();
}

// ── Tab Jornadas: resumen diario emparejando entradas/salidas ──
async function renderAdminJornadas() {
    const fichajes = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const userMap = {}; usuarios.forEach(u => userMap[u.id] = u);

    const userFilt = parseInt(document.getElementById('fjorn-user')?.value) || null;
    const weekVal = document.getElementById('fjorn-week')?.value || '';

    // Calcular rango de la semana
    let rangeStart = null, rangeEnd = null;
    if (weekVal) {
        const [y, w] = weekVal.split('-W').map(Number);
        rangeStart = getDateOfWeek(w, y);
        rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + 6);
        rangeEnd.setHours(23, 59, 59, 999);
    }

    let f = [...fichajes].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (userFilt) f = f.filter(x => x.userId === userFilt);
    if (rangeStart) f = f.filter(x => {
        const d = new Date(x.fecha);
        return d >= rangeStart && d <= rangeEnd;
    });

    // Agrupar por userId + día
    const jornadas = {};
    f.forEach(fich => {
        const dia = fich.fecha.substring(0, 10);
        const key = `${fich.userId}-${dia}`;
        if (!jornadas[key]) jornadas[key] = { userId: fich.userId, dia, entradas: [], salidas: [] };
        if (fich.tipo === 'entrada') jornadas[key].entradas.push(fich.fecha);
        else jornadas[key].salidas.push(fich.fecha);
    });

    const rows = Object.values(jornadas).sort((a, b) => b.dia.localeCompare(a.dia));
    const tbody = document.getElementById('fjorn-tbody');
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;
      padding:24px;color:var(--text3);">Sin jornadas en el periodo</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(j => {
        const u = userMap[j.userId] || { nombre: '?', rol: 'operario' };
        const r = ROLES[u.rol] || ROLES.operario;
        const pE = j.entradas[0] || null;
        const uS = j.salidas[j.salidas.length - 1] || null;
        const horas = pE && uS ? calcDur(pE, uS) : (pE ? 'En curso' : '—');
        const diaFmt = new Date(j.dia + 'T12:00:00').toLocaleDateString('es-ES',
            { weekday: 'short', day: '2-digit', month: '2-digit' });
        return `<tr>
      <td>
        <span class="mini-av" style="background:${r.color}22;color:${r.color};">
          ${u.nombre.charAt(0).toUpperCase()}
        </span>
        <span style="color:var(--text);">${u.nombre}</span>
      </td>
      <td style="color:var(--text);white-space:nowrap;">${diaFmt}</td>
      <td style="color:var(--success);">
        ${pE ? new Date(pE).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}
      </td>
      <td style="color:var(--danger);">
        ${uS ? new Date(uS).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}
      </td>
      <td style="font-weight:700;color:${horas === 'En curso' ? 'var(--warn)' : 'var(--text)'};">${horas}</td>
    </tr>`;
    }).join('');
}

// ── Poblar selectores de filtro del admin ──
async function populateAdminSelectors() {
    const usuarios = await dbGetAll('usuarios');
    const fichables = usuarios.filter(u => u.rol === 'operario' || u.rol === 'encargado');

    ['fhist-user', 'fjorn-user'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        const first = sel.querySelector('option');
        sel.innerHTML = '';
        if (first) sel.appendChild(first.cloneNode(true));
        fichables.forEach(u => {
            const o = document.createElement('option');
            o.value = u.id; o.textContent = u.nombre;
            sel.appendChild(o);
        });
        if (prev) sel.value = prev;
    });
}

// ── Cambio de tab admin ──
async function setPresentesTab(tab) {
    PRES.adminTab = tab;
    ['ahora', 'historial', 'jornadas'].forEach(t => {
        const btn = document.getElementById('ptab-' + t);
        const cnt = document.getElementById('ptab-content-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
        if (cnt) cnt.style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'historial') { PRES.histPage = 0; await renderAdminHistorial(); }
    if (tab === 'jornadas') await renderAdminJornadas();
}

// ══════════════════════════════════════════════════════════
// REALTIME SUPABASE — Admin recibe actualizaciones en vivo
// ══════════════════════════════════════════════════════════
function iniciarRTFichajes() {
    // Necesita que SB esté inicializado (variable del index.html)
    if (typeof SB === 'undefined' || !SB) {
        setRTStatus(false, 'Sin conexión Supabase');
        return;
    }

    // Evitar canales duplicados
    if (PRES.rtChannel) {
        try { SB.removeChannel(PRES.rtChannel); } catch (e) { }
        PRES.rtChannel = null;
    }

    PRES.rtChannel = SB.channel('pres-admin-live')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'fichajes' },
            async payload => {
                // Insertar directamente en IndexedDB local sin pull completo
                const r = payload.new;
                if (!r) return;
                const locales = await dbGetAll('fichajes');
                const existe = locales.find(f => f.local_id === r.local_id && r.local_id);
                if (!existe) {
                    await dbAdd('fichajes', {
                        userId: r.user_id,
                        nombreUsuario: r.nombre_usuario,
                        rolUsuario: r.rol_usuario,
                        tipo: r.tipo,
                        fecha: r.fecha,
                        fechaLocal: r.fecha_local,
                        creadoPor: r.creado_por,
                        dispositivo: r.dispositivo,
                        nota: r.nota || '',
                        local_id: r.local_id,
                        sinc: 1
                    });
                }
                // Actualizar UI sin titilar (solo el tab activo)
                await renderAdminStats();
                await renderAdminAhora();
                if (PRES.adminTab === 'historial') await renderAdminHistorial();
                if (PRES.adminTab === 'jornadas') await renderAdminJornadas();

                // Toast discreto
                const tipo = r.tipo === 'entrada' ? '↑' : '↓';
                toast(`${tipo} ${r.nombre_usuario || ''} — ${new Date(r.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`, '');
            }
        )
        .subscribe(status => {
            setRTStatus(status === 'SUBSCRIBED', status === 'SUBSCRIBED' ? 'Tiempo real activo' : status);
        });
}

function setRTStatus(live, label) {
    const dot = document.getElementById('fich-rt-dot');
    const lbl = document.getElementById('fich-rt-label');
    if (dot) dot.className = 'rt-dot' + (live ? ' live' : '');
    if (lbl) lbl.textContent = label || '';
}

// ══════════════════════════════════════════════════════════
// (Sincronización de fichajes y config ya implementada arriba,
//  en syncNow() y pullRemoteData())
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// EXPORTAR CSV
// ══════════════════════════════════════════════════════════
async function exportFichajesCSV() {
    const fichajes = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const userMap = {}; usuarios.forEach(u => userMap[u.id] = u);
    fichajes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    let csv = 'ID,Usuario,Rol,Tipo,Fecha ISO,Hora local,Registrado por,Nota,Dispositivo\n';
    csv += fichajes.map(f => {
        const u = userMap[f.userId] || { nombre: f.nombreUsuario || '?', rol: '?' };
        return [f.id, `"${u.nombre}"`, u.rol, f.tipo, f.fecha,
        `"${f.fechaLocal || ''}"`, `"${f.creadoPor || ''}"`,
        `"${f.nota || ''}"`, `"${(f.dispositivo || '').substring(0, 40)}"`
        ].join(',');
    }).join('\n');

    descargaCSV(csv, 'fichajes_presencia.csv');
}

async function exportResumenCSV() {
    const fichajes = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const userMap = {}; usuarios.forEach(u => userMap[u.id] = u);

    const jornadas = {};
    [...fichajes].sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).forEach(f => {
        const dia = f.fecha.substring(0, 10);
        const key = `${f.userId}-${dia}`;
        if (!jornadas[key]) jornadas[key] = { userId: f.userId, dia, entradas: [], salidas: [] };
        if (f.tipo === 'entrada') jornadas[key].entradas.push(f.fecha);
        else jornadas[key].salidas.push(f.fecha);
    });

    let csv = 'Usuario,Rol,Fecha,1ª Entrada,Última Salida,Horas trabajadas\n';
    Object.values(jornadas).sort((a, b) => a.dia.localeCompare(b.dia)).forEach(j => {
        const u = userMap[j.userId] || { nombre: '?', rol: '?' };
        const pE = j.entradas[0];
        const uS = j.salidas[j.salidas.length - 1];
        const h = pE && uS ? calcDur(pE, uS) : '—';
        csv += [
            `"${u.nombre}"`, u.rol, j.dia,
            pE ? new Date(pE).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—',
            uS ? new Date(uS).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—',
            h
        ].join(',') + '\n';
    });

    descargaCSV(csv, 'resumen_jornadas.csv');
}

function descargaCSV(csv, nombre) {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
    if (typeof toast === 'function') toast('✓ CSV exportado', 'success');
}

// ══════════════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════════════
async function getUltFichaje(userId) {
    const todos = await dbGetAll('fichajes');
    return [...todos]
        .filter(f => f.userId === userId)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0] || null;
}

function calcDur(isoA, isoB) {
    const diff = Math.max(0, new Date(isoB) - new Date(isoA));
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    const rM = mins % 60;
    const rS = secs % 60;
    if (hours > 0) return `${hours}h ${rM}m`;
    if (mins > 0) return `${mins}m ${rS}s`;
    return `${secs}s`;
}

function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getDateOfWeek(w, y) {
    const d = new Date(y, 0, 1 + (w - 1) * 7);
    const dow = d.getDay();
    if (dow <= 4) d.setDate(d.getDate() - d.getDay() + 1);
    else d.setDate(d.getDate() + 8 - d.getDay());
    return d;
}