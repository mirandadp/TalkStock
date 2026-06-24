/* ══════════════════════════════════════════════════════════
   LECTOR DE PRESENCIA — lector.js
   ══════════════════════════════════════════════════════════

   DEPENDENCIAS: requiere que el index.html tenga definidas:
     - dbGetAll(store), dbAdd(store, data), dbPut(store, data)
     - currentUser, ROLES, hasPermiso(), fmtDate()
     - toast(msg, type)
     - CAN.verFichajes  (añadir en CAN del index.html)

   INTEGRACIÓN:
     - Incluir ANTES del cierre </script> del index.html:
       <script src="lector.js"></script>
     - O copiar el contenido dentro del <script> principal.

   CAMBIOS NECESARIOS EN index.html:
     Ver instrucciones detalladas en lector.html
   ══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// ESTADO DEL MÓDULO
// ══════════════════════════════════════════════════════════
const FICHAJE = {
  clockInterval: null,   // setInterval del reloj
  currentTab: 'fichar',  // tab activo
  histPage: 0,           // página actual del historial
  histPageSize: 20,      // registros por página
  fichajesSinSync: 0     // pendientes de subir a Supabase
};

// ══════════════════════════════════════════════════════════
// RENDERIZADO PRINCIPAL
// ══════════════════════════════════════════════════════════

/**
 * Punto de entrada — llamar desde showScreen('fichaje') del index.
 * También se llama automáticamente si el rol es lector_presencia.
 */
async function renderFichaje() {
  startFichajeClock();
  await populateFichajeUserSelector();
  await onFichajeUserChange();
  if (FICHAJE.currentTab === 'presentes') await renderPresentes();
  if (FICHAJE.currentTab === 'historial') await renderHistorial();
}

// ══════════════════════════════════════════════════════════
// RELOJ EN TIEMPO REAL
// ══════════════════════════════════════════════════════════
function startFichajeClock() {
  clearInterval(FICHAJE.clockInterval);
  tickFichajeClock();
  FICHAJE.clockInterval = setInterval(tickFichajeClock, 1000);
}

