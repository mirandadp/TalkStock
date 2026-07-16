// ══════════════════════════════════════════════
// MÓDULO: MATERIALES
// ══════════════════════════════════════════════

async function addMaterial() {
    const n = document.getElementById('matNombre').value.trim();
    if (!n) {
        toast('Escribe el nombre', 'error');
        return;
    }
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unit = document.getElementById('matUnit').value.trim() || 'ud';
    const precio = parseFloat(document.getElementById('matPrecio').value) || 0;
    const ubicId = parseInt(document.getElementById('matUbic').value) || null;
    const min = parseInt(document.getElementById('matMin').value) || 0;
    const proveedor = document.getElementById('matProveedor').value.trim();
    const desc = document.getElementById('matDesc')?.value.trim() || '';
    const id = await dbAdd('materiales', {
        nombre: n,
        cantidad: qty,
        unidad: unit,
        precio,
        ubicacionId: ubicId,
        minimo: min,
        proveedor,
        descripcion: desc,
        creado: new Date().toISOString(),
        ...auditNuevo(),
        synced: 0
    });
    if (qty > 0)
        await registerMovement(id, 'entrada', qty, ubicId, null, 'Inventario inicial');
    document.getElementById('matNombre').value = '';
    document.getElementById('matQty').value = '0';
    document.getElementById('matUnit').value = '';
    document.getElementById('matPrecio').value = '0';
    document.getElementById('matMin').value = '0';
    document.getElementById('matProveedor').value = '';
    const de = document.getElementById('matDesc');
    if (de)
        de.value = '';
    toast('✓ Material añadido', 'success');
    renderAll();
    scheduleSyncSoon();
}

async function deleteMaterial(id) {
    showConfirmModal('Eliminar material', '<p style="font-size:13px;color:var(--text2);">¿Eliminar este material?</p>', async () => {
        await dbDelete('materiales', id);
        toast('Eliminado', 'success');
        renderAll();
    }
    );
}

async function editMaterial(id) {
    const mats = await dbGetAll('materiales');
    const m = mats.find(x => x.id === id);
    if (!m)
        return;
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
        Object.assign(m, auditMod());
        m.synced = 0;
        await dbPut('materiales', m);
        if (cantNueva !== cantAnterior) {
            const diff = cantNueva - cantAnterior;
            await registerMovement(m.id, diff > 0 ? 'entrada' : 'salida', Math.abs(diff), m.ubicacionId, null, 'Ajuste manual (edición)');
        }
        closeModal('editModal');
        toast('✓ Material actualizado', 'success');
        renderAll();
        scheduleSyncSoon();
    }
    ;
    document.getElementById('editModal').classList.add('open');
}
