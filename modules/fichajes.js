// ══════════════════════════════════════════════
// MÓDULO: GESTIÓN DE FICHAJES (ASISTENCIA)
// ══════════════════════════════════════════════

async function renderFichaje() {
    const role = currentUser?.rol;
    if (role === 'operario' || role === 'lector_presencia') {
        initOperarioView();
    } else {
        initAdminView();
    }
}

async function initOperarioView() {
    const container = document.getElementById('screen-fichaje');
    const lastF = await getUltFichaje(currentUser?.id);
    const isInside = lastF?.tipo === 'entrada' && !lastF?.salida;
    const btnText = isInside ? '🚪 SALIDA' : '🚪 ENTRADA';
    const btnClass = isInside ? 'btn-danger' : 'btn-success';

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 20px; max-width: 300px; margin: 40px auto; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;">
                ${isInside ? '🟢' : '🔴'}
            </div>
            <h2 style="margin: 0;">
                ${isInside ? 'Dentro del turno' : 'Fuera del turno'}
            </h2>
            <p style="color: var(--text2); font-size: 13px; margin: 0;">
                ${lastF ? 'Último: ' + formatDateTime(lastF.fecha) : 'Sin registros'}
            </p>
            <button class="${btnClass}" style="padding: 15px; font-size: 18px;" onclick="registrarFichaje()">
                ${btnText}
            </button>
            <button class="btn-outline" onclick="showFichajeHistorial()">
                📊 Mi historial
            </button>
        </div>
    `;
}

async function initAdminView() {
    const container = document.getElementById('screen-fichaje');
    const tabs = ['Ahora', 'Historial', 'Jornadas'];
    const tabsHtml = tabs.map((t, i) => `
        <button class="tab-btn ${i === 0 ? 'active' : ''}" onclick="setFichajeTab(${i})" style="flex: 1; padding: 10px; border: none; background: transparent; cursor: pointer; font-weight: ${i === 0 ? 'bold' : 'normal'}; border-bottom: 3px solid ${i === 0 ? 'var(--accent)' : 'transparent'};">
            ${t}
        </button>
    `).join('');

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden;">
            <div style="display: flex; gap: 5px; border-bottom: 1px solid var(--border); padding: 0; margin-bottom: 15px;">
                ${tabsHtml}
            </div>
            <div id="fich-tab-content" style="flex: 1; overflow-y: auto;">
                <!-- Se rellena dinámicamente -->
            </div>
            <div style="padding: 10px; border-top: 1px solid var(--border); text-align: center; gap: 8px; display: flex; justify-content: center;">
                <button class="btn-small" onclick="exportFichajesCSV()">📥 Exportar fichajes</button>
                <button class="btn-small" onclick="exportResumenCSV()">📊 Resumen</button>
            </div>
        </div>
    `;
    await setFichajeTab(0);
}

async function setFichajeTab(idx) {
    const tabNames = ['Ahora', 'Historial', 'Jornadas'];
    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        btn.style.borderBottomColor = i === idx ? 'var(--accent)' : 'transparent';
        btn.style.fontWeight = i === idx ? 'bold' : 'normal';
    });

    const content = document.getElementById('fich-tab-content');
    if (idx === 0) await renderAdminAhora(content);
    else if (idx === 1) await renderAdminHistorial(content);
    else if (idx === 2) await renderAdminJornadas(content);
}

