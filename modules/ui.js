// ══════════════════════════════════════════════
// MÓDULO: UI - COMPONENTES COMUNES
// ══════════════════════════════════════════════

let toastTimer;

function toast(msg, type='') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout( () => el.className = '', 3000);
}

function showConfirmModal(title, body, onConfirm, confirmLabel='Confirmar') {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').innerHTML = body;
    document.getElementById('confirmBtn').textContent = confirmLabel;
    document.getElementById('confirmBtn').onclick = () => {
        closeModal('confirmModal');
        onConfirm();
    }
    ;
    document.getElementById('confirmModal').classList.add('open');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

function showScreen(name) {
    if (name === 'ped' && !hasPermiso('verPedidos')) {
        toast('Sin permiso', 'error');
        return;
    }
    if (name === 'admin' && !hasPermiso('gestionAdmin')) {
        toast('Solo administradores', 'error');
        return;
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
    const nb = document.getElementById('nav-' + name);
    if (nb)
        nb.classList.add('active');
    if (name === 'inv')
        renderInventory();
    else if (name === 'mov')
        renderMovements();
    else if (name === 'ped')
        renderPedidos();
    else if (name === 'admin') {
        renderAdmin();
        updateStats();
    } else if (name === 'qr') {/* QR screen rendered statically */
    } else if (name === 'fichaje')
        renderFichaje();
}

function updateNetStatus() {
    const el = document.getElementById('net-status');
    if (!el)
        return;
    if (navigator.onLine) {
        el.textContent = 'Online';
        el.className = 'status online';
        scheduleSyncSoon();
    } else {
        el.textContent = 'Offline';
        el.className = 'status offline';
    }
}

window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);
