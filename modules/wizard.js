// ══════════════════════════════════════════════
// MÓDULO: ASISTENTE GUIADO POR VOZ
// ══════════════════════════════════════════════

// Estado del asistente
const WIZ = {
    tipo: null,
    steps: [],
    stepIdx: 0,
    data: {},
    mats: [],
    ubics: []
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
    setTimeout(() => wizListenStep(), 400);
    speak(WIZ.steps[0]?.label ? 'Di ' + WIZ.steps[0].label : '');
}

function wizRenderStep() {
    const step = WIZ.steps[WIZ.stepIdx];
    const isLast = WIZ.stepIdx >= WIZ.steps.length;

    const prog = document.getElementById('wiz-progress');
    prog.innerHTML = WIZ.steps.map((s, i) => `<div class="wiz-dot ${i < WIZ.stepIdx ? 'done' : i === WIZ.stepIdx ? 'active' : 'pending'}"></div>`).join('');

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

    document.getElementById('wiz-confirm-wrap').style.display = 'none';
    document.getElementById('wiz-suggestions').style.display = 'none';
    document.getElementById('wiz-suggestions').innerHTML = '';
    document.getElementById('wiz-manual-wrap').style.display = 'none';
    document.getElementById('wiz-manual-input').value = '';
    document.getElementById('wiz-voice-text').textContent = 'Pulsa el micrófono o habla…';
    document.getElementById('wiz-voice-text').classList.remove('wiz-voice-active');

    if (!step) {
        wizShowConfirm();
        return;
    }

    document.getElementById('wiz-step-num').textContent = WIZ.stepIdx + 1;
    document.getElementById('wiz-step-label').textContent = step.label;
    document.getElementById('wiz-step-hint').textContent = step.hint;

    document.getElementById('wiz-skip-btn').style.display = step.skippable ? '' : 'none';

    if (step.type === 'ubicacion' && WIZ.ubics.length) {
        showWizSuggestions(WIZ.ubics.map(u => ({ label: (u.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + u.nombre, value: u })), wizAcceptValue);
    } else if (step.type === 'material' && WIZ.mats.length <= 20) {
        showWizSuggestions(WIZ.mats.map(m => ({ label: m.nombre + ` (${m.cantidad || 0} ${m.unidad || 'ud'})`, value: m })), wizAcceptValue);
    }
}

function wizAcceptValue(value) {
    const step = WIZ.steps[WIZ.stepIdx];
    if (!step) return;
    WIZ.data[step.key] = value;
    WIZ.stepIdx++;

    if (navigator.vibrate) navigator.vibrate(40);

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

    setTimeout(() => startListening('micBtnStep', 'micBtnStepLabel'), 600);
}

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

    let mat = data.material;
    if (!mat) { toast('Falta el material', 'error'); return; }

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
        mat.cantidad = Math.max(0, (mat.cantidad || 0) - cantidad);
        mat.synced = 0;
        await dbPut('materiales', mat);
        await registerMovement(mat.id, 'salida', cantidad, ubicId, ubicDestId, 'Mover: ' + nota);
        await registerMovement(mat.id, 'entrada', cantidad, ubicDestId, null, 'Mover desde: ' + (WIZ.data.ubicacion?.nombre || ''));
        toast(`⇄ ${cantidad} ${mat.unidad || 'ud'} de ${mat.nombre} movidos`, 'success');
    } else {
        const sign = tipo === 'entrada' ? 1 : -1;
        mat.cantidad = Math.max(0, (mat.cantidad || 0) + sign * cantidad);
        mat.synced = 0;
        await dbPut('materiales', mat);
        await registerMovement(mat.id, tipo, cantidad, ubicId, null, nota);
        const icon = tipo === 'entrada' ? '↑' : '↓';
        toast(`${icon} ${cantidad} ${mat.unidad || 'ud'} ${tipo === 'entrada' ? 'registrados' : 'descargados'} — ${mat.nombre}`, 'success');
    }
    scheduleSyncSoon();
    renderInventory();
    wizReset();
    wizRenderStep();
}