function tickFichajeClock() {
  const now = new Date();
  const timeEl = document.getElementById('fichaje-clock-time');
  const dateEl = document.getElementById('fichaje-clock-date');
  if (!timeEl) return;
  timeEl.textContent = now.toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  dateEl.textContent = now.toLocaleDateString('es-ES', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
}

// ══════════════════════════════════════════════════════════
// SELECTOR DE OPERARIO
// ══════════════════════════════════════════════════════════
async function populateFichajeUserSelector() {
  const usuarios = await dbGetAll('usuarios');
  // Solo mostrar operarios y encargados (no admins ni lectores) como opción a fichar
  const fichables = usuarios.filter(u =>
    u.rol === 'operario' || u.rol === 'encargado'
  );

  const sel = document.getElementById('fichaje-user-sel');
  if (!sel) return;

  const current = sel.value;
  sel.innerHTML = '<option value="">— Seleccionar operario —</option>';
  fichables.forEach(u => {
    const r = (typeof ROLES !== 'undefined') ? ROLES[u.rol] : null;
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = (r ? r.emoji + ' ' : '') + u.nombre;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;

  // También poblar el filtro del historial
  const histFilter = document.getElementById('fhist-user-filter');
  if (histFilter) {
    const prevHist = histFilter.value;
    histFilter.innerHTML = '<option value="">Todos los usuarios</option>';
    usuarios.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre;
      histFilter.appendChild(opt);
    });
    if (prevHist) histFilter.value = prevHist;
  }
}

// ══════════════════════════════════════════════════════════
// ESTADO DEL OPERARIO SELECCIONADO
// ══════════════════════════════════════════════════════════
async function onFichajeUserChange() {
  const sel = document.getElementById('fichaje-user-sel');
  const userId = sel ? parseInt(sel.value) : null;
  const dotEl = document.getElementById('fichaje-estado-dot');
  const txtEl = document.getElementById('fichaje-estado-text');
  const hoyWrap = document.getElementById('fichaje-hoy-wrap');

  if (!userId) {
    if (dotEl) { dotEl.className = 'estado-dot estado-unknown'; }
    if (txtEl) txtEl.textContent = 'Selecciona un operario para ver su estado';
    if (hoyWrap) hoyWrap.style.display = 'none';
    return;
  }

  const usuarios = await dbGetAll('usuarios');
  const usuario = usuarios.find(u => u.id === userId);
  const ultFichaje = await getUltimoFichaje(userId);
  const dentroAhora = ultFichaje && ultFichaje.tipo === 'entrada';

  if (dotEl) {
    dotEl.className = 'estado-dot ' + (dentroAhora ? 'estado-dentro' : 'estado-fuera');
  }
  if (txtEl) {
    if (dentroAhora) {
      const desde = new Date(ultFichaje.fecha);
      const diff = calcDuracion(ultFichaje.fecha, new Date().toISOString());
      txtEl.innerHTML = `<strong style="color:var(--success)">${usuario?.nombre || 'Operario'}</strong>
        está dentro desde las ${desde.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        <span style="color:var(--text3)">(${diff})</span>`;
    } else {
      const last = ultFichaje
        ? ` · Última salida: ${new Date(ultFichaje.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
        : '';
      txtEl.innerHTML = `<strong style="color:var(--text2)">${usuario?.nombre || 'Operario'}</strong>
        no está en el trabajo${last}`;
    }
  }

  // Fichajes de hoy para este operario
  await renderFichajesHoy(userId);
}

async function getUltimoFichaje(userId) {
  const todos = await dbGetAll('fichajes');
  const delUser = todos
    .filter(f => f.userId === userId)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return delUser[0] || null;
}

async function renderFichajesHoy(userId) {
  const hoyWrap = document.getElementById('fichaje-hoy-wrap');
  const hoyList = document.getElementById('fichaje-hoy-list');
  if (!hoyWrap || !hoyList) return;

  const todos = await dbGetAll('fichajes');
  const hoyStr = new Date().toISOString().substring(0, 10);
  const hoy = todos
    .filter(f => f.userId === userId && f.fecha.startsWith(hoyStr))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  if (!hoy.length) {
    hoyWrap.style.display = 'none';
    return;
  }

  hoyWrap.style.display = 'block';
  hoyList.innerHTML = hoy.map(f => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;
                background:var(--card);border:1px solid var(--border);
                border-radius:var(--rs);margin-bottom:6px;">
      <span style="font-size:18px;">${f.tipo === 'entrada' ? '↑' : '↓'}</span>
      <div style="flex:1;">
        <span class="${f.tipo === 'entrada' ? 'fichaje-badge-in' : 'fichaje-badge-out'}">
          ${f.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'}
        </span>
      </div>
      <span style="font-size:13px;color:var(--text2);">
        ${new Date(f.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      ${f.nota ? `<span style="font-size:10px;color:var(--text3);">${f.nota}</span>` : ''}
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════
// REGISTRAR FICHAJE
// ══════════════════════════════════════════════════════════
async function registrarFichaje(tipo) {
  const sel = document.getElementById('fichaje-user-sel');
  const userId = sel ? parseInt(sel.value) : null;

  if (!userId) {
    toast('Selecciona un operario primero', 'error');
    return;
  }

  const usuarios = await dbGetAll('usuarios');
  const usuario = usuarios.find(u => u.id === userId);
  if (!usuario) { toast('Operario no encontrado', 'error'); return; }

  // Verificar estado previo para avisar de duplicado
  const ultimo = await getUltimoFichaje(userId);
  if (ultimo && ultimo.tipo === tipo) {
    const tipoStr = tipo === 'entrada' ? 'entrada' : 'salida';
    // Mostrar aviso pero permitir continuar
    if (!confirm(`⚠️ ${usuario.nombre} ya registró una ${tipoStr} anteriormente hoy. ¿Registrar de nuevo?`)) {
      return;
    }
  }

  const now = new Date().toISOString();
  const fichaje = {
    userId,
    nombreUsuario: usuario.nombre,
    rolUsuario: usuario.rol,
    tipo,                          // 'entrada' | 'salida'
    fecha: now,
    fechaLocal: new Date().toLocaleString('es-ES'),
    creadoPor: currentUser?.nombre || '',
    dispositivo: navigator.userAgent.substring(0, 80),
    sinc: 0,
    nota: ''
  };

  await dbAdd('fichajes', fichaje);

  // Vibración
  if (navigator.vibrate) navigator.vibrate(tipo === 'entrada' ? [50, 30, 50] : [100]);

  // Mostrar toast grande
  showFichajeToast(tipo, usuario.nombre, now);

  // Actualizar estado y hoy
  await onFichajeUserChange();
  await renderPresentes();

  // Sincronizar con Supabase si está disponible
  if (typeof scheduleSyncSoon === 'function') scheduleSyncSoon();
}

// ── Toast de confirmación grande ──
function showFichajeToast(tipo, nombre, isoDate) {
  const overlay = document.getElementById('fichaje-toast-overlay');
  const inner   = document.getElementById('fichaje-toast-inner');
  const iconEl  = document.getElementById('fct-icon');
  const titleEl = document.getElementById('fct-title');
  const subEl   = document.getElementById('fct-sub');

  if (!overlay) return;

  const hora = new Date(isoDate).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  iconEl.textContent  = tipo === 'entrada' ? '✅' : '👋';
  titleEl.textContent = tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada';
  subEl.textContent   = nombre + ' · ' + hora;
  inner.className     = 'fichaje-confirm-inner' + (tipo === 'salida' ? ' out' : '');

  overlay.classList.remove('hidden');
  setTimeout(hideFichajeToast, 3000);
}

function hideFichajeToast() {
  const overlay = document.getElementById('fichaje-toast-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ══════════════════════════════════════════════════════════
// TAB PRESENTES
// ══════════════════════════════════════════════════════════
async function renderPresentes() {
  const fichajes = await dbGetAll('fichajes');
  const usuarios = await dbGetAll('usuarios');
  const hoyStr = new Date().toISOString().substring(0, 10);

  // Calcular quién está dentro: último fichaje de cada usuario
  const userMap = {};
  usuarios.forEach(u => userMap[u.id] = u);

  // Agrupar por usuario: último fichaje de cada uno
  const ultPorUser = {};
  fichajes
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .forEach(f => { ultPorUser[f.userId] = f; });

  const presentes = Object.values(ultPorUser).filter(f => f.tipo === 'entrada');
  const fichajesHoy = fichajes.filter(f => f.fecha.startsWith(hoyStr));

  // Semana actual
  const ahora = new Date();
  const lunesEsta = new Date(ahora);
  lunesEsta.setDate(ahora.getDate() - ((ahora.getDay() + 6) % 7));
  lunesEsta.setHours(0, 0, 0, 0);
  const fichajesSemana = fichajes.filter(f => new Date(f.fecha) >= lunesEsta);

  // Stats
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('fstat-presentes', presentes.length);
  setEl('fstat-hoy', fichajesHoy.length);
  setEl('fstat-semana', fichajesSemana.length);
  setEl('fstat-total', fichajes.length);

  // Lista de presentes
  const listaEl = document.getElementById('presentes-list');
  if (!listaEl) return;

  if (!presentes.length) {
    listaEl.innerHTML = `<p style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0;">
      Nadie fichado actualmente</p>`;
    return;
  }

  listaEl.innerHTML = presentes.map(f => {
    const u = userMap[f.userId] || { nombre: f.nombreUsuario || '?', rol: 'operario' };
    const r = (typeof ROLES !== 'undefined') ? ROLES[u.rol] || ROLES.operario : { color: '#4f8ef7', emoji: '👤' };
    const desde = new Date(f.fecha);
    const diff = calcDuracion(f.fecha, new Date().toISOString());
    return `
      <div class="presente-item">
        <div class="presente-avatar"
             style="background:${r.color}22;color:${r.color};">
          ${u.nombre.charAt(0).toUpperCase()}
        </div>
        <div class="presente-info">
          <h4>${u.nombre}</h4>
          <p>${r.emoji} ${r.label || u.rol} · desde las ${desde.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <div class="presente-time">${diff}</div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// TAB HISTORIAL
// ══════════════════════════════════════════════════════════
async function renderHistorial() {
  const fichajes = await dbGetAll('fichajes');
  const usuarios = await dbGetAll('usuarios');
  const userMap  = {};
  usuarios.forEach(u => userMap[u.id] = u);

  // Filtros
  const userFilt = parseInt(document.getElementById('fhist-user-filter')?.value) || null;
  const dateFilt = document.getElementById('fhist-date-filter')?.value || null;

  let filtrados = [...fichajes];
  if (userFilt) filtrados = filtrados.filter(f => f.userId === userFilt);
  if (dateFilt) filtrados = filtrados.filter(f => f.fecha.startsWith(dateFilt));
  filtrados.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  // Paginación
  const total = filtrados.length;
  const pages = Math.max(1, Math.ceil(total / FICHAJE.histPageSize));
  FICHAJE.histPage = Math.min(FICHAJE.histPage, pages - 1);
  const start = FICHAJE.histPage * FICHAJE.histPageSize;
  const page = filtrados.slice(start, start + FICHAJE.histPageSize);

  const infoEl = document.getElementById('fhist-page-info');
  if (infoEl) infoEl.textContent = `Pág. ${FICHAJE.histPage + 1} / ${pages} (${total} registros)`;

  // Desactivar botones de paginación si procede
  const btns = document.querySelectorAll('.paginacion button');
  if (btns[0]) btns[0].disabled = FICHAJE.histPage === 0;
  if (btns[1]) btns[1].disabled = FICHAJE.histPage >= pages - 1;

  // Calcular duración: buscar el fichaje de signo contrario más cercano
  const tbody = document.getElementById('fichajes-tbody');
  if (!tbody) return;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3);">
      Sin registros</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(f => {
    const u = userMap[f.userId] || { nombre: f.nombreUsuario || '?', rol: 'operario' };
    const r = (typeof ROLES !== 'undefined') ? ROLES[u.rol] || ROLES.operario : { color: '#4f8ef7', emoji: '👤' };
    const tipoHtml = f.tipo === 'entrada'
      ? '<span class="fichaje-badge-in">↑ ENTRADA</span>'
      : '<span class="fichaje-badge-out">↓ SALIDA</span>';
    const fecha = new Date(f.fecha);
    const fechaStr = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
                   + ' ' + fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Calcular duración si es salida
    let duracion = '—';
    if (f.tipo === 'salida') {
      const entradaPrevia = filtrados.find(x =>
        x.userId === f.userId && x.tipo === 'entrada' && new Date(x.fecha) < fecha
      );
      if (entradaPrevia) duracion = calcDuracion(entradaPrevia.fecha, f.fecha);
    }

    return `<tr>
      <td>
        <div class="fichaje-user-chip">
          <div class="mini-avatar" style="background:${r.color}22;color:${r.color};">
            ${u.nombre.charAt(0).toUpperCase()}
          </div>
          <span style="color:var(--text)">${u.nombre}</span>
        </div>
      </td>
      <td>${tipoHtml}</td>
      <td style="color:var(--text);white-space:nowrap;">${fechaStr}</td>
      <td><span class="fichaje-duration">${duracion}</span></td>
      <td style="font-size:11px;">${f.nota || '—'}</td>
    </tr>`;
  }).join('');
}

function fHistPage(delta) {
  FICHAJE.histPage = Math.max(0, FICHAJE.histPage + delta);
  renderHistorial();
}

// ══════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════
async function setFichajeTab(tab) {
  FICHAJE.currentTab = tab;
  ['fichar', 'presentes', 'historial'].forEach(t => {
    const btn = document.getElementById('ftab-' + t);
    const cnt = document.getElementById('ftab-content-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
    if (cnt) cnt.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'presentes') await renderPresentes();
  if (tab === 'historial') { FICHAJE.histPage = 0; await renderHistorial(); }
}

// ══════════════════════════════════════════════════════════
// EXPORTAR CSV
// ══════════════════════════════════════════════════════════
async function exportFichajesCSV() {
  const fichajes = await dbGetAll('fichajes');
  const usuarios = await dbGetAll('usuarios');
  const userMap  = {};
  usuarios.forEach(u => userMap[u.id] = u);

  fichajes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  let csv = 'ID,Usuario,Rol,Tipo,Fecha ISO,Fecha local,Registrado por,Nota\n';
  csv += fichajes.map(f => {
    const u = userMap[f.userId] || { nombre: f.nombreUsuario || '?', rol: '?' };
    return [
      f.id,
      `"${u.nombre}"`,
      u.rol,
      f.tipo,
      f.fecha,
      `"${f.fechaLocal || ''}"`,
      `"${f.creadoPor || ''}"`,
      `"${f.nota || ''}"`
    ].join(',');
  }).join('\n');

  downloadCSV(csv, 'fichajes_presencia.csv');
}

async function exportResumenCSV() {
  const fichajes = await dbGetAll('fichajes');
  const usuarios = await dbGetAll('usuarios');
  const userMap  = {};
  usuarios.forEach(u => userMap[u.id] = u);

  // Calcular jornadas (entrada + salida emparejadas por usuario y día)
  const jornadasPorDia = {};
  fichajes
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .forEach(f => {
      const dia  = f.fecha.substring(0, 10);
      const key  = `${f.userId}-${dia}`;
      if (!jornadasPorDia[key]) jornadasPorDia[key] = { userId: f.userId, dia, entradas: [], salidas: [] };
      if (f.tipo === 'entrada') jornadasPorDia[key].entradas.push(f.fecha);
      else jornadasPorDia[key].salidas.push(f.fecha);
    });

  let csv = 'Usuario,Rol,Fecha,1ª Entrada,Última Salida,Horas trabajadas\n';
  Object.values(jornadasPorDia).sort((a, b) => a.dia.localeCompare(b.dia)).forEach(j => {
    const u = userMap[j.userId] || { nombre: '?', rol: '?' };
    const primeraEntrada = j.entradas[0] || '';
    const ultimaSalida  = j.salidas[j.salidas.length - 1] || '';
    let horas = '—';
    if (primeraEntrada && ultimaSalida) {
      horas = calcDuracion(primeraEntrada, ultimaSalida);
    }
    csv += [
      `"${u.nombre}"`, u.rol, j.dia,
      primeraEntrada ? new Date(primeraEntrada).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—',
      ultimaSalida   ? new Date(ultimaSalida).toLocaleTimeString('es-ES',   { hour: '2-digit', minute: '2-digit' }) : '—',
      horas
    ].join(',') + '\n';
  });

  downloadCSV(csv, 'resumen_jornadas.csv');
}

function downloadCSV(csv, filename) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  if (typeof toast === 'function') toast('✓ CSV exportado', 'success');
}

// ══════════════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════════════

/**
 * Calcula la duración entre dos timestamps ISO y devuelve string legible.
 * Ej: "2h 35m" o "45m 10s"
 */
function calcDuracion(isoInicio, isoFin) {
  const diff = Math.max(0, new Date(isoFin) - new Date(isoInicio));
  const secs  = Math.floor(diff / 1000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const rMins = mins % 60;
  const rSecs = secs % 60;
  if (hours > 0)  return `${hours}h ${rMins}m`;
  if (mins  > 0)  return `${mins}m ${rSecs}s`;
  return `${secs}s`;
}

// ══════════════════════════════════════════════════════════
// SUPABASE — SYNC FICHAJES
// ══════════════════════════════════════════════════════════
/*
  Para sincronizar fichajes con Supabase, añadir en el SQL del setup:

    create table if not exists fichajes(
      id uuid primary key default gen_random_uuid(),
      local_id integer,
      user_id integer,
      nombre_usuario text,
      rol_usuario text,
      tipo text not null,
      fecha timestamptz not null,
      fecha_local text,
      creado_por text,
      dispositivo text,
      nota text,
      created_at timestamptz default now()
    );
    alter table fichajes enable row level security;
    create policy public_all on fichajes for all using(true) with check(true);
    alter publication supabase_realtime add table fichajes;

  Y en syncNow() del index.html, añadir el bloque:
    const fichs = await dbGetAll('fichajes');
    for(const f of fichs.filter(x=>!x.sinc)){
      const{error}=await SB.from('fichajes').upsert({
        local_id:f.id, user_id:f.userId, nombre_usuario:f.nombreUsuario,
        rol_usuario:f.rolUsuario, tipo:f.tipo, fecha:f.fecha,
        fecha_local:f.fechaLocal, creado_por:f.creadoPor,
        dispositivo:f.dispositivo, nota:f.nota||''
      },{onConflict:'local_id'});
      if(!error){f.sinc=1;await dbPut('fichajes',f);}
    }
*/
