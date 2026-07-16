// ══════════════════════════════════════════════
// MÓDULO: AUTENTICACIÓN Y LOGIN
// ══════════════════════════════════════════════

let pinBuffer = '';

// ── Helpers de visibilidad de secciones del login ──
function loginShowSection(name) {
    const sections = ['login-checking', 'cloud-check-section', 'user-select-wrap', 'pin-section', 'first-setup'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el)
            el.style.display = (id === name) ? 'block' : 'none';
    }
    );
    const titleEl = document.getElementById('login-title-text');
    if (titleEl)
        titleEl.style.display = (name === 'user-select-wrap') ? 'block' : 'none';
    const notice = document.getElementById('cloud-empty-notice');
    if (notice && name !== 'first-setup')
        notice.style.display = 'none';
}

async function initLogin() {
    loginShowSection('login-checking');

    let usuarios = await dbGetAll('usuarios');

    if (usuarios.length) {
        const {url, key} = getSBConfig();
        if (url && key && initSupabase() && navigator.onLine) {
            try {
                await pullRemoteData();
                usuarios = await dbGetAll('usuarios');
            } catch (e) {}
        }
        showLoginUserSelect(usuarios);
        return;
    }

    const {url, key} = getSBConfig();
    if (url && key) {
        if (initSupabase()) {
            if (navigator.onLine) {
                try {
                    await pullRemoteData();
                } catch (e) {}
            }
            usuarios = await dbGetAll('usuarios');
            if (usuarios.length) {
                showLoginUserSelect(usuarios);
                return;
            }
            loginShowSection('first-setup');
            const notice = document.getElementById('cloud-empty-notice');
            if (notice)
                notice.style.display = 'block';
            return;
        }
    }

    loginShowSection('cloud-check-section');
}

function showLoginUserSelect(usuarios) {
    const sel = document.getElementById('login-user-sel');
    sel.innerHTML = '<option value="">— Seleccionar —</option>';
    usuarios.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.nombre + ' (' + (ROLES[u.rol]?.emoji || '') + ')';
        sel.appendChild(opt);
    }
    );
    loginShowSection('user-select-wrap');
    const saved = localStorage.getItem('sv_session');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            const u = usuarios.find(x => x.id === s.id);
            if (u) {
                doLogin(u);
                return;
            }
        } catch (e) {}
    }
}

