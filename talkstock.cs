:root{--bg:#0f0f1a;--bg2:#1a1a2e;--bg3:#16213e;--card:#1e2140;--border:#2d3561;--accent:#4f8ef7;--accent2:#7c5cbf;--success:#2ecc71;--danger:#e74c3c;--warn:#f39c12;--gold:#f1c40f;--text:#e8eaf6;--text2:#9fa8da;--text3:#5c6bc0;--radius:12px;--rs:8px;}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
#app{display:flex;flex-direction:column;height:100%;}
/* LOGIN */
#login-screen{position:fixed;inset:0;background:var(--bg);z-index:500;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;overflow-y:auto;}
#login-screen.hidden{display:none;}
.login-logo{font-size:52px;margin-bottom:8px;}
.login-title{font-size:26px;font-weight:800;color:var(--accent);margin-bottom:4px;}
.login-sub{font-size:13px;color:var(--text2);margin-bottom:28px;}
.login-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:100%;max-width:360px;}
.login-card h2{font-size:16px;font-weight:700;margin-bottom:16px;}
.fg{margin-bottom:12px;}
.fg label{display:block;font-size:12px;color:var(--text2);margin-bottom:5px;font-weight:500;}
.fg input,.fg select{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:11px 14px;color:var(--text);font-size:14px;outline:none;}
.fg input:focus{border-color:var(--accent);}
.pin-display{display:flex;gap:8px;justify-content:center;margin:16px 0;}
.pin-dot{width:14px;height:14px;border-radius:50%;background:var(--border);transition:background .15s;}
.pin-dot.filled{background:var(--accent);}
.pin-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;}
.pin-key{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rs);padding:16px;font-size:20px;font-weight:700;color:var(--text);cursor:pointer;transition:all .1s;}
.pin-key:active{background:var(--accent);color:#fff;transform:scale(.95);}
.pin-key.del{font-size:14px;color:var(--text2);}
.role-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.role-admin{background:rgba(241,196,15,.15);color:var(--gold);}
.role-encargado{background:rgba(79,142,247,.15);color:var(--accent);}
.role-operario{background:rgba(46,204,113,.15);color:var(--success);}
/* TOPBAR */
#topbar{background:var(--bg2);border-bottom:1px solid var(--border);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
#topbar h1{font-size:16px;font-weight:700;color:var(--accent);}
.topbar-right{display:flex;align-items:center;gap:6px;}
.user-chip{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:4px 10px;cursor:pointer;}
.user-chip .avatar{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
.user-chip span{font-size:12px;font-weight:600;}
.status{font-size:10px;padding:3px 7px;border-radius:20px;font-weight:600;}
.online{background:rgba(46,204,113,.15);color:var(--success);}
.offline{background:rgba(231,76,60,.15);color:var(--danger);}
#content{flex:1;overflow-y:auto;overflow-x:hidden;}
#navbar{background:var(--bg2);border-top:1px solid var(--border);display:flex;flex-shrink:0;}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 2px;border:none;background:none;color:var(--text3);cursor:pointer;transition:color .2s;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;}
.nav-btn svg{width:20px;height:20px;}
.nav-btn.active{color:var(--accent);}
.screen{display:none;padding:16px;animation:fadeIn .2s;}
.screen.active{display:block;}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
/* VOZ */
#voice-screen{display:flex;flex-direction:column;align-items:center;padding:16px;}
.voice-hero{text-align:center;margin-bottom:20px;}
.voice-hero h2{font-size:20px;font-weight:700;margin-bottom:4px;}
.voice-hero p{font-size:12px;color:var(--text2);}
.mic-btn{width:100px;height:100px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;transition:all .2s;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 4px 24px rgba(79,142,247,.35);}
.mic-btn:active{transform:scale(.95);}
.mic-btn.recording{animation:pulse 1s infinite;background:linear-gradient(135deg,var(--danger),#c0392b);}
@keyframes pulse{0%,100%{box-shadow:0 4px 24px rgba(231,76,60,.4)}50%{box-shadow:0 4px 40px rgba(231,76,60,.8),0 0 0 10px rgba(231,76,60,.1)}}
.mic-btn svg{width:40px;height:40px;}
.voice-text{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;width:100%;min-height:60px;font-size:14px;color:var(--text);line-height:1.6;margin-bottom:12px;}
.voice-text.placeholder{color:var(--text3);font-style:italic;}
.result-card{background:var(--card);border-radius:var(--radius);padding:14px;width:100%;margin-bottom:12px;border-left:4px solid var(--accent);}
.result-card.entrada{border-left-color:var(--success);}
.result-card.salida{border-left-color:var(--danger);}
.result-card h3{font-size:11px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;}
.result-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px;}
.result-row:last-child{border-bottom:none;}
.result-row span:first-child{color:var(--text2);}
.result-row .val{font-weight:600;}
.tipo-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;}
.badge-entrada{background:rgba(46,204,113,.15);color:var(--success);}
.badge-salida{background:rgba(231,76,60,.15);color:var(--danger);}
.cmd-guide{background:var(--bg3);border-radius:var(--rs);padding:10px;width:100%;}
.cmd-guide h4{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
.cmd-example{font-size:12px;color:var(--text2);padding:2px 0;}
.cmd-example strong{color:var(--accent);}
/* BUTTONS */
.btn{padding:11px 18px;border-radius:var(--rs);border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;width:100%;margin-bottom:8px;}
.btn-primary{background:var(--accent);color:#fff;}
.btn-secondary{background:var(--card);color:var(--text);border:1px solid var(--border);}
.btn-danger{background:var(--danger);color:#fff;}
.btn-success{background:var(--success);color:#fff;}
.btn-warn{background:var(--warn);color:#000;}
.btn-edit{background:rgba(79,142,247,.12);color:var(--accent);border:1px solid rgba(79,142,247,.3);}
.btn:active{transform:scale(.98);}
.btn-row{display:flex;gap:8px;width:100%;}
.btn-row .btn{margin-bottom:0;}
.btn-icon{padding:6px 10px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;transition:all .15s;margin-left:4px;}
.btn-icon:active{transform:scale(.95);}
/* FORMS */
.section-title{font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;}
.section-title:first-child{margin-top:0;}
.form-group{margin-bottom:10px;}
.form-group label{display:block;font-size:12px;color:var(--text2);margin-bottom:4px;font-weight:500;}
.form-group input,.form-group select,.form-group textarea{width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;color:var(--text);font-size:13px;outline:none;font-family:inherit;}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--accent);}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.form-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
/* CARDS */
.item-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:13px;margin-bottom:9px;}
.item-card-row{display:flex;justify-content:space-between;align-items:flex-start;}
.item-info h3{font-size:14px;font-weight:600;margin-bottom:2px;}
.item-info .meta{font-size:11px;color:var(--text2);}
.item-info .audit{font-size:10px;color:var(--text3);margin-top:3px;}
.item-stock{text-align:right;flex-shrink:0;margin-left:10px;}
.item-stock .qty{font-size:20px;font-weight:700;color:var(--accent);}
.item-stock .unit{font-size:10px;color:var(--text3);}
.stock-low{color:var(--warn)!important;}
.stock-zero{color:var(--danger)!important;}
.price-tag{font-size:11px;color:var(--gold);font-weight:600;margin-top:2px;}
.card-actions{display:flex;gap:5px;margin-top:10px;border-top:1px solid var(--border);padding-top:8px;}
.card-actions .btn{margin-bottom:0;padding:7px 10px;font-size:11px;}
/* MOVIMIENTOS */
.mov-item{background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:11px 13px;margin-bottom:7px;display:flex;align-items:flex-start;gap:10px;}
.mov-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;margin-top:2px;}
.mov-in{background:rgba(46,204,113,.15);}
.mov-out{background:rgba(231,76,60,.15);}
.mov-info{flex:1;}
.mov-info h4{font-size:13px;font-weight:600;margin-bottom:2px;}
.mov-info p{font-size:11px;color:var(--text2);line-height:1.5;}
.mov-qty{font-weight:700;font-size:14px;flex-shrink:0;}
.mov-qty.in{color:var(--success);}
.mov-qty.out{color:var(--danger);}
/* PEDIDOS */
.pedido-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px;}
.pedido-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;}
.pedido-header h3{font-size:14px;font-weight:700;}
.pedido-status{font-size:10px;padding:3px 8px;border-radius:20px;font-weight:700;text-transform:uppercase;flex-shrink:0;margin-left:8px;}
.ps-pendiente{background:rgba(243,156,18,.15);color:var(--warn);}
.ps-aprobado{background:rgba(79,142,247,.15);color:var(--accent);}
.ps-recibido{background:rgba(46,204,113,.15);color:var(--success);}
.ps-cancelado{background:rgba(231,76,60,.15);color:var(--danger);}
.pedido-meta{font-size:11px;color:var(--text2);margin-bottom:8px;line-height:1.6;}
.pedido-items{border-top:1px solid var(--border);padding-top:8px;}
.pedido-item-row{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;}
.pedido-item-row span:first-child{color:var(--text2);}
.pedido-item-row span:last-child{font-weight:600;}
.pedido-total{display:flex;justify-content:space-between;font-size:13px;font-weight:700;border-top:1px solid var(--border);margin-top:6px;padding-top:6px;}
.pedido-total span:last-child{color:var(--gold);}
.pedido-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
.pedido-actions .btn{font-size:11px;padding:7px 10px;margin-bottom:0;flex:1;min-width:80px;}
/* USUARIOS */
.user-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:13px;margin-bottom:8px;}
.user-card-row{display:flex;align-items:center;gap:12px;}
.user-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0;}
.user-info{flex:1;}
.user-info h3{font-size:14px;font-weight:600;margin-bottom:3px;}
.user-info .audit{font-size:10px;color:var(--text3);margin-top:3px;}
/* UBICACIONES */
.ubic-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:13px;margin-bottom:8px;}
.ubic-card-row{display:flex;align-items:flex-start;gap:10px;}
.ubic-icon{width:36px;height:36px;border-radius:var(--rs);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;background:rgba(79,142,247,.1);}
.ubic-info{flex:1;}
.ubic-info h3{font-size:14px;font-weight:600;margin-bottom:2px;}
.ubic-info .desc{font-size:12px;color:var(--text2);margin-top:3px;line-height:1.5;}
.ubic-info .audit{font-size:10px;color:var(--text3);margin-top:4px;}
/* STATS */
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;}
.stat-card{background:var(--card);border-radius:var(--rs);padding:12px;border:1px solid var(--border);}
.stat-card .num{font-size:24px;font-weight:700;color:var(--accent);}
.stat-card .lbl{font-size:10px;color:var(--text2);margin-top:2px;}
/* SEARCH */
.search-bar{display:flex;gap:8px;margin-bottom:12px;}
.search-bar input{flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:9px 12px;color:var(--text);font-size:13px;outline:none;}
.search-bar input:focus{border-color:var(--accent);}
.search-bar select{background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:9px 10px;color:var(--text);font-size:12px;outline:none;}
/* TABS */
.tabs{display:flex;gap:3px;margin-bottom:12px;background:var(--bg3);border-radius:var(--rs);padding:3px;}
.tab{flex:1;padding:7px 3px;border:none;background:none;color:var(--text3);font-size:11px;font-weight:600;border-radius:6px;cursor:pointer;transition:all .15s;}
.tab.active{background:var(--card);color:var(--text);}
/* MODAL */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;align-items:flex-end;justify-content:center;}
.modal-overlay.open{display:flex;}
.modal{background:var(--bg2);border-radius:20px 20px 0 0;padding:20px 16px 36px;width:100%;max-height:90vh;overflow-y:auto;border-top:1px solid var(--border);}
.modal h2{font-size:16px;font-weight:700;margin-bottom:14px;}
.modal-close{float:right;background:none;border:none;color:var(--text2);font-size:22px;cursor:pointer;margin-top:-4px;}
/* TOAST */
#toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:9px 16px;font-size:12px;font-weight:600;z-index:400;opacity:0;transition:opacity .3s;pointer-events:none;min-width:180px;text-align:center;white-space:nowrap;}
#toast.show{opacity:1;}
#toast.success{border-color:var(--success);color:var(--success);}
#toast.error{border-color:var(--danger);color:var(--danger);}
/* MISC */
.empty{text-align:center;padding:36px 20px;color:var(--text3);}
.empty svg{width:44px;height:44px;margin-bottom:10px;opacity:.4;}
.empty p{font-size:13px;}
.sb-info{background:var(--bg3);border-radius:var(--radius);padding:12px;margin-bottom:12px;border-left:4px solid var(--accent);}
.sb-info p:first-child{font-size:13px;font-weight:700;color:var(--accent);margin-bottom:4px;}
.sb-info p{font-size:12px;color:var(--text2);line-height:1.6;}
.sb-ok{background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.3);border-radius:var(--rs);padding:11px;margin-bottom:10px;}
.sb-ok p:first-child{font-size:13px;font-weight:600;color:var(--success);margin-bottom:3px;}
.sb-ok p{font-size:11px;color:var(--text2);word-break:break-all;}
.setup-steps{background:var(--card);border-radius:var(--rs);padding:10px;margin-bottom:10px;font-size:12px;color:var(--text2);line-height:2;}
.perm-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px;}
.perm-row:last-child{border-bottom:none;}
.perm-row span:first-child{color:var(--text2);}
.lock-overlay{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 20px;text-align:center;}
.lock-overlay svg{opacity:.3;margin-bottom:12px;}
.lock-overlay p{font-size:14px;color:var(--text2);}
.divider{height:1px;background:var(--border);margin:14px 0;}