async function renderAdminAhora(container) {
    const fichs = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const today = new Date().toDateString();
    const entradas = fichs.filter(f => f.tipo === 'entrada' && new Date(f.fecha).toDateString() === today);
    const salidas = fichs.filter(f => f.tipo === 'salida' && new Date(f.fecha).toDateString() === today);

    const inside = entradas.filter(e => !salidas.find(s => s.userId === e.userId && new Date(s.fecha) > new Date(e.fecha)));
    const outside = usuarios.filter(u => !inside.find(f => f.userId === u.id) && (u.rol === 'operario' || u.rol === 'lector_presencia'));

    let html = `<h3 style="margin-top: 0;">Dentro del turno (${inside.length})</h3>`;
    html += inside.map(f => `
        <div style="background: var(--card); padding: 10px; border-radius: var(--rs); margin-bottom: 8px; border-left: 3px solid var(--success);">
            <strong>${f.nombreUsuario || f.userId}</strong>
            <div style="font-size: 12px; color: var(--text2);">
                🕐 Desde ${formatDateTime(f.fecha)}
            </div>
        </div>
    `).join('');

    html += `<h3>Fuera del turno (${outside.length})</h3>`;
    html += outside.map(u => `
        <div style="background: var(--card); padding: 10px; border-radius: var(--rs); margin-bottom: 8px; border-left: 3px solid var(--danger);">
            <strong>${u.nombre}</strong>
            <div style="font-size: 12px; color: var(--text2);">
                Última salida: ${fichs.filter(f => f.userId === u.id && f.tipo === 'salida').sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0]?.fecha ? formatDateTime(fichs.filter(f => f.userId === u.id && f.tipo === 'salida').sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0].fecha) : 'N/A'}
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

async function renderAdminHistorial(container) {
    const fichs = await dbGetAll('fichajes');
    const sorted = fichs.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 50);

    const html = sorted.map(f => {
        const isEntrada = f.tipo === 'entrada';
        const icon = isEntrada ? '🟢' : '🔴';
        const color = isEntrada ? 'var(--success)' : 'var(--danger)';
        return `
            <div style="background: var(--card); padding: 10px; border-radius: var(--rs); margin-bottom: 8px; border-left: 3px solid ${color};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${f.nombreUsuario || 'Usuario'}</strong>
                        <div style="font-size: 12px; color: var(--text2);">
                            ${icon} ${isEntrada ? 'Entrada' : 'Salida'} — ${formatDateTime(f.fecha)}
                        </div>
                    </div>
                    <button class="btn-sm" onclick="deleteFichaje(${f.id})" style="font-size: 10px;">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html || '<p style="color: var(--text3);">Sin fichajes</p>';
}

async function renderAdminJornadas(container) {
    const fichs = await dbGetAll('fichajes');
    const usuarios = await dbGetAll('usuarios');
    const jornadas = {};

    for (const f of fichs.filter(x => x.tipo === 'entrada')) {
        const week = getWeekNumber(new Date(f.fecha));
        const key = `${f.userId}_${week}`;
        if (!jornadas[key]) {
            jornadas[key] = {
                userId: f.userId,
                nombre: f.nombreUsuario,
                week,
                fichas: [],
                totalMs: 0
            };
        }
        jornadas[key].fichas.push(f);
        const salida = fichs.find(s => s.userId === f.userId && s.tipo === 'salida' && new Date(s.fecha) > new Date(f.fecha));
        if (salida) {
            jornadas[key].totalMs += new Date(salida.fecha) - new Date(f.fecha);
        }
    }

    const html = Object.values(jornadas).map(j => {
        const dur = calcDur(null, null, j.totalMs);
        return `
            <div style="background: var(--card); padding: 10px; border-radius: var(--rs); margin-bottom: 8px;">
                <strong>${j.nombre}</strong>
                <div style="font-size: 12px; color: var(--text2);">
                    Semana ${j.week} — Total: ${dur}
                </div>
                <div style="font-size: 11px; color: var(--text3); margin-top: 5px;">
                    Fichajes: ${j.fichas.length}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html || '<p style="color: var(--text3);">Sin jornadas registradas</p>';
}

async function guardarFichaje(userId, tipo) {
    const now = new Date();
    const fichaje = {
        userId: userId,
        nombreUsuario: currentUser?.nombre || 'Usuario',
        rolUsuario: currentUser?.rol || '',
        tipo: tipo,
        fecha: now.toISOString(),
        fechaLocal: now.toLocaleString(),
        creadoPor: currentUser?.nombre || '',
        dispositivo: navigator.userAgent.substring(0, 100),
        nota: '',
        sinc: 0
    };
    const id = await dbAdd('fichajes', fichaje);
    toast(`✓ ${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada`, 'success');
    scheduleSyncSoon();
    return id;
}

async function registrarFichaje() {
    const lastF = await getUltFichaje(currentUser?.id);
    const isInside = lastF?.tipo === 'entrada' && !lastF?.salida;
    const tipo = isInside ? 'salida' : 'entrada';
    await guardarFichaje(currentUser?.id, tipo);
    await initOperarioView();
    await renderFichaje();
}

async function deleteFichaje(fichajeId) {
    showConfirmModal('Eliminar fichaje', '¿Estás seguro?', async () => {
        await dbDelete('fichajes', fichajeId);
        toast('Fichaje eliminado', 'success');
        renderFichaje();
    });
}

async function getUltFichaje(userId) {
    const fichs = await dbGetAll('fichajes');
    return fichs.filter(f => f.userId === userId).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
}

function calcDur(isoA, isoB, ms) {
    const totalMs = ms || (new Date(isoB) - new Date(isoA));
    const totals = Math.floor(totalMs / 1000);
    const h = Math.floor(totals / 3600);
    const m = Math.floor((totals % 3600) / 60);
    const s = totals % 60;
    return `${h}h ${m}m ${s}s`;
}

function getWeekNumber(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    const yearStart = new Date(date.getFullYear(), 0, 1);
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getDateOfWeek(week, year) {
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    return ISOweekStart;
}

async function handleQrFichaje(qrData) {
    const match = qrData.match(/fichaje:(\d+)/i);
    if (match) {
        const userId = parseInt(match[1]);
        const tipo = 'entrada';
        await guardarFichaje(userId, tipo);
    }
}

async function applyFichajeConfigUI() {
    const permitir = await getConfigValue('permitir_fichaje_manual');
    if (permitir === false) {
        const manualBtn = document.getElementById('btn-fichaje-manual');
        if (manualBtn) manualBtn.style.display = 'none';
    }
}

function showFichajeHistorial() {
    showConfirmModal('Historial de fichajes', '', () => { renderFichaje(); });
}

function exportFichajesCSV() {
    dbGetAll('fichajes').then(fichs => {
        const csv = [['Usuario', 'Rol', 'Tipo', 'Fecha', 'Dispositivo', 'Nota']];
        fichs.forEach(f => {
            csv.push([f.nombreUsuario || '', f.rolUsuario || '', f.tipo || '', f.fechaLocal || '', f.dispositivo || '', f.nota || '']);
        });
        const content = csv.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([content], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `fichajes_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    });
}

function exportResumenCSV() {
    dbGetAll('fichajes').then(fichs => {
        const jornadas = {};
        fichs.filter(x => x.tipo === 'entrada').forEach(f => {
            const week = getWeekNumber(new Date(f.fecha));
            const key = `${f.userId}_${week}`;
            if (!jornadas[key]) {
                jornadas[key] = { userId: f.userId, nombre: f.nombreUsuario, week, totalMs: 0, count: 0 };
            }
            const salida = fichs.find(s => s.userId === f.userId && s.tipo === 'salida' && new Date(s.fecha) > new Date(f.fecha));
            if (salida) jornadas[key].totalMs += new Date(salida.fecha) - new Date(f.fecha);
            jornadas[key].count++;
        });
        const csv = [['Usuario', 'Semana', 'Horas', 'Fichajes']];
        Object.values(jornadas).forEach(j => {
            const h = (j.totalMs / 3600000).toFixed(2);
            csv.push([j.nombre || '', j.week, h, j.count]);
        });
        const content = csv.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([content], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `resumen_fichajes_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    });
}

function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
