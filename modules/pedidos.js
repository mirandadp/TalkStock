// ══════════════════════════════════════════════
// MÓDULO: GESTIÓN DE PEDIDOS
// ══════════════════════════════════════════════

let currentPedTab = 'pendiente';
let pedLines = [];
let editingPedidoId = null;

async function openNewPedido() {
    editingPedidoId = null;
    pedLines = [{
        materialId: null,
        nombre: '',
        cantidad: 1,
        precio: 0,
        subtotal: 0
    }];
    renderPedLines();
    document.getElementById('ped-proveedor').value = '';
    document.getElementById('ped-notas').value = '';
    const t = document.querySelector('#pedidoModal h2');
    if (t)
        t.textContent = 'Nuevo Pedido';
    const b = document.querySelector('#pedidoModal .btn-primary');
    if (b)
        b.textContent = '📋 Crear pedido';
    document.getElementById('pedidoModal').classList.add('open');
}

async function editPedido(id) {
    const peds = await dbGetAll('pedidos');
    const p = peds.find(x => x.id === id);
    if (!p)
        return;
    editingPedidoId = id;
    pedLines = (p.lineas || []).map(l => ({
        ...l
    }));
    document.getElementById('ped-proveedor').value = p.proveedor || '';
    document.getElementById('ped-notas').value = p.notas || '';
    const t = document.querySelector('#pedidoModal h2');
    if (t)
        t.textContent = 'Editar Pedido';
    const b = document.querySelector('#pedidoModal .btn-primary');
    if (b)
        b.textContent = '💾 Guardar cambios';
    renderPedLines();
    document.getElementById('pedidoModal').classList.add('open');
}

