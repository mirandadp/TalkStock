// ══════════════════════════════════════════════
// MÓDULO: UBICACIONES
// ══════════════════════════════════════════════

async function addUbicacion() {
    const n = document.getElementById('ubicNombre').value.trim();
    if (!n) {
        toast('Escribe el nombre', 'error');
        return;
    }
    const tipo = document.getElementById('ubicTipo').value;
    const dir = document.getElementById('ubicDireccion')?.value.trim() || '';
    const desc = document.getElementById('ubicDesc')?.value.trim() || '';
    await dbAdd('ubicaciones', {
        nombre: n,
        tipo,
        direccion: dir,
        descripcion: desc,
        creado: new Date().toISOString(),
        ...auditNuevo(),
        synced: 0
    });
    document.getElementById('ubicNombre').value = '';
    const de = document.getElementById('ubicDireccion');
    if (de)
        de.value = '';
    const dd = document.getElementById('ubicDesc');
    if (dd)
        dd.value = '';
    toast('✓ Ubicación añadida', 'success');
    renderAll();
    scheduleSyncSoon();
}

async function deleteUbicacion(id) {
    await dbDelete('ubicaciones', id);
    toast('Eliminada', 'success');
    renderAll();
}

async function editUbicacion(id) {
    const ubics = await dbGetAll('ubicaciones');
    const u = ubics.find(x => x.id === id);
    if (!u)
        return;
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
        Object.assign(u, auditMod());
        u.synced = 0;
        await dbPut('ubicaciones', u);
        closeModal('editModal');
        toast('✓ Ubicación actualizada', 'success');
        renderAll();
        scheduleSyncSoon();
    }
    ;
    document.getElementById('editModal').classList.add('open');
}
