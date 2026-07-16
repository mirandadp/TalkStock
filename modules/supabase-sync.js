// ══════════════════════════════════════════════
// MÓDULO: SINCRONIZACIÓN SUPABASE
// ══════════════════════════════════════════════

let SB = null, rtChannel = null, syncBusy = false;

const SETUP_SQL = `
create table if not exists ubicaciones (id bigint primary key default gen_random_bigint(), local_id int, nombre text not null, tipo text not null, direccion text, descripcion text, creado timestamptz default now(), creado_por text, modificado_por text, modificado_en timestamptz, updated_at timestamptz default now(), constraint uk_ubic_local unique(local_id));
create table if not exists materiales (id bigint primary key default gen_random_bigint(), local_id int, nombre text not null, cantidad numeric, unidad text, precio numeric, minimo int, proveedor text, descripcion text, ubicacion_id bigint references ubicaciones(id) on delete set null, creado timestamptz default now(), creado_por text, modificado_por text, modificado_en timestamptz, updated_at timestamptz default now(), constraint uk_mat_local unique(local_id));
create table if not exists movimientos (id bigint primary key default gen_random_bigint(), local_id int, material_id bigint references materiales(id), ubicacion_id bigint references ubicaciones(id) on delete set null, tipo text not null, cantidad numeric, nota text, usuario text, fecha timestamptz default now(), created_at timestamptz default now());
create table if not exists usuarios (id bigint primary key default gen_random_bigint(), local_id int, nombre text not null unique, rol text, pin text, creado timestamptz default now(), creado_por text, modificado_por text, modificado_en timestamptz, updated_at timestamptz default now(), constraint uk_usr_local unique(local_id));
create table if not exists pedidos (id bigint primary key default gen_random_bigint(), local_id int, proveedor text, estado text, notas text, lineas jsonb, total numeric, fecha timestamptz, creado_por text, modificado_por text, modificado_en timestamptz, updated_at timestamptz default now(), constraint uk_ped_local unique(local_id));
create table if not exists fichajes (id bigint primary key default gen_random_bigint(), local_id int, user_id bigint references usuarios(id) on delete cascade, nombre_usuario text, rol_usuario text, tipo text, fecha timestamptz, fecha_local text, creado_por text, dispositivo text, nota text, created_at timestamptz default now());
create table if not exists config (key text primary key, value jsonb, modificado_por text, modificado_en timestamptz, updated_at timestamptz default now());

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
        const { data: rFichs } = await SB.from('fichajes').select('*').gt('created_at', lastPull);
        if (rFichs?.length) {
            const lf = await dbGetAll('fichajes');
            for (const r of rFichs) {
                if (!lf.find(f => f.local_id === r.local_id && r.local_id)) {
                    await dbAdd('fichajes', { userId: r.user_id, nombreUsuario: r.nombre_usuario, rolUsuario: r.rol_usuario, tipo: r.tipo, fecha: r.fecha, fechaLocal: r.fecha_local, creadoPor: r.creado_por, dispositivo: r.dispositivo, nota: r.nota || '', local_id: r.local_id, sinc: 1 });
                }
            }
        }
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