async function renderPedLines() {
    const mats = await dbGetAll('materiales');
    const canVerPrecios = hasPermiso('verPrecios');
    const el = document.getElementById('ped-lines');
    el.innerHTML = pedLines.map( (l, i) => `
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
    if (mat) {
        pedLines[i].materialId = mat.id;
        pedLines[i].nombre = mat.nombre;
        pedLines[i].precio = mat.precio || 0;
        pedLines[i].subtotal = pedLines[i].cantidad * (mat.precio || 0);
    }
    renderPedLines();
}
function pedLineQtyChange(i, qty) {
    pedLines[i].cantidad = parseFloat(qty) || 1;
    pedLines[i].subtotal = pedLines[i].cantidad * pedLines[i].precio;
    renderPedLines();
}
function pedLineRemove(i) {
    pedLines.splice(i, 1);
    renderPedLines();
}
function addPedLine() {
    pedLines.push({
        materialId: null,
        nombre: '',
        cantidad: 1,
        precio: 0,
        subtotal: 0
    });
    renderPedLines();
}
function updatePedTotal() {
    const t = pedLines.reduce( (s, l) => s + l.subtotal, 0);
    const el = document.getElementById('ped-total');
    if (el)
        el.textContent = t.toFixed(2) + ' €';
}

async function savePedido() {
    const prov = document.getElementById('ped-proveedor').value.trim();
    const notas = document.getElementById('ped-notas').value.trim();
    const validLines = pedLines.filter(l => l.materialId && l.cantidad > 0);
    if (!validLines.length) {
        toast('Añade al menos un material', 'error');
        return;
    }
    const total = validLines.reduce( (s, l) => s + l.subtotal, 0);
    if (editingPedidoId) {
        const peds = await dbGetAll('pedidos');
        const p = peds.find(x => x.id === editingPedidoId);
        if (p) {
            Object.assign(p, {
                proveedor: prov,
                notas,
                lineas: validLines,
                total,
                ...auditMod(),
                synced: 0
            });
            await dbPut('pedidos', p);
            toast('✓ Pedido actualizado', 'success');
        }
    } else {
        await dbAdd('pedidos', {
            proveedor: prov,
            estado: 'pendiente',
            notas,
            lineas: validLines,
            total,
            creadoPor: currentUser?.nombre || '',
            ...auditNuevo(),
            fecha: new Date().toISOString(),
            synced: 0
        });
        toast('✓ Pedido creado', 'success');
    }
    editingPedidoId = null;
    closeModal('pedidoModal');
    renderPedidos();
    scheduleSyncSoon();
}

function setPedTab(tab) {
    currentPedTab = tab;
    document.querySelectorAll('#screen-ped .tab').forEach( (t, i) => t.classList.toggle('active', ['pendiente', 'aprobado', 'recibido'][i] === tab));
    renderPedidos();
}

async function renderPedidos() {
    if (!hasPermiso('verPedidos')) {
        document.getElementById('lock-ped').style.display = 'flex';
        document.getElementById('ped-content').style.display = 'none';
        return;
    }
    document.getElementById('lock-ped').style.display = 'none';
    document.getElementById('ped-content').style.display = 'block';
    const peds = await dbGetAll('pedidos');
    const filtered = peds.filter(p => p.estado === currentPedTab).reverse();
    const canVerPrecios = hasPermiso('verPrecios');
    const canAprobar = hasPermiso('aprobarPedidos');
    const el = document.getElementById('pedidosList');
    if (!filtered.length) {
        el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>No hay pedidos ${currentPedTab === 'pendiente' ? 'pendientes' : currentPedTab === 'aprobado' ? 'aprobados' : 'recibidos'}</p></div>`;
        return;
    }
    const canEditar = hasPermiso('crearPedidos');
    el.innerHTML = filtered.map(p => {
        const statusCls = 'ps-' + p.estado;
        const statusLabel = p.estado === 'pendiente' ? '⏳ Pendiente' : p.estado === 'aprobado' ? '✓ Aprobado' : p.estado === 'recibido' ? '📦 Recibido' : '✕ Cancelado';
        const fd = new Date(p.fecha);
        const fs = fd.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
        const lineas = (p.lineas || []).map(l => `<div class="pedido-item-row"><span>${l.nombre || 'Material'} × ${l.cantidad}</span><span>${canVerPrecios ? l.subtotal?.toFixed(2) + ' €' : '—'}</span></div>`).join('');
        const audit = fmtAudit(p);
        const acciones = [];
        if (p.estado === 'pendiente' && canAprobar)
            acciones.push(`<button class="btn btn-primary" onclick="cambiarEstadoPedido(${p.id},'aprobado')">✓ Aprobar</button>`);
        if (p.estado === 'aprobado')
            acciones.push(`<button class="btn btn-success" onclick="cambiarEstadoPedido(${p.id},'recibido')">📦 Recibido</button>`);
        if ((p.estado === 'pendiente' || p.estado === 'aprobado') && canEditar)
            acciones.push(`<button class="btn btn-edit" onclick="editPedido(${p.id})">✏️ Editar</button>`);
        if ((p.estado === 'pendiente' || p.estado === 'aprobado') && canAprobar)
            acciones.push(`<button class="btn btn-secondary" onclick="cambiarEstadoPedido(${p.id},'cancelado')">✕</button>`);
        return `<div class="pedido-card">
      <div class="pedido-header"><div><h3>${p.proveedor || 'Sin proveedor'}</h3></div><span class="pedido-status ${statusCls}">${statusLabel}</span></div>
      <div class="pedido-meta">${fs}${p.notas ? ` · ${p.notas}` : ''}${audit ? `<br><span style="color:var(--text3);font-size:10px;">${audit}</span>` : ''}</div>
      <div class="pedido-items">${lineas}</div>
      ${canVerPrecios ? `<div class="pedido-total"><span>Total</span><span>${(p.total || 0).toFixed(2)} €</span></div>` : ''}
      ${acciones.length ? `<div class="pedido-actions">${acciones.join('')}</div>` : ''}
    </div>`;
    }
    ).join('');
}

async function cambiarEstadoPedido(id, nuevoEstado) {
    const peds = await dbGetAll('pedidos');
    const ped = peds.find(p => p.id === id);
    if (!ped)
        return;
    if (nuevoEstado === 'recibido' && ped.lineas?.length) {
        for (const l of ped.lineas) {
            if (!l.materialId)
                continue;
            const mats = await dbGetAll('materiales');
            const mat = mats.find(m => m.id === l.materialId);
            if (mat) {
                mat.cantidad = (mat.cantidad || 0) + l.cantidad;
                mat.synced = 0;
                await dbPut('materiales', mat);
                await registerMovement(mat.id, 'entrada', l.cantidad, mat.ubicacionId, null, 'Pedido recibido: ' + ped.proveedor);
            }
        }
        toast('📦 Stock actualizado automáticamente', 'success');
    }
    Object.assign(ped, {
        estado: nuevoEstado,
        ...auditMod(),
        synced: 0
    });
    await dbPut('pedidos', ped);
    renderPedidos();
    renderInventory();
    scheduleSyncSoon();
    toast(`✓ Pedido ${nuevoEstado}`, 'success');
}