async function connectCloudAndCheck() {
    const url = document.getElementById('login-cloud-url').value.trim();
    const key = document.getElementById('login-cloud-key').value.trim();
    if (!url || !key) {
        toast('Rellena URL y API Key', 'error');
        return;
    }
    if (!url.startsWith('https://')) {
        toast('La URL debe empezar con https://', 'error');
        return;
    }
    if (!navigator.onLine) {
        toast('Sin conexión a internet', 'error');
        return;
    }

    const btn = document.getElementById('cloud-connect-btn');
    const origText = btn.textContent;
    btn.textContent = 'Conectando…';
    btn.disabled = true;

    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    SB = null;

    try {
        if (!initSupabase()) {
            throw new Error('No se pudo inicializar la conexión');
        }
        await pullRemoteData();
        const usuarios = await dbGetAll('usuarios');
        if (usuarios.length) {
            toast('✓ Conectado — usuarios encontrados', 'success');
            showLoginUserSelect(usuarios);
        } else {
            toast('☁️ Conectado, pero sin usuarios en la nube', '');
            loginShowSection('first-setup');
            const notice = document.getElementById('cloud-empty-notice');
            if (notice)
                notice.style.display = 'block';
        }
    } catch (e) {
        toast('Error al conectar: ' + (e.message || e), 'error');
        localStorage.removeItem('sb_url');
        localStorage.removeItem('sb_key');
        SB = null;
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

function skipCloudCheck() {
    loginShowSection('first-setup');
}

function showCloudCheckAgain() {
    const {url, key} = getSBConfig();
    const urlInput = document.getElementById('login-cloud-url');
    const keyInput = document.getElementById('login-cloud-key');
    if (urlInput)
        urlInput.value = url || '';
    if (keyInput)
        keyInput.value = key || '';
    loginShowSection('cloud-check-section');
}

async function createFirstAdmin() {
    const n = document.getElementById('setup-nombre').value.trim();
    const p = document.getElementById('setup-pin').value.trim();
    if (!n) {
        toast('Escribe tu nombre', 'error');
        return;
    }
    if (!/^\d{4}$/.test(p)) {
        toast('El PIN debe ser 4 dígitos', 'error');
        return;
    }
    const now = new Date().toISOString();
    const id = await dbAdd('usuarios', {
        nombre: n,
        rol: 'admin',
        pin: p,
        creado: now,
        creadoPor: n,
        modificadoPor: n,
        modificadoEn: now,
        synced: 0
    });
    toast('✓ Administrador creado. Accede ahora.', 'success');
    if (SB && navigator.onLine) {
        try {
            await syncNow();
        } catch (e) {}
    }
    const usuarios = await dbGetAll('usuarios');
    showLoginUserSelect(usuarios);
}

function onUserSelect() {
    const id = parseInt(document.getElementById('login-user-sel').value);
    if (!id) {
        document.getElementById('pin-section').style.display = 'none';
        return;
    }
    document.getElementById('pin-section').style.display = 'block';
    document.getElementById('user-select-wrap').style.display = 'none';
    document.getElementById('login-title-text').textContent = 'Introduce tu PIN';
    pinBuffer = '';
    renderPinDots();
    dbGetAll('usuarios').then(us => {
        const u = us.find(x => x.id === id);
        if (u) {
            const r = ROLES[u.rol];
            document.getElementById('login-role-badge').innerHTML = `<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
        }
    }
    );
}

function backToUserSelect() {
    document.getElementById('pin-section').style.display = 'none';
    document.getElementById('user-select-wrap').style.display = 'block';
    document.getElementById('login-title-text').textContent = 'Selecciona usuario';
    document.getElementById('login-user-sel').value = '';
    pinBuffer = '';
}

function pinPress(d) {
    if (pinBuffer.length >= 4)
        return;
    pinBuffer += d;
    renderPinDots();
    if (pinBuffer.length === 4)
        setTimeout(checkPin, 200);
}

function pinDel() {
    if (pinBuffer.length > 0) {
        pinBuffer = pinBuffer.slice(0, -1);
        renderPinDots();
    }
}

function renderPinDots() {
    for (let i = 0; i < 4; i++)
        document.getElementById('pd' + i).className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '');
}

async function checkPin() {
    const id = parseInt(document.getElementById('login-user-sel').value);
    const usuarios = await dbGetAll('usuarios');
    const u = usuarios.find(x => x.id === id);
    if (u && u.pin === pinBuffer) {
        doLogin(u);
    } else {
        toast('PIN incorrecto', 'error');
        pinBuffer = '';
        renderPinDots();
    }
}

function doLogin(u) {
    currentUser = u;
    localStorage.setItem('sv_session', JSON.stringify({
        id: u.id
    }));
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    updateTopbarUser();
    applyRoleUI();
    if (currentUser.rol === 'lector_presencia') {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app').style.display = 'flex';
        if (initSupabase()) {
            startRealtime();
            scheduleSyncSoon();
        }
        updateNetStatus();
        showScreen('fichaje');
        return;
    }
    renderAll();
    if (initSupabase()) {
        startRealtime();
        scheduleSyncSoon();
    }
    updateNetStatus();
}

function doLogout() {
    closeModal('userMenuModal');
    if (typeof stopConfigPolling === 'function')
        stopConfigPolling();
    if (typeof stopRealtime === 'function')
        stopRealtime();
    currentUser = null;
    localStorage.removeItem('sv_session');
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').classList.remove('hidden');
    pinBuffer = '';
    renderPinDots();
    backToUserSelect();
    initLogin();
}

function updateTopbarUser() {
    if (!currentUser)
        return;
    const r = ROLES[currentUser.rol];
    document.getElementById('topbar-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
    document.getElementById('topbar-avatar').style.background = r.color + '33';
    document.getElementById('topbar-avatar').style.color = r.color;
    document.getElementById('topbar-name').textContent = currentUser.nombre;
}

function applyRoleUI() {
    if (!currentUser)
        return;
    const rol = currentUser.rol;
    const navbar = document.getElementById('navbar');
    if (rol === 'lector_presencia') {
        if (navbar)
            navbar.style.display = 'none';
        return;
    }
    if (navbar)
        navbar.style.display = '';
    document.getElementById('nav-ped').style.display = CAN.verPedidos(rol) ? '' : 'none';
    document.getElementById('nav-admin').style.display = CAN.gestionAdmin(rol) ? '' : 'none';
    const opPedir = document.getElementById('op-pedir');
    if (opPedir)
        opPedir.style.display = CAN.crearPedidos(rol) ? '' : 'none';
    const nbF = document.getElementById('nav-fichaje');
    if (nbF)
        nbF.style.display = CAN.verFichajes(rol) ? '' : 'none';
}

function showUserMenu() {
    if (!currentUser)
        return;
    const r = ROLES[currentUser.rol];
    document.getElementById('um-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
    document.getElementById('um-avatar').style.background = r.color + '33';
    document.getElementById('um-avatar').style.color = r.color;
    document.getElementById('um-name').textContent = currentUser.nombre;
    document.getElementById('um-role').innerHTML = `<span class="role-badge ${r.cls}">${r.emoji} ${r.label}</span>`;
    document.getElementById('userMenuModal').classList.add('open');
}

function showChangePinModal() {
    closeModal('userMenuModal');
    showConfirmModal('Cambiar PIN', `<div class="form-group"><label>PIN actual</label><input type="password" id="pin-old" maxlength="4" inputmode="numeric" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);width:100%;"></div>
     <div class="form-group"><label>Nuevo PIN</label><input type="password" id="pin-new" maxlength="4" inputmode="numeric" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;color:var(--text);width:100%;"></div>`, async () => {
        const old = document.getElementById('pin-old').value;
        const nw = document.getElementById('pin-new').value;
        if (old !== currentUser.pin) {
            toast('PIN actual incorrecto', 'error');
            return;
        }
        if (!/^\d{4}$/.test(nw)) {
            toast('El PIN debe ser 4 dígitos', 'error');
            return;
        }
        currentUser.pin = nw;
        currentUser.synced = 0;
        await dbPut('usuarios', currentUser);
        toast('✓ PIN actualizado', 'success');
        scheduleSyncSoon();
    }
    , 'Guardar');
}