async function wizDoSearch(mat) {
    if (!mat) { toast('No hay material', 'error'); return; }
    const allMats = await dbGetAll('materiales');
    const matches = allMats.filter(m => fuzzyMatch(m.nombre, mat.nombre)).sort((a, b) => fuzzyScore(b.nombre, mat.nombre) - fuzzyScore(a.nombre, mat.nombre)).slice(0, 5);
    const ubics = await dbGetAll('ubicaciones');
    const html = matches.map(m => {
        const ub = ubics.find(u => u.id === m.ubicacionId);
        const ubStr = ub ? (ub.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + ub.nombre : '—';
        const color = m.cantidad > (m.minimo || 0) ? 'var(--success)' : m.cantidad <= 0 ? 'var(--danger)' : 'var(--warn)';
        return `<div style="background:var(--card);border-radius:var(--rs);padding:10px;margin-bottom:8px;border-left:3px solid ${color};">
            <h4>${m.nombre}</h4>
            <div style="font-size:12px;color:var(--text2);margin:4px 0;">
                📊 ${m.cantidad || 0} ${m.unidad || 'ud'} ${m.minimo && m.cantidad <= m.minimo ? '⚠️ Bajo stock' : ''}
            </div>
            <div style="font-size:12px;color:var(--text3);">${ubStr}</div>
        </div>`;
    }).join('');
    document.getElementById('wiz-search-result').innerHTML = html || '<p style="color:var(--text3);">Sin resultados</p>';
    document.getElementById('wiz-search-result').style.display = 'block';
    toast('✓ Búsqueda completada', 'success');
    wizReset();
    wizRenderStep();
}

async function wizDoPedido(data) {
    const mat = data.material;
    const qty = data.cantidad;
    if (!mat || !qty) { toast('Falta material o cantidad', 'error'); return; }
    const now = new Date().toISOString();
    await dbAdd('pedidos', {
        proveedor: '', estado: 'pendiente', notas: data.nota || '',
        lineas: [{ materialId: mat.id, nombre: mat.nombre, cantidad: qty, precio: mat.precio || 0, subtotal: (qty * (mat.precio || 0)) }],
        total: qty * (mat.precio || 0), fecha: now, creadoPor: currentUser?.nombre || '', synced: 0
    });
    toast('🛒 Pedido creado', 'success');
    scheduleSyncSoon();
    wizReset();
    wizRenderStep();
}

async function wizProcessMaterial(t) {
    const q = norm(t);
    let found = WIZ.mats.filter(m => norm(m.nombre) === q || norm(m.nombre).includes(q) || fuzzyMatch(m.nombre, q));
    if (!found.length) found = WIZ.mats.filter(m => fuzzyMatch(m.nombre, q)).sort((a, b) => fuzzyScore(b.nombre, q) - fuzzyScore(a.nombre, q));
    if (found.length === 1) {
        wizAcceptValue(found[0]);
    } else if (found.length > 1) {
        showWizSuggestions(found.slice(0, 5).map(m => ({ label: m.nombre + ` (${m.cantidad || 0} ${m.unidad || 'ud'})`, value: m })), wizAcceptValue);
    } else {
        wizAcceptValue({ id: null, nombre: t.trim(), unidad: 'ud', cantidad: 0, precio: 0, _new: true });
    }
}

async function wizProcessUbicacion(t) {
    const q = norm(t);
    let found = WIZ.ubics.filter(u => norm(u.nombre) === q || norm(u.nombre).includes(q) || fuzzyMatch(u.nombre, q));
    if (!found.length) found = WIZ.ubics.filter(u => fuzzyMatch(u.nombre, q)).sort((a, b) => fuzzyScore(b.nombre, q) - fuzzyScore(a.nombre, q));
    if (found.length === 1) {
        wizAcceptValue(found[0]);
    } else if (found.length > 1) {
        showWizSuggestions(found.map(u => ({ label: (u.tipo === 'furgoneta' ? '🚐 ' : '🏭 ') + u.nombre, value: u })), wizAcceptValue);
    } else {
        updateWizVoiceText('Ubicación no encontrada — elige de la lista', false);
    }
}

async function wizProcessSpeech(text) {
    stopListening();
    const t = norm(text);

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

    const OK_KW = ['ok', 'vale', 'confirmar', 'confirma', 'ejecutar', 'ejecuta', 'listo', 'ya', 'acepto', 'correcto', 'si', 'sí'];
    if (OK_KW.some(k => t === k || t.startsWith(k + ' ') || t.endsWith(' ' + k))) {
        if (wizAllRequiredFilled()) { wizExecute(); return; }
        else { toast('Faltan campos obligatorios', 'error'); return; }
    }
    if (t === 'cancelar' || t === 'cancel' || t === 'salir' || t === 'no') { wizCancel(); return; }
    if ((t === 'saltar' || t === 'omitir' || t === 'ninguno' || t === 'sin nota' || t === 'nada') && WIZ.steps[WIZ.stepIdx]?.skippable) { wizSkipStep(); return; }

    const step = WIZ.steps[WIZ.stepIdx];
    if (!step) return;

    if (step.type === 'number') {
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
        wizAcceptValue(text.trim());
    }
}

function wizCancel() { 
    stopListening(); 
    wizReset(); 
    document.getElementById('wiz-active').style.display = 'none';
    document.getElementById('wiz-idle').style.display = 'block';
}

function wizReset() {
    WIZ.tipo = null;
    WIZ.steps = [];
    WIZ.stepIdx = 0;
    WIZ.data = {};
    document.getElementById('wiz-search-result').style.display = 'none';
}

function showWizSuggestions(items, onSelect) {
    const wrap = document.getElementById('wiz-suggestions');
    wrap.innerHTML = items.map((item, i) => `<div class="wiz-suggestion" onclick="wizAcceptValue(${JSON.stringify(item.value).replace(/"/g, '&quot;')});"><span>${item.label}</span></div>`).join('');
    wrap.style.display = 'block';
}
