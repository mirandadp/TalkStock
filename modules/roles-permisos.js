// ══════════════════════════════════════════════
// MÓDULO: ROLES Y PERMISOS
// ══════════════════════════════════════════════

const ROLES = {
    admin: {
        label: 'Administrador',
        color: '#f1c40f',
        cls: 'role-admin',
        emoji: '👑'
    },
    encargado: {
        label: 'Encargado',
        color: '#4f8ef7',
        cls: 'role-encargado',
        emoji: '🔑'
    },
    operario: {
        label: 'Operario',
        color: '#2ecc71',
        cls: 'role-operario',
        emoji: '👷'
    },
    lector_presencia: {
        label: 'Lector Presencia',
        color: '#9b59b6',
        cls: 'role-lector',
        emoji: '📋'
    }
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

let currentUser = null;
// { id, nombre, rol, pin }

function getCurrentUser() {
    return currentUser;
}
function hasPermiso(perm) {
    return currentUser && CAN[perm]?.(currentUser.rol);
}

// ── Auditoría: quién creó / modificó cada registro ──
function auditNuevo() {
    const u = currentUser?.nombre || 'sistema';
    const now = new Date().toISOString();
    return {
        creadoPor: u,
        modificadoPor: u,
        modificadoEn: now
    };
}

function auditMod() {
    return {
        modificadoPor: currentUser?.nombre || '',
        modificadoEn: new Date().toISOString()
    };
}

function fmtAudit(r) {
    const parts = [];
    if (r.creadoPor)
        parts.push('Creado por ' + r.creadoPor);
    if (r.modificadoPor && r.modificadoPor !== r.creadoPor)
        parts.push('· Editado por ' + r.modificadoPor);
    if (r.modificadoEn)
        parts.push('· ' + new Date(r.modificadoEn).toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }));
    return parts.join(' ');
}

function esc(s) {
    return (s || '').toString().replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
