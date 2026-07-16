// ══════════════════════════════════════════════
// MÓDULO: MOVIMIENTOS DE STOCK
// ══════════════════════════════════════════════

async function registerMovement(matId, tipo, cantidad, ubicId, destUbicId, nota) {
    await dbAdd('movimientos', {
        materialId: matId,
        tipo,
        cantidad,
        ubicacionId: ubicId || null,
        ubicacionDestinoId: destUbicId || null,
        fecha: new Date().toISOString(),
        nota: nota || '',
        synced: 0,
        usuario: currentUser?.nombre || ''
    });
    updateSyncBadge();
}

function setMovTab(tab) {
    currentMovTab = tab;
    document.querySelectorAll('#screen-mov .tab').forEach( (t, i) => t.classList.toggle('active', ['all', 'entrada', 'salida'][i] === tab));
    renderMovements();
}

let currentMovTab = 'all';

async function renderMovements() {
    const [movs,mats,ubics] = await Promise.all([dbGetAll('movimientos'), dbGetAll('materiales'), dbGetAll('ubicaciones')]);
    const matMap = {}
      , ubicMap = {};
    mats.forEach(m => matMap[m.id] = m);
    ubics.forEach(u => ubicMap[u.id] = u);
    let f = [...movs].reverse();
    if (currentMovTab !== 'all')
        f = f.filter(m => m.tipo === currentMovTab);
    const el = document.getElementById('movementsList');
    if (!el)
        return;
    if (!f.length) {
        el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg><p>Sin movimientos</p></div>`;
        return;
    }
    el.innerHTML = f.slice(0, 100).map(mv => {
        const mat = matMap[mv.materialId]
          , ub = ubicMap[mv.ubicacionId]
          , isIn = mv.tipo === 'entrada';
        const fd = new Date(mv.fecha);
        const fs = fd.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        }) + ' ' + fd.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });
        return `<div class="mov-item"><div class="mov-icon ${isIn ? 'mov-in' : 'mov-out'}">${isIn ? '↑' : '↓'}</div><div class="mov-info"><h4>${mat ? mat.nombre : '—'}</h4><p>${ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre + ' · ' : ''} ${fs}${mv.usuario ? ' · ' + mv.usuario : ''}${!mv.synced ? ' · ⏳' : ' · ☁️'}</p></div><div class="mov-qty ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${mv.cantidad}</div></div>`;
    }
    ).join('');
}
