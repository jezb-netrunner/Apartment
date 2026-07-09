// ─────────────────────────────────────────────
// PAYMENT LOG MANAGEMENT (F-08)
// ─────────────────────────────────────────────
function openAddPayment(bi) {
  // Close any other open add-payment forms
  document.querySelectorAll('[id^="add-payment-form-"]').forEach(el=>{ el.style.display='none'; el.innerHTML=''; });
  const formEl = document.getElementById('add-payment-form-'+bi);
  if(!formEl) return;
  formEl.style.display = 'block';
  formEl.innerHTML = `<div class="payment-add-form">
    <div class="form-grid">
      <div class="field"><label>Amount Received (&#8369;)</label><input type="text" id="pf-amount-${bi}" placeholder="0" inputmode="decimal" pattern="[0-9.]*" autocomplete="off"></div>
      <div class="field"><label>Date</label><input type="date" id="pf-date-${bi}" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field full"><label>Note <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" id="pf-note-${bi}" placeholder="e.g. GCash ref #1234567"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn-cancel" style="flex:1;padding:8px;" onclick="document.getElementById('add-payment-form-${bi}').style.display='none'">Cancel</button>
      <button class="btn-save" style="flex:2;padding:8px;" onclick="savePaymentEntry(${bi})">Save Payment</button>
    </div>
  </div>`;
}

async function savePaymentEntry(bi) {
  const amt  = normalizeAmount(document.getElementById('pf-amount-'+bi).value);
  const date = document.getElementById('pf-date-'+bi).value;
  const note = document.getElementById('pf-note-'+bi).value.trim();
  if(!amt||amt<=0){ showToast('Please enter a valid amount.',false); return; }
  if(!date){ showToast('Please select a date.',false); return; }
  const ok = await saveBills(editingId, bills=>{
    if(!bills[bi]) return;
    if(!bills[bi].payments) bills[bi].payments = [];
    bills[bi].payments.push({amount:amt, date, note});
  }, 'Payment recorded.');
  if(ok){ renderBillListItems(); rerenderAdmin(); }
}

async function deletePaymentEntry(bi, pi) {
  if(!confirm('Remove this payment entry?')) return;
  const ok = await saveBills(editingId, bills=>{
    if(bills[bi] && bills[bi].payments) bills[bi].payments.splice(pi,1);
  }, 'Payment entry removed.');
  if(ok){ renderBillListItems(); rerenderAdmin(); }
}


// ─────────────────────────────────────────────
// STATEMENT MODAL
// ─────────────────────────────────────────────
let _stmtTenant = null; // tenant object for statement

function openStmtModalById(tid) {
  const t = tenants.find(t=>t.id===tid);
  if(t) openStmtModal(t);
}
function openStmtModal(tenantObj) {
  _stmtTenant = tenantObj || currentUser;
  const now = new Date();
  const curYM = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  // Default: last 3 months
  const from = new Date(now.getFullYear(), now.getMonth()-2, 1);
  const fromYM = from.getFullYear()+'-'+String(from.getMonth()+1).padStart(2,'0');
  document.getElementById('stmt-from').value = fromYM;
  document.getElementById('stmt-to').value   = curYM;
  document.getElementById('stmt-title').textContent = 'Statement — '+_stmtTenant.name;
  document.getElementById('stmt-sub').textContent = 'Unit '+_stmtTenant.unit+' · Select date range to print or save as PDF.';
  openModal('stmt-modal');
}

function closeStmtModal() {
  closeModalEl('stmt-modal');
  _stmtTenant = null;
}

function printStatement(fullHistory) {
  const t = _stmtTenant;
  if(!t) return;
  const fromYM = document.getElementById('stmt-from').value;
  const toYM   = document.getElementById('stmt-to').value;

  let bills = t.bills.slice().sort((a,b)=>(b.due||'').localeCompare(a.due||''));
  let rangeLabel = 'All time';
  if(!fullHistory && fromYM && toYM) {
    bills = bills.filter(b => {
      const ym = (b.due||b.paidDate||'').slice(0,7);
      return ym >= fromYM && ym <= toYM;
    });
    const fmtM = ym => new Date(ym+'-02').toLocaleString('default',{month:'long',year:'numeric'});
    rangeLabel = fmtM(fromYM)+' – '+fmtM(toYM);
  }

  // True outstanding balance is over ALL bills, not just the date-ranged subset.
  const totalDueAllTime = t.bills.filter(b=>b.status!=='paid').reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  const totalDueInRange = bills.filter(b=>b.status!=='paid').reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  const isRanged = !fullHistory && fromYM && toYM;
  // Use unified due-status so "Upcoming"/"Due Soon"/"Overdue" appear consistently with the dashboard.
  const dueStatusLabels = { paid:'Paid', overdue:'Overdue', 'due-today':'Due Today', 'due-soon':'Due Soon', upcoming:'Upcoming', 'no-date':'Unscheduled' };
  const dueStatusColors = { paid:'#27ae60', overdue:'#c0392b', 'due-today':'#c0392b', 'due-soon':'#e67e22', upcoming:'#666', 'no-date':'#666' };
  const rows = bills.map(b=>{
    const ds = getDueStatus(b);
    return '<tr><td>'+esc(b.label)+'</td><td>'+(b.due?formatDate(b.due):'-')+'</td>'+
      '<td style="text-align:right;">&#8369;'+Number(b.amount).toLocaleString()+'</td>'+
      '<td style="color:'+(dueStatusColors[ds]||'#666')+'">'+(dueStatusLabels[ds]||ds)+'</td>'+
      '<td>'+(b.paidDate?formatDate(b.paidDate):'-')+'</td>'+
      '<td>'+esc(b.remark||'')+'</td></tr>';
  }).join('');

  const css = 'body{font-family:Arial,sans-serif;padding:32px;color:#111;max-width:800px;margin:0 auto}h1{font-size:22px;margin-bottom:4px}.sub{color:#666;font-size:13px;margin-bottom:24px}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#666}td{padding:8px 10px;border-bottom:1px solid #e8e8ed}.total{text-align:right;margin-top:16px;font-size:16px;font-weight:700}@media print{body{padding:0}}';
  const html = '<!DOCTYPE html><html><head><title>Statement - '+esc(t.name)+'</title><style>'+css+'</style></head><body>'+
    '<h1>'+esc(t.name)+'</h1>'+
    '<div class="sub">Unit '+esc(t.unit)+' &nbsp;&middot;&nbsp; '+rangeLabel+' &nbsp;&middot;&nbsp; Generated '+new Date().toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'})+'</div>'+
    '<table><thead><tr><th>Bill</th><th>Due Date</th><th>Amount</th><th>Status</th><th>Paid Date</th><th>Remarks</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    (isRanged && totalDueInRange !== totalDueAllTime
      ? '<div class="total">Balance for this period: &#8369;'+totalDueInRange.toLocaleString()+'</div>'+
        '<div class="total" style="font-size:13px;color:#666;font-weight:500;">Total balance outstanding (all time): &#8369;'+totalDueAllTime.toLocaleString()+'</div>'
      : '<div class="total">Balance Outstanding: &#8369;'+totalDueAllTime.toLocaleString()+'</div>')+
    '</body></html>';

  try {
    const win = window.open('','_blank');
    if(!win) throw new Error('blocked');
    win.document.write(html);
    win.document.close();
    // Use setTimeout as fallback since onload may not fire for document.write
    setTimeout(() => { try { win.print(); } catch(e){} }, 400);
  } catch(e) {
    // Pop-up blocked — use hidden iframe instead
    let iframe = document.getElementById('print-frame');
    if(!iframe){
      iframe = document.createElement('iframe');
      iframe.id = 'print-frame';
      iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;border:none;';
      document.body.appendChild(iframe);
    }
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => { try { iframe.contentWindow.print(); } catch(e){} }, 400);
    showToast('Pop-up blocked — printing via fallback method.');
  }
  closeStmtModal();
}


function expandAdminPaid(tid) {
  const t = tenants.find(t=>t.id===tid);
  if(!t) return;
  const paidBills = t.bills.filter(b=>b.status==='paid').sort((a,b)=>(b.paidDate||'').localeCompare(a.paidDate||''));
  const listEl = document.getElementById('paid-list-'+tid);
  if(!listEl) return;
  listEl.innerHTML = paidBills.map(b=>{ const bi=t.bills.indexOf(b); return `
    <div class="admin-paid-item">
      <span class="admin-paid-label">${esc(b.label)}</span>
      <span class="admin-paid-amount">&#8369;${Number(b.amount).toLocaleString()}</span>
      ${b.paidDate?`<span class="admin-paid-date">Paid ${formatDate(b.paidDate)}</span>`:''}
      <button class="admin-paid-revert" onclick="revertToPending('${t.id}',${bi})">Undo</button>
    </div>`; }).join('');
}


// ── SUPABASE CONFIG ──
const SB_URL = 'https://bxzfqjspoyvwosmpgeof.supabase.co';
const SB_KEY = 'sb_publishable_FgSrHN3LoB9XQ4ZQHCeoQQ_AXg54YkP';
const _sbClient = supabase.createClient(SB_URL, SB_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

async function _getAuthHeaders() {
  const { data: { session } } = await _sbClient.auth.getSession();
  const token = session ? session.access_token : SB_KEY;
  return { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

async function sbFetch(path, options={}) {
  const headers = await _getAuthHeaders();
  if(options.headers_extra) { Object.assign(headers, options.headers_extra); delete options.headers_extra; }
  const res = await fetch(SB_URL + '/rest/v1/' + path, { headers, ...options });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
async function dbGetAll()       { return await sbFetch('tenants?select=*&order=name&archived_at=is.null'); }
async function dbInsert(t)      { return await sbFetch('tenants', { method:'POST', body: JSON.stringify(t) }); }
async function dbUpdate(id, t)  { return await sbFetch('tenants?id=eq.' + id, { method:'PATCH', body: JSON.stringify(t) }); }
async function dbDelete(id)     { return await sbFetch('tenants?id=eq.' + id, { method:'DELETE' }); }

let paymentInstructions = ''; // loaded from Supabase settings table

async function dbGetSetting(key) {
  try {
    const rows = await sbFetch('settings?key=eq.'+encodeURIComponent(key)+'&select=value');
    return (rows && rows[0]) ? rows[0].value : '';
  } catch { return ''; }
}
async function dbSetSetting(key, value) {
  await sbFetch('settings', {
    method: 'POST',
    body: JSON.stringify({key, value}),
    headers_extra: { 'Prefer': 'resolution=merge-duplicates,return=representation' }
  });
}
let currentUser = null;
let tenants = [];
let editingId = null;
let filterTenantId = '';   // '' = all
let filterMonth    = '';   // '' = all, else 'YYYY-MM'
let filterStatuses = [];   // [] = show all; else subset of ['overdue','due-soon','due-today','upcoming','paid']
let filterSearch   = '';   // free-text search on tenant name / unit / code
let sortOrder      = 'unit-asc'; // key of SORT_LABELS
let viewMode       = 'card';     // 'card' | 'table'
let tableSortCol   = 'due';      // column to sort table by
let tableSortDir   = 'asc';      // 'asc' | 'desc'
let portalMonth    = 'current'; // 'all' | 'YYYY-MM' | 'current'
let billForms = [];
let _openPaid = new Set();  // tenant ids whose "Paid" section is expanded

const SORT_LABELS = {
  'unit-asc':     'Unit &#8593;',
  'unit-desc':    'Unit &#8595;',
  'name-asc':     'Name A&ndash;Z',
  'balance-desc': 'Balance high &rarr; low',
  'balance-asc':  'Balance low &rarr; high',
  'urgency':      'Most urgent first'
};

function setLoading(on, msg='Loading…') {
  let el = document.getElementById('loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(249,249,250,0.85);backdrop-filter:blur(4px);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
    el.innerHTML = '<div class="spinner"></div><div style="font-family:Inter,sans-serif;font-size:13px;color:var(--muted);font-weight:500;" id="loading-msg"></div>';
    document.body.appendChild(el);
    const style = document.createElement('style');
    style.textContent = '.spinner{width:28px;height:28px;border:2.5px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin 0.7s linear infinite;}';
    document.head.appendChild(style);
  }
  el.style.display = on ? 'flex' : 'none';
  if (on) document.getElementById('loading-msg').textContent = msg;
}

// Open a modal by id and focus its first focusable input/textarea/select.
// Restores focus to the previously-focused element on close via openModal.return().
function openModal(id) {
  const el = document.getElementById(id);
  if(!el) return;
  const previouslyFocused = document.activeElement;
  el.classList.add('open');
  // Defer focus to the next frame so layout is settled.
  requestAnimationFrame(() => {
    const target = el.querySelector('input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])');
    if(target) target.focus();
  });
  el._restoreFocus = previouslyFocused;
}
function closeModalEl(id) {
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.remove('open');
  if(el._restoreFocus && typeof el._restoreFocus.focus === 'function') {
    try { el._restoreFocus.focus(); } catch {}
    el._restoreFocus = null;
  }
}

function showToast(msg, ok=true) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(12px);padding:10px 20px;border-radius:8px;font-family:Inter,sans-serif;font-size:13px;font-weight:500;z-index:9999;opacity:0;transition:all 0.3s;pointer-events:none;max-width:90vw;white-space:normal;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = ok ? 'var(--navy)' : 'var(--rust)';
  el.style.color = 'white';
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(-50%) translateY(12px)'; }, 2500);
}

function switchTab(tab) {
  document.querySelectorAll('.login-tab').forEach((t,i) => t.classList.toggle('active', (tab==='admin'&&i===0)||(tab==='tenant'&&i===1)));
  document.getElementById('admin-form').style.display  = tab==='admin'  ? 'block' : 'none';
  document.getElementById('tenant-form').style.display = tab==='tenant' ? 'block' : 'none';
  document.getElementById('login-error').textContent = '';
}
async function adminLogin() {
  const email    = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-pw').value;
  if(!email||!password){ document.getElementById('login-error').textContent='Please enter your email and password.'; return; }
  setLoading(true, 'Signing in…');
  const { data, error } = await _sbClient.auth.signInWithPassword({ email, password });
  setLoading(false);
  if(error){ document.getElementById('login-error').textContent = 'Incorrect email or password.'; return; }
  currentUser = 'admin';
  showApp();
}
async function sendPasswordReset() {
  const email = document.getElementById('admin-email').value.trim();
  if(!email) { document.getElementById('login-error').textContent = 'Please enter your email first.'; return; }
  setLoading(true, 'Sending reset link…');
  const { error } = await _sbClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  setLoading(false);
  if(error) { document.getElementById('login-error').textContent = error.message; return; }
  document.getElementById('login-error').style.color = 'var(--green)';
  document.getElementById('login-error').textContent = 'Password reset link sent. Check your email.';
  setTimeout(()=>{ document.getElementById('login-error').style.color = ''; }, 5000);
}
const _loginAttempts = { count: 0, lockedUntil: 0 };
async function tenantLogin() {
  const now = Date.now();
  if(_loginAttempts.lockedUntil > now) {
    const secs = Math.ceil((_loginAttempts.lockedUntil - now) / 1000);
    document.getElementById('login-error').textContent = 'Too many attempts. Wait ' + secs + ' seconds.';
    return;
  }
  const code = document.getElementById('tenant-code').value.trim().toUpperCase();
  document.getElementById('login-error').textContent = '';
  if(!code){ document.getElementById('login-error').textContent = 'Please enter your access code.'; return; }
  setLoading(true,'Verifying code…');
  try {
    const rows = await sbFetch('rpc/login_tenant', { method:'POST', body: JSON.stringify({ access_code: code }) });
    setLoading(false);
    if(rows && rows.length) { _loginAttempts.count = 0; currentUser=rows[0]; tenants=rows; showApp(); }
    else {
      // Count only FAILED attempts; lock after the 5th failure. (The server
      // enforces the real rate limit — this just gives fast local feedback.)
      _loginAttempts.count++;
      if(_loginAttempts.count >= 5) {
        _loginAttempts.lockedUntil = now + 60000;
        _loginAttempts.count = 0;
        document.getElementById('login-error').textContent = 'Too many failed attempts. Please wait 1 minute.';
        return;
      }
      document.getElementById('login-error').textContent = 'That access code was not found.';
    }
  } catch(e) {
    setLoading(false);
    const msg = (e.message && e.message.includes('Too many')) ? 'Too many attempts. Please wait and try again.' : 'Connection error. Please try again.';
    document.getElementById('login-error').textContent = msg;
  }
}

// Overdue is DERIVED from the due date at render time (see getDueStatus), so the
// stored status only distinguishes 'paid' vs everything else. Legacy rows that
// still say 'overdue' are treated exactly like 'unpaid'; no sync writes needed.

async function showApp() {
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  if (currentUser==='admin') {
    document.getElementById('header-info').textContent='Admin';
    setLoading(true,'Loading tenants…');
    try {
      tenants = await dbGetAll() || [];
      paymentInstructions = await dbGetSetting('payment_instructions');
    } catch(e) {
      setLoading(false);
      document.getElementById('main-content').innerHTML = '<div style="padding:48px 24px;text-align:center;"><div style="font-size:32px;margin-bottom:16px;">⚠</div><div style="font-family:Inter,sans-serif;font-size:16px;font-weight:600;color:var(--ink);margin-bottom:8px;">Could not connect to database</div><div style="font-size:13px;color:var(--muted);margin-bottom:24px;">'+esc(e.message)+'</div><button class="btn-primary" style="width:auto;padding:10px 24px;" onclick="location.reload()">Retry</button></div>';
      tenants=[];
      return;
    }
    setLoading(false); renderAdmin();
  } else {
    document.getElementById('header-info').textContent=`Unit ${currentUser.unit}`;
    try {
      const val = await sbFetch('rpc/read_setting', { method:'POST', body: JSON.stringify({ setting_key: 'payment_instructions' }) });
      paymentInstructions = (typeof val === 'string') ? val : '';
    } catch(e) { paymentInstructions = ''; }
    renderTenant();
  }
}
async function logout() {
  if(currentUser==='admin') await _sbClient.auth.signOut();
  // Reset every piece of session state so a subsequent login starts clean.
  currentUser = null;
  tenants = [];
  editingId = null;
  paymentInstructions = '';
  filterTenantId = '';
  filterMonth    = '';
  filterStatuses = [];
  filterSearch   = '';
  _openPaid      = new Set();
  sortOrder      = 'unit-asc';
  viewMode       = 'card';
  tableSortCol   = 'due';
  tableSortDir   = 'asc';
  tableRowLimit  = 50;
  portalMonth    = 'current';
  billForms      = [];
  _showAllMonths = false;
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app').style.display='none';
  document.getElementById('admin-email').value='';
  document.getElementById('admin-pw').value='';
  document.getElementById('tenant-code').value='';
  document.getElementById('login-error').textContent='';
  document.getElementById('main-content').innerHTML='';
}

function renderActionRequired() {
  const today = new Date(); today.setHours(0,0,0,0);
  const in3 = new Date(today); in3.setDate(in3.getDate()+3);
  const items = [];
  tenants.forEach(t => {
    t.bills.forEach((b,bi) => {
      if(b.status==='paid') return;
      const _ds = getDueStatus(b);
      if(_ds==='overdue')   { items.push({type:'overdue',   tenant:t, bill:b, bi, label:'Overdue'}); }
      else if(_ds==='due-today') { items.push({type:'due-soon', tenant:t, bill:b, bi, label:'Due Today'}); }
      else if(_ds==='due-soon')  { items.push({type:'due-soon', tenant:t, bill:b, bi, label:'Due Soon'}); }
    });
  });
  if(!items.length) return '';
  items.sort((a,b)=>{
    if(a.type==='overdue'&&b.type!=='overdue') return -1;
    if(b.type==='overdue'&&a.type!=='overdue') return 1;
    return (a.bill.due||'')<(b.bill.due||'')?-1:1;
  });
  const rows = items.map(it=>{
    const late = daysOverdue(it.bill);
    return `
    <div class="action-item">
      <span class="action-badge ${it.type}">${it.label}</span>
      <div class="action-info">
        <div class="action-bill-name">${esc(it.bill.label)}</div>
        <div class="action-tenant">${esc(it.tenant.name)} &nbsp;·&nbsp; Unit ${esc(it.tenant.unit)}${it.bill.due?' &nbsp;·&nbsp; Due '+formatDate(it.bill.due):''}${late>0?' &nbsp;·&nbsp; <span style="color:var(--rust);font-weight:600;">'+late+' day'+(late>1?'s':'')+' late</span>':''}</div>
      </div>
      <span class="action-amount">&#8369;${Math.max(0,billRemaining(it.bill)).toLocaleString()}</span>
      <button class="btn-action-remind" onclick="copyReminder('${it.tenant.id}')" title="Copy a payment reminder for ${esc(it.tenant.name)} (all their unpaid bills)" aria-label="Copy payment reminder">&#9993;</button>
      <button class="btn-action-pay" onclick="quickMarkPaid('${it.tenant.id}',${it.bi})">Mark Paid</button>
    </div>`;}).join('');
  return `<div class="action-required">
    <div class="action-header">
      <div class="action-header-left"><div class="action-dot"></div><div class="action-title">Action Required</div></div>
      <div class="action-count">${items.length} bill${items.length>1?'s':''}</div>
    </div>
    <div class="action-items">${rows}</div>
  </div>`;
}

// ─────────────────────────────────────────────
// INSIGHTS PANEL (admin only)
let _insightsOpen = true;
function toggleInsights() {
  _insightsOpen = !_insightsOpen;
  rerenderAdmin();
}
// Three small SVG charts:
//  1. 6-month line: ₱ billed vs ₱ collected per month
//  2. Status donut: count of bills by current due-status
//  3. Top tenants bar: outstanding balance per tenant (top 6)
// ─────────────────────────────────────────────
function _ymKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function _ymLabel(ym) {
  // ym is "YYYY-MM"; use day 02 to avoid TZ-edge surprises
  return new Date(ym+'-02').toLocaleString('default',{month:'short'});
}
function _last6Months() {
  const out = [];
  const now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    out.push(_ymKey(d));
  }
  return out;
}
// "Collected in month M" = payment-log entries dated in M, plus — for bills
// marked paid in M — whatever part of the amount is NOT covered by logged
// payments (the remainder settled at mark-paid time). This also covers legacy
// bills with no payment log at all (remainder = full amount).
function _collectedInMonth(ym) {
  let total = 0;
  tenants.forEach(t => (t.bills||[]).forEach(b => {
    const payments = b.payments || [];
    payments.forEach(p => { if(p.date && String(p.date).startsWith(ym)) total += Number(p.amount)||0; });
    if(b.status==='paid' && b.paidDate && String(b.paidDate).startsWith(ym)){
      const logged = payments.reduce((s,p)=>s+(Number(p.amount)||0),0);
      const residual = (Number(b.amount)||0) - logged;
      if(residual > 0) total += residual;
    }
  }));
  return total;
}
function _billedInMonth(ym) {
  let total = 0;
  tenants.forEach(t => (t.bills||[]).forEach(b => {
    if(b.due && b.due.startsWith(ym)) total += Number(b.amount)||0;
  }));
  return total;
}

function renderInsights() {
  // No tenants → don't render the panel at all.
  if(!tenants.length) return '';

  // ── 1. 6-month line chart ──
  const months = _last6Months();
  const billed = months.map(_billedInMonth);
  const collected = months.map(_collectedInMonth);
  const lineMax = Math.max(1, ...billed, ...collected);
  const W = 560, H = 160, PL = 36, PR = 12, PT = 16, PB = 28;
  const innerW = W - PL - PR;
  const innerH = H - PT - PB;
  const xAt = i => PL + (months.length===1 ? innerW/2 : (i*innerW)/(months.length-1));
  const yAt = v => PT + innerH - (v/lineMax)*innerH;
  const billedPath    = billed.map((v,i)=>(i?'L':'M')+xAt(i).toFixed(1)+','+yAt(v).toFixed(1)).join(' ');
  const collectedPath = collected.map((v,i)=>(i?'L':'M')+xAt(i).toFixed(1)+','+yAt(v).toFixed(1)).join(' ');
  // Y-axis grid lines (4 ticks)
  const gridLines = [0, 0.33, 0.66, 1].map(f => {
    const y = (PT + innerH - f*innerH).toFixed(1);
    const v = Math.round(lineMax * f);
    const lbl = v >= 1000 ? (v/1000).toFixed(v>=10000?0:1)+'k' : v;
    return '<line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" class="cg-grid"/>'
         + '<text x="'+(PL-6)+'" y="'+y+'" class="cg-axis cg-axis-y">'+lbl+'</text>';
  }).join('');
  const xLabels = months.map((ym,i) =>
    '<text x="'+xAt(i).toFixed(1)+'" y="'+(H-8)+'" class="cg-axis cg-axis-x">'+_ymLabel(ym)+'</text>'
  ).join('');
  const dots = months.map((ym,i) => {
    const bV = billed[i], cV = collected[i];
    return '<circle cx="'+xAt(i).toFixed(1)+'" cy="'+yAt(bV).toFixed(1)+'" r="3" class="cg-dot cg-dot-billed"><title>Billed '+_ymLabel(ym)+': ₱'+bV.toLocaleString()+'</title></circle>'
         + '<circle cx="'+xAt(i).toFixed(1)+'" cy="'+yAt(cV).toFixed(1)+'" r="3" class="cg-dot cg-dot-collected"><title>Collected '+_ymLabel(ym)+': ₱'+cV.toLocaleString()+'</title></circle>';
  }).join('');
  const lineSvg = '<svg viewBox="0 0 '+W+' '+H+'" class="cg-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Bills billed vs collected over the last 6 months">'
    + gridLines
    + '<path d="'+billedPath+'" class="cg-line cg-line-billed"/>'
    + '<path d="'+collectedPath+'" class="cg-line cg-line-collected"/>'
    + dots + xLabels
    + '</svg>';

  // ── 2. Status donut ──
  // Snapshot of the current workload: all ACTIVE bills by urgency, plus bills
  // paid this month (so progress is visible without drowning in years of
  // historical paid bills).
  const curYM = _currentYM();
  const statusCounts = { overdue:0, 'due-today':0, 'due-soon':0, upcoming:0, 'no-date':0 };
  let paidThisMonth = 0;
  tenants.forEach(t => (t.bills||[]).forEach(b => {
    const ds = getDueStatus(b);
    if(ds === 'paid'){
      if(b.paidDate && String(b.paidDate).startsWith(curYM)) paidThisMonth++;
      return;
    }
    if(statusCounts[ds] !== undefined) statusCounts[ds]++;
  }));
  // Combine due-today into overdue colour group for visual clarity (both red).
  const donutSlices = [
    { key:'overdue',  label:'Overdue',   value: statusCounts.overdue + statusCounts['due-today'], color:'#c0392b' },
    { key:'due-soon', label:'Due Soon',  value: statusCounts['due-soon'], color:'#e67e22' },
    { key:'upcoming', label:'Upcoming',  value: statusCounts.upcoming + statusCounts['no-date'], color:'#5b88e6' },
    { key:'paid',     label:'Paid this month', value: paidThisMonth, color:'#1e8449' }
  ];
  const donutTotal = donutSlices.reduce((s,x)=>s+x.value, 0);
  const DW = 180, DH = 180, DCx = 90, DCy = 90, Rout = 70, Rin = 44;
  let donutSvg;
  if(donutTotal === 0){
    donutSvg = '<svg viewBox="0 0 '+DW+' '+DH+'" class="cg-svg cg-donut-svg" role="img" aria-label="No bills">'
      + '<circle cx="'+DCx+'" cy="'+DCy+'" r="'+Rout+'" class="cg-donut-empty"/>'
      + '<text x="'+DCx+'" y="'+DCy+'" class="cg-donut-empty-text">No bills</text>'
      + '</svg>';
  } else {
    let cumAngle = -Math.PI/2; // start at 12 o'clock
    const arcs = donutSlices.filter(s=>s.value>0).map(s => {
      const frac = s.value / donutTotal;
      const a0 = cumAngle, a1 = cumAngle + frac*2*Math.PI;
      cumAngle = a1;
      // Edge case: a single 100% slice can't be drawn as an arc; render two halves.
      if(frac >= 0.999){
        return '<circle cx="'+DCx+'" cy="'+DCy+'" r="'+((Rout+Rin)/2)+'" fill="none" stroke="'+s.color+'" stroke-width="'+(Rout-Rin)+'"><title>'+s.label+': '+s.value+'</title></circle>';
      }
      const x0 = DCx + Rout*Math.cos(a0), y0 = DCy + Rout*Math.sin(a0);
      const x1 = DCx + Rout*Math.cos(a1), y1 = DCy + Rout*Math.sin(a1);
      const x2 = DCx + Rin*Math.cos(a1),  y2 = DCy + Rin*Math.sin(a1);
      const x3 = DCx + Rin*Math.cos(a0),  y3 = DCy + Rin*Math.sin(a0);
      const large = frac > 0.5 ? 1 : 0;
      const d = 'M'+x0.toFixed(2)+','+y0.toFixed(2)
              + ' A'+Rout+','+Rout+' 0 '+large+' 1 '+x1.toFixed(2)+','+y1.toFixed(2)
              + ' L'+x2.toFixed(2)+','+y2.toFixed(2)
              + ' A'+Rin+','+Rin+' 0 '+large+' 0 '+x3.toFixed(2)+','+y3.toFixed(2)
              + ' Z';
      return '<path d="'+d+'" fill="'+s.color+'"><title>'+s.label+': '+s.value+'</title></path>';
    }).join('');
    donutSvg = '<svg viewBox="0 0 '+DW+' '+DH+'" class="cg-svg cg-donut-svg" role="img" aria-label="Bill status distribution">'
      + arcs
      + '<text x="'+DCx+'" y="'+(DCy-4)+'" class="cg-donut-num">'+donutTotal+'</text>'
      + '<text x="'+DCx+'" y="'+(DCy+12)+'" class="cg-donut-lbl">bills</text>'
      + '</svg>';
  }
  const donutLegend = '<div class="cg-legend">'
    + donutSlices.map(s => '<span class="cg-legend-item"><span class="cg-legend-dot" style="background:'+s.color+'"></span>'+s.label+' <span class="cg-legend-val">'+s.value+'</span></span>').join('')
    + '</div>';

  // ── 3. Top tenants by outstanding balance ──
  const tenantBalances = tenants.map(t => ({
    name: t.name,
    unit: t.unit,
    id: t.id,
    balance: (t.bills||[]).filter(b=>b.status!=='paid').reduce((s,b)=>s+Math.max(0,billRemaining(b)),0)
  })).filter(x => x.balance > 0).sort((a,b)=>b.balance-a.balance).slice(0,6);
  let barSvg;
  if(!tenantBalances.length){
    barSvg = '<div class="cg-bar-empty">All tenants are settled.</div>';
  } else {
    const barMax = tenantBalances[0].balance || 1;
    barSvg = '<div class="cg-bars">'
      + tenantBalances.map(x => {
          const pct = (x.balance / barMax * 100).toFixed(1);
          return '<div class="cg-bar-row" onclick="filterTenantId=\''+esc(x.id)+'\';applyFilters()" title="Filter to '+esc(x.name)+'">'
               + '<div class="cg-bar-name">'+esc(x.name)+' <span class="cg-bar-unit">· Unit '+esc(x.unit)+'</span></div>'
               + '<div class="cg-bar-track"><div class="cg-bar-fill" style="width:'+pct+'%"></div></div>'
               + '<div class="cg-bar-val">&#8369;'+x.balance.toLocaleString()+'</div>'
               + '</div>';
        }).join('')
      + '</div>';
  }

  // ── 4. Overdue aging buckets ──
  // How long has overdue money been sitting? Buckets by days past due.
  const agingBuckets = [
    { label: '1–30 days',  min: 1,  max: 30,  count: 0, amt: 0 },
    { label: '31–60 days', min: 31, max: 60,  count: 0, amt: 0 },
    { label: '60+ days',   min: 61, max: 1e9, count: 0, amt: 0 }
  ];
  tenants.forEach(t => (t.bills||[]).forEach(b => {
    if(b.status==='paid') return;
    const d = daysOverdue(b);
    if(d < 1) return;
    const bk = agingBuckets.find(x => d >= x.min && d <= x.max);
    if(bk){ bk.count++; bk.amt += Math.max(0, billRemaining(b)); }
  }));
  const agingMax = Math.max(1, ...agingBuckets.map(x=>x.amt));
  const agingTotal = agingBuckets.reduce((s,x)=>s+x.amt,0);
  const agingHtml = agingTotal === 0
    ? '<div class="cg-bar-empty">Nothing overdue. All caught up.</div>'
    : '<div class="cg-bars">'
      + agingBuckets.map(x => {
          const pct = (x.amt / agingMax * 100).toFixed(1);
          return '<div class="cg-bar-row" onclick="filterStatuses=[\'overdue\'];applyFilters()" title="Show overdue bills">'
               + '<div class="cg-bar-name">'+x.label+' <span class="cg-bar-unit">· '+x.count+' bill'+(x.count!==1?'s':'')+'</span></div>'
               + '<div class="cg-bar-track"><div class="cg-bar-fill cg-bar-fill-aging" style="width:'+pct+'%"></div></div>'
               + '<div class="cg-bar-val">&#8369;'+x.amt.toLocaleString()+'</div>'
               + '</div>';
        }).join('')
      + '</div>';

  // ── Compose panel ──
  return '<div class="insights-panel" id="insights-panel">'
    + '<button class="insights-toggle" onclick="toggleInsights()" aria-expanded="'+(_insightsOpen?'true':'false')+'">'
    +   '<span class="insights-arrow'+(_insightsOpen?' open':'')+'">›</span> Insights'
    + '</button>'
    + (_insightsOpen
        ? '<div class="insights-body">'
          + '<div class="insights-grid">'
          +   '<div class="insights-card insights-card-line">'
          +     '<div class="insights-card-title">Billed vs Collected <span class="insights-card-sub">last 6 months</span></div>'
          +     lineSvg
          +     '<div class="cg-legend cg-legend-line">'
          +       '<span class="cg-legend-item"><span class="cg-legend-dot" style="background:#4169e1"></span>Billed</span>'
          +       '<span class="cg-legend-item"><span class="cg-legend-dot" style="background:#1e8449"></span>Collected</span>'
          +     '</div>'
          +   '</div>'
          +   '<div class="insights-card insights-card-donut">'
          +     '<div class="insights-card-title">Bill Status <span class="insights-card-sub">active + paid this month</span></div>'
          +     donutSvg
          +     donutLegend
          +   '</div>'
          +   '<div class="insights-card insights-card-bars">'
          +     '<div class="insights-card-title">Top Outstanding <span class="insights-card-sub">click to filter</span></div>'
          +     barSvg
          +   '</div>'
          +   '<div class="insights-card insights-card-aging">'
          +     '<div class="insights-card-title">Overdue Aging <span class="insights-card-sub">how long money has been owed</span></div>'
          +     agingHtml
          +   '</div>'
          + '</div>'
          + '</div>'
        : '')
    + '</div>';
}

function renderAdmin() {
  const curYM = _currentYM();
  const monthLabel = new Date().toLocaleString('default',{month:'short'});
  let totalDue=0, unpaidCount=0, overdueDue=0, overdueCount=0;
  tenants.forEach(t=>t.bills.forEach(b=>{
    if(b.status==='paid') return;
    const rem = Math.max(0,billRemaining(b));
    totalDue += rem;
    unpaidCount++;
    if(getDueStatus(b)==='overdue'){ overdueDue+=rem; overdueCount++; }
  }));
  const billedThisMonth = _billedInMonth(curYM);
  const collectedThisMonth = _collectedInMonth(curYM);
  const rate = billedThisMonth>0 ? Math.round(collectedThisMonth/billedThisMonth*100) : null;
  const hasTemplates = tenants.some(t=>(t.templates||[]).length>0);
  document.getElementById('main-content').innerHTML=`
    <div class="page-eyebrow">Dashboard</div>
    <div class="page-title">Tenant Overview</div>
    <div class="summary-strip">
      <div class="summary-stat"><div class="stat-label">Tenants</div><div class="stat-value">${tenants.length}</div><div class="stat-sub">${unpaidCount} unpaid bill${unpaidCount!==1?'s':''}</div></div>
      <div class="summary-stat"><div class="stat-label">Outstanding</div><div class="stat-value blue">&#8369;${totalDue.toLocaleString()}</div><div class="stat-sub">all unpaid bills</div></div>
      <div class="summary-stat"><div class="stat-label">Overdue</div><div class="stat-value ${overdueDue>0?'rust':'green'}">${overdueDue>0?'&#8369;'+overdueDue.toLocaleString():'None'}</div><div class="stat-sub">${overdueCount>0?overdueCount+' bill'+(overdueCount!==1?'s':'')+' past due':'nothing past due'}</div></div>
      <div class="summary-stat"><div class="stat-label">Collected &middot; ${monthLabel}</div><div class="stat-value green">&#8369;${collectedThisMonth.toLocaleString()}</div><div class="stat-sub">of &#8369;${billedThisMonth.toLocaleString()} billed</div></div>
      <div class="summary-stat"><div class="stat-label">Collection Rate</div><div class="stat-value">${rate===null?'&mdash;':rate+'%'}</div><div class="stat-sub">collected vs billed &middot; ${monthLabel}</div></div>
    </div>
    ${renderInsights()}
    <div class="pay-inst-card">
      <div class="pay-inst-head">
        <div class="pay-inst-label">&#128176; Payment Instructions</div>
        <button class="btn-pay-inst-edit" onclick="openPayInstModal()">Edit</button>
      </div>
      ${paymentInstructions
        ? `<div class="pay-inst-preview">${esc(paymentInstructions)}</div>`
        : `<div class="pay-inst-empty">Not set — tenants will not see payment instructions.</div>`}
    </div>
    ${renderActionRequired()}
    <div class="section-bar">
      <div style="display:flex;align-items:center;">
        <div class="section-label">All Tenants</div>
        <div class="view-toggle">
          <button class="${viewMode==='card'?'active':''}" onclick="setViewMode('card')" title="Card View">&#9776;</button>
          <button class="${viewMode==='table'?'active':''}" onclick="setViewMode('table')" title="Table View">&#9638;</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-generate" onclick="exportCSV()" title="Export all bills to CSV">&#128190; Export CSV</button>
        ${hasTemplates?'<button class="btn-generate" onclick="openGenModal()">&#128197; Generate Bills</button>':''}
        <button class="btn-generate" onclick="openAddModal()">+ Add Tenant</button>
        <button class="btn-add" onclick="openQuickBill()">+ Add Bill</button>
      </div>
    </div>
    <div class="filter-toolbar" id="filter-toolbar">
      <input type="search" id="tenant-search" class="filter-search" placeholder="Search tenant or bill&hellip;" value="${esc(filterSearch)}" oninput="filterSearch=this.value;renderRows()" aria-label="Search tenants and bills" title="Search by tenant, unit, access code, or bill (press / to focus)">
      <button class="filter-toolbar-btn${filterMonth===_currentYM()?' active':''}" onclick="setFilterThisMonth()" title="Show only bills due this month">This Month</button>
      <div style="position:relative;display:inline-block;" id="filter-popover-wrap">
        <button class="filter-toolbar-btn${hasActiveFilters()?' active':''}" onclick="toggleFilterPopover()">&#9881; Filter${hasActiveFilters()?' ('+activeFilterCount()+')':''}</button>
        <div class="filter-popover" id="filter-popover">
          <div class="filter-popover-row">
            <div class="filter-popover-label">Tenant</div>
            <select id="fp-tenant" onchange="filterTenantId=this.value;applyFilters(true)">
              <option value="">All Tenants</option>
              ${tenants.map(t=>`<option value="${t.id}" ${filterTenantId===t.id?'selected':''}>${esc(t.name)} · Unit ${esc(t.unit)}</option>`).join('')}
            </select>
          </div>
          <div class="filter-popover-row">
            <div class="filter-popover-label">Month</div>
            <select id="fp-month" onchange="if(this.value==='__more__'){renderMonthDropdown(true);return;}filterMonth=this.value;applyFilters(true)">
              ${renderMonthOptions()}
            </select>
          </div>
          <div class="filter-popover-row">
            <div class="filter-popover-label">Status</div>
            <div class="filter-status-chips" id="fp-status-chips">
              ${['overdue','due-today','due-soon','upcoming','paid'].map(s => {
                const labels = {overdue:'Overdue','due-today':'Due Today','due-soon':'Due Soon',upcoming:'Upcoming',paid:'Paid'};
                const sel = filterStatuses.includes(s) ? ' selected' : '';
                return '<button class="filter-status-opt s-'+s+sel+'" onclick="toggleFilterStatus(\''+s+'\')">'+labels[s]+'</button>';
              }).join('')}
            </div>
          </div>
          <div class="filter-popover-actions">
            <button onclick="clearFilters()">Clear all</button>
            <button class="btn-apply" onclick="closeFilterPopover()">Done</button>
          </div>
        </div>
      </div>
      <div style="position:relative;display:inline-block;" id="sort-popover-wrap">
        <button class="sort-toolbar-btn${sortOrder!=='unit-asc'?' active':''}" onclick="toggleSortPopover()">&#8645; Sort${sortOrder!=='unit-asc'?': '+(SORT_LABELS[sortOrder]||''):''}</button>
        <div class="sort-popover" id="sort-popover">
          ${Object.entries(SORT_LABELS).map(([k,lbl])=>`<button class="sort-option${sortOrder===k?' active':''}" onclick="setSortOrder('${k}')">${lbl}</button>`).join('')}
        </div>
      </div>
      ${renderFilterChips()}
    </div>
    <div id="filter-result-note" class="filter-result-note"></div>
    ${viewMode==='card'?`<div class="tenant-table">
      <div class="table-head">
        <div class="th">Tenant</div><div class="th center">Access Code</div>
        <div class="th center">Bills</div><div class="th center">Balance Due</div><div class="th"></div>
      </div>
      <div id="tenant-rows"></div>
    </div>`:'<div id="tenant-rows"></div>'}
    <div style="margin-top:24px;">
      <button class="admin-paid-toggle" style="font-size:11px;font-weight:600;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.admin-paid-arrow').classList.toggle('open');if(this.nextElementSibling.classList.contains('open'))loadArchivedTenants();">
        <span class="admin-paid-arrow">›</span>&nbsp; Archived Tenants
      </button>
      <div class="admin-paid-list" style="padding:4px 0;">
        <div id="archived-tenants-wrap" style="padding:0 4px;"></div>
      </div>
    </div>`;
  renderRows();
}




// ─────────────────────────────────────────────
// PARTIAL PAYMENTS HELPERS
// ─────────────────────────────────────────────
function billTotalPaid(b) {
  if(!b.payments||!b.payments.length) return 0;
  return b.payments.reduce((s,p)=>s+Number(p.amount),0);
}
function billRemaining(b) {
  return Number(b.amount) - billTotalPaid(b);
}

// ─────────────────────────────────────────────
// SAFE BILL WRITES + RE-RENDER
// ─────────────────────────────────────────────
// Copy → save to DB → commit to local state only on success, so a failed
// request never leaves the UI showing unsaved data.
async function saveBills(tid, mutate, toastMsg) {
  const t = tenants.find(t=>t.id===tid);
  if(!t) return false;
  const billsCopy = structuredClone(t.bills);
  mutate(billsCopy);
  try {
    await dbUpdate(t.id, {bills: billsCopy});
    t.bills = billsCopy;
    if(toastMsg) showToast(toastMsg);
    return true;
  } catch(e) {
    showToast('Save failed: '+e.message, false);
    return false;
  }
}

// Re-render the dashboard without losing the admin's scroll position —
// used after quick actions (mark paid, undo, inline edits) so rows don't
// jump back to the top of the page.
function rerenderAdmin() {
  const y = window.scrollY;
  renderAdmin();
  requestAnimationFrame(()=>window.scrollTo(0, y));
}

// ─────────────────────────────────────────────
// F-12: UNIFIED DUE STATUS UTILITY
// ─────────────────────────────────────────────
function getDueStatus(bill) {
  if(bill.status === 'paid') return 'paid';
  // No due date: honour a legacy manual 'overdue' flag, otherwise unscheduled.
  if(!bill.due) return bill.status === 'overdue' ? 'overdue' : 'no-date';
  const today = new Date(); today.setHours(0,0,0,0);
  const in3   = new Date(today); in3.setDate(in3.getDate()+3);
  const d     = new Date(bill.due+'T00:00:00');
  if(d < today)                  return 'overdue';
  if(d.getTime()===today.getTime()) return 'due-today';
  if(d <= in3)                   return 'due-soon';
  return 'upcoming';
}
function getDueUrgencyScore(bill) {
  const s = getDueStatus(bill);
  if(s==='overdue'){
    // Older overdue sorts first.
    const today=new Date(); today.setHours(0,0,0,0);
    const days = bill.due ? Math.floor((today-new Date(bill.due+'T00:00:00'))/86400000) : 0;
    return -days;
  }
  if(s==='due-today') return 1;
  if(s==='due-soon')  return 2;
  if(s==='upcoming'){
    const today=new Date(); today.setHours(0,0,0,0);
    return 3+Math.floor((new Date(bill.due+'T00:00:00')-today)/(86400000));
  }
  if(s==='no-date') return 900;
  return 1000; // paid sorts last
}
// Days a bill is past due (0 if not overdue / no due date)
function daysOverdue(bill) {
  if(bill.status==='paid' || !bill.due) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(bill.due+'T00:00:00');
  return d < today ? Math.floor((today-d)/86400000) : 0;
}

// Maps ordinal unit names/numbers to a sortable integer
function unitRank(unit) {
  const s = unit.toLowerCase().trim();
  const words = {'first':1,'second':2,'third':3,'fourth':4,'fifth':5,
                 'sixth':6,'seventh':7,'eighth':8,'ninth':9,'tenth':10};
  for (const [w,n] of Object.entries(words)) { if(s.includes(w)) return n; }
  const m = s.match(/([0-9]+)/);
  return m ? parseInt(m[1]) : 999;
}

// Badge colour class from a derived due-status.
function dsBadgeClass(ds){
  return { overdue:'ds-overdue', 'due-today':'ds-overdue', 'due-soon':'ds-due',
           upcoming:'ds-upcoming', 'no-date':'ds-upcoming', paid:'ds-paid' }[ds] || 'ds-upcoming';
}
function tenantBalance(t){
  return t.bills.filter(b=>b.status!=='paid').reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
}

function renderRows() {
  const c = document.getElementById('tenant-rows');
  if (!c) return;
  if (!tenants.length) { c.innerHTML=`<div class="empty-state"><div class="icon">&#127962;</div><p>No tenants yet. Add your first tenant to get started.</p></div>`; return; }
  const mob = window.innerWidth <= 768;

  // Apply tenant filter
  let filtered = filterTenantId ? tenants.filter(t=>t.id===filterTenantId) : tenants;

  // Apply search — matches tenants (name / unit / access code) OR bills
  // (label / remark). A tenant match shows the whole tenant; a bill-only
  // match narrows that tenant's bill list to just the matching bills, so
  // typing "water" surfaces every water bill across all tenants.
  if (filterSearch.trim()) {
    const q = filterSearch.trim().toLowerCase();
    const tenantHit = t =>
      (t.name||'').toLowerCase().includes(q) ||
      (t.unit||'').toLowerCase().includes(q) ||
      (t.code||'').toLowerCase().includes(q);
    const billHit = b =>
      (b.label||'').toLowerCase().includes(q) ||
      (b.remark||'').toLowerCase().includes(q);
    filtered = filtered.map(t => {
      if (tenantHit(t)) return t;
      const bills = t.bills.filter(billHit);
      // _billSearch flags a narrowed copy so the card view can auto-expand
      // the paid section when the matches are paid bills.
      return bills.length ? {...t, bills, _billSearch: true} : null;
    }).filter(Boolean);
  }

  // Apply month filter — only show tenants who have at least one bill in that month.
  // NOTE: The {...t, bills} spread creates a shallow copy with a filtered bills array
  // for DISPLAY ONLY. The bill objects inside are shared references, so click handlers
  // must resolve indexes against the ORIGINAL tenant's bill array (see origBillIndex).
  if (filterMonth) {
    // A bill is in-month if its due date matches; bills with no due date are always
    // included so they don't silently disappear from view.
    filtered = filtered.map(t => {
      const inMonth = b => (b.due && b.due.startsWith(filterMonth)) || !b.due;
      const bills = t.bills.filter(inMonth);
      return bills.length ? {...t, bills} : null;
    }).filter(Boolean);
  }

  // Apply status filter — filter bills within each tenant by due status.
  // 'no-date' bills are not selectable in the UI; they're surfaced under 'upcoming'.
  if (filterStatuses.length) {
    filtered = filtered.map(t => {
      const bills = t.bills.filter(b => {
        const ds = getDueStatus(b);
        if (ds === 'paid') return filterStatuses.includes('paid');
        if (ds === 'no-date') return filterStatuses.includes('upcoming');
        return filterStatuses.includes(ds);
      });
      return bills.length ? {...t, bills} : null;
    }).filter(Boolean);
  }

  // Result note
  const noteEl = document.getElementById('filter-result-note');
  const anyFilter = hasActiveFilters() || !!filterSearch.trim();
  if (noteEl) {
    noteEl.textContent = anyFilter && !filtered.length ? 'No results match your filters.' : '';
  }

  // Apply sort (stable: ties broken by unit, then name)
  filtered = filtered.slice().sort((a,b)=>{
    let r = 0;
    if(sortOrder==='unit-asc')          r = unitRank(a.unit)-unitRank(b.unit);
    else if(sortOrder==='unit-desc')    r = unitRank(b.unit)-unitRank(a.unit);
    else if(sortOrder==='name-asc')     r = a.name.localeCompare(b.name);
    else if(sortOrder==='balance-desc') r = tenantBalance(b)-tenantBalance(a);
    else if(sortOrder==='balance-asc')  r = tenantBalance(a)-tenantBalance(b);
    else if(sortOrder==='urgency') {
      const urg = t => t.bills.filter(x=>x.status!=='paid').reduce((m,x)=>Math.min(m,getDueUrgencyScore(x)), 10000);
      r = urg(a)-urg(b);
    }
    if(r===0) r = unitRank(a.unit)-unitRank(b.unit);
    if(r===0) r = a.name.localeCompare(b.name);
    return r;
  });

  if (!filtered.length) {
    c.innerHTML = `<div class="empty-state"><div class="icon">&#128269;</div><p>No results match your filter.</p></div>`;
    return;
  }

  if (viewMode === 'table') { renderTableView(c, filtered); return; }

  const paidFilterOn = filterStatuses.includes('paid');

  c.innerHTML = filtered.map(t=>{
    // Resolve the original tenant: filtered copies share bill object references,
    // so indexOf against the original array yields the TRUE index for handlers.
    const orig = tenants.find(ot=>ot.id===t.id) || t;
    const origBillIndex = b => orig.bills.indexOf(b);

    const activeBills = t.bills.filter(b=>b.status!=='paid');
    const paidBills   = t.bills.filter(b=>b.status==='paid');
    const due = activeBills.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
    // "Settled" only when the tenant TRULY owes nothing; if filters/search
    // merely hid their unpaid bills, show a neutral dash instead.
    const trulySettled = !orig.bills.some(b=>b.status!=='paid' && billRemaining(b)>0);
    const total = due ? '&#8369;'+due.toLocaleString()
      : (trulySettled
          ? `<span style="color:var(--green);font-size:13px;font-family:Inter,sans-serif">Settled</span>`
          : `<span style="color:var(--muted);font-size:13px;font-family:Inter,sans-serif" title="This tenant has unpaid bills hidden by the current filters">&mdash;</span>`);
    const hasBalance = orig.bills.some(b=>b.status!=='paid' && billRemaining(b)>0);
    const actions = `<div class="row-actions"><button class="btn-statement" style="padding:4px 10px;font-size:10px;" onclick="openStmtModalById('${t.id}')" aria-label="Generate statement">Statement</button>${hasBalance?`<button class="btn-icon" onclick="copyReminder('${t.id}')" title="Copy payment reminder" aria-label="Copy payment reminder">&#9993;</button>`:''}<button class="btn-icon" onclick="openQuickBill('${t.id}')" title="Add bill" aria-label="Add bill">&#65291;</button><button class="btn-icon" onclick="openEditModal('${t.id}')" title="Edit tenant" aria-label="Edit">&#9998;</button><button class="btn-icon del" onclick="deleteTenant('${t.id}')" title="Archive tenant" aria-label="Archive">&#10005;</button></div>`;

    // Active bill badges sorted by urgency, coloured by derived due-status
    const sortedActive = activeBills.slice().sort((a,b)=>getDueUrgencyScore(a)-getDueUrgencyScore(b));
    const activeBadges = sortedActive.length
      ? sortedActive.map(b=>{
          const bi=origBillIndex(b);
          const ds=getDueStatus(b);
          const rem=Math.max(0,billRemaining(b));
          const tip=`&#8369;${Number(b.amount).toLocaleString()}${b.due?' · due '+formatDate(b.due):''}${b.remark?' · '+esc(b.remark):''} — click to mark paid`;
          return `<button class="mini-status ${dsBadgeClass(ds)}" onclick="toggleStatus('${t.id}',${bi})" title="${tip}">${esc(b.label)} &#8369;${rem.toLocaleString()}</button>`;
        }).join('')
      : (orig.bills.some(b=>b.status!=='paid')
          ? `<span style="font-size:11px;color:var(--muted);">No unpaid bills match filters</span>`
          : `<span style="font-size:12px;color:var(--green);font-weight:500">Settled</span>`);

    // Paid archive rows — sorted newest first, limited to 3
    const paidSorted = paidBills.slice().sort((a,b)=>(b.paidDate||'').localeCompare(a.paidDate||''));
    const PAID_LIMIT = 3;
    const buildPaidRows = (bills) => bills.map(b=>{ const bi=origBillIndex(b); return `
      <div class="admin-paid-item">
        <span class="admin-paid-label">${esc(b.label)}</span>
        <span class="admin-paid-amount">&#8369;${Number(b.amount).toLocaleString()}</span>
        ${b.paidDate?`<span class="admin-paid-date">Paid ${formatDate(b.paidDate)}</span>`:''}
        <button class="admin-paid-revert" onclick="revertToPending('${t.id}',${bi})">Undo</button>
      </div>`;}).join('');
    const hiddenPaid = paidSorted.length - PAID_LIMIT;
    const paidListId = 'paid-list-'+t.id;
    // Open when the admin expanded it earlier, when the Paid filter is on, or
    // when a bill search matched paid bills (filtering to bills and then
    // hiding them would be baffling).
    const paidOpen = paidFilterOn || _openPaid.has(t.id) || (!!t._billSearch && paidBills.length > 0);
    const paidSection = paidBills.length ? `
      <div class="admin-paid-section">
        <button class="admin-paid-toggle" onclick="togglePaidSection('${t.id}',this)">
          <span class="admin-paid-arrow${paidOpen?' open':''}">›</span>&nbsp; Paid (${paidBills.length})
        </button>
        <div class="admin-paid-list${paidOpen?' open':''}" id="${paidListId}">
          ${buildPaidRows(paidSorted.slice(0,PAID_LIMIT))}
          ${hiddenPaid>0?`<button class="admin-paid-show-more" onclick="expandAdminPaid('${t.id}')">Show all (${hiddenPaid} more)</button>`:''}
        </div>
      </div>` : '';

    if (mob) {
      return `<div class="tenant-row">
        <div class="tenant-row-top">
          <div>
            <div class="row-name">${esc(t.name)}</div>
            <div class="row-unit">Unit ${esc(t.unit)}${t.move_in_date?' · Since '+formatDate(t.move_in_date):''}</div>
            ${t.phone||t.email?`<div style="font-size:11px;color:var(--muted);margin-top:2px;">${t.phone?`<a href="tel:${esc(t.phone)}" style="color:var(--muted);text-decoration:none;">&#128222; ${esc(t.phone)}</a>`:''} ${t.phone&&t.email?' · ':''} ${t.email?`<a href="mailto:${esc(t.email)}" style="color:var(--muted);text-decoration:none;">&#9993; ${esc(t.email)}</a>`:''}</div>`:''}
            <div class="tenant-row-meta"><span class="row-code">${esc(t.code)}</span></div>
          </div>
          ${actions}
        </div>
        <div class="tenant-row-bills">${activeBadges}</div>
        <div class="tenant-row-footer"><div class="row-total-label">Balance Due</div><div class="row-total" style="text-align:right;">${total}</div></div>
        ${paidSection}
      </div>`;
    }
    return `<div class="tenant-row" style="display:block;padding:0;">
      <div style="display:grid;grid-template-columns:2fr 1fr 1.4fr 1fr auto;align-items:center;padding:0 24px;min-height:68px;">
        <div>
          <div class="row-name">${esc(t.name)}</div>
          <div class="row-unit">Unit ${esc(t.unit)}${t.move_in_date?' &nbsp;·&nbsp; Since '+formatDate(t.move_in_date):''}</div>
          ${t.phone||t.email?`<div style="font-size:11px;color:var(--muted);margin-top:3px;">${t.phone?`<a href="tel:${esc(t.phone)}" style="color:var(--muted);text-decoration:none;">&#128222; ${esc(t.phone)}</a>`:''} ${t.phone&&t.email?'&nbsp;·&nbsp;':''} ${t.email?`<a href="mailto:${esc(t.email)}" style="color:var(--muted);text-decoration:none;">&#9993; ${esc(t.email)}</a>`:''}</div>`:''}
        </div>
        <div class="col-center"><span class="row-code">${esc(t.code)}</span></div>
        <div class="row-bills col-center">${activeBadges}</div>
        <div class="row-total col-center">${total}</div>
        ${actions}
      </div>
      ${paidSection}
    </div>`;
  }).join('');
}

// Toggle a tenant's paid-bills section and remember the choice across re-renders.
function togglePaidSection(tid, btn){
  const list = btn.nextElementSibling;
  const arrow = btn.querySelector('.admin-paid-arrow');
  const nowOpen = !list.classList.contains('open');
  list.classList.toggle('open', nowOpen);
  if(arrow) arrow.classList.toggle('open', nowOpen);
  if(nowOpen) _openPaid.add(tid); else _openPaid.delete(tid);
}

// ── TABLE DATABASE VIEW ──
function setViewMode(mode) { viewMode = mode; tableRowLimit = 50; rerenderAdmin(); }
function loadMoreTableRows() { tableRowLimit += 50; renderRows(); }

function sortTable(col) {
  if (tableSortCol === col) { tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc'; }
  else { tableSortCol = col; tableSortDir = 'asc'; }
  tableRowLimit = 50; // reset cap so a fresh sort always starts at the top
  renderRows();
}

let tableRowLimit = 50; // initial cap for table rows

function renderTableView(c, filtered) {
  // Flatten all tenants' bills into individual rows (status already filtered by renderRows)
  const rows = [];
  filtered.forEach(t => {
    t.bills.forEach((b, bi) => {
      const origTenant = tenants.find(ot => ot.id === t.id) || t;
      rows.push({ tenant: origTenant, bill: b, bi: origTenant.bills.indexOf(b) });
    });
  });

  // Sort by selected column. Rows with no date always sort last, in either
  // direction, so "sort by paid date" doesn't bury real data under blanks.
  const dir = tableSortDir === 'asc' ? 1 : -1;
  const cmpDate = (av, bv) => {
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av.localeCompare(bv) * dir;
  };
  rows.sort((a, b) => {
    let r = 0;
    switch (tableSortCol) {
      case 'status':    r = (getDueUrgencyScore(a.bill) - getDueUrgencyScore(b.bill)) * dir; break;
      case 'tenant':    r = a.tenant.name.localeCompare(b.tenant.name) * dir; break;
      case 'unit':      r = (unitRank(a.tenant.unit) - unitRank(b.tenant.unit)) * dir; break;
      case 'label':     r = (a.bill.label || '').localeCompare(b.bill.label || '') * dir; break;
      case 'amount':    r = ((Number(a.bill.amount) || 0) - (Number(b.bill.amount) || 0)) * dir; break;
      case 'remaining': r = (billRemaining(a.bill) - billRemaining(b.bill)) * dir; break;
      case 'due':       r = cmpDate(a.bill.due, b.bill.due); break;
      case 'paidDate':  r = cmpDate(a.bill.paidDate, b.bill.paidDate); break;
    }
    // Stable tie-breakers: unit, then due date.
    if (r === 0) r = unitRank(a.tenant.unit) - unitRank(b.tenant.unit);
    if (r === 0) r = cmpDate(a.bill.due, b.bill.due);
    return r;
  });

  if (!rows.length) {
    c.innerHTML = '<div class="db-empty">No bills to display.</div>';
    return;
  }

  function thHtml(col, label) {
    const arrow = tableSortCol === col ? (tableSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return '<th onclick="sortTable(\''+col+'\')">'+label+'<span class="sort-arrow">'+arrow+'</span></th>';
  }

  const dueStatusLabel = { overdue:'Overdue', 'due-today':'Due Today', 'due-soon':'Due Soon', upcoming:'Upcoming', 'no-date':'Unscheduled', paid:'Paid' };

  const totalRows = rows.length;
  const capped = rows.slice(0, tableRowLimit);

  const tbody = capped.map(r => {
    const b = r.bill, t = r.tenant;
    const ds = b.status === 'paid' ? 'paid' : getDueStatus(b);
    const remaining = Math.max(0, billRemaining(b));
    const isPaid = b.status === 'paid';
    const tidAttr = esc(t.id);
    // Status badge toggles paid/unpaid on click (matches card-view behavior).
    const statusBtn = '<button class="mini-status '+dsBadgeClass(ds)+'" '
      + 'onclick="toggleStatus(\''+tidAttr+'\','+r.bi+')" '
      + 'title="'+(isPaid?'Click to revert to unpaid':'Click to mark paid')+'" '
      + 'style="cursor:pointer;font-size:9px;border:none;">'
      + (dueStatusLabel[ds]||ds)
      + '</button>';
    // Amount cell becomes an editable input on click.
    const amountCell = '<td class="td-amount td-amt-edit" '
      + 'data-tid="'+tidAttr+'" data-bi="'+r.bi+'" '
      + 'onclick="enterAmountEdit(this)" '
      + 'title="Click to edit amount">'
      + '&#8369;'+Number(b.amount).toLocaleString()
      + '</td>';
    const actionsCell = '<td class="td-actions">'
      + (isPaid
          ? '<button class="row-quick-btn revert" onclick="revertToPending(\''+tidAttr+'\','+r.bi+')" title="Revert to unpaid" aria-label="Revert">↺</button>'
          : '<button class="row-quick-btn pay" onclick="quickMarkPaid(\''+tidAttr+'\','+r.bi+')" title="Mark paid" aria-label="Mark paid">✓ Paid</button>')
      + '<button class="row-quick-btn edit" onclick="openEditBillFromTable(\''+tidAttr+'\','+r.bi+')" title="Edit bill" aria-label="Edit">✎</button>'
      + '</td>';
    return '<tr>' +
      '<td>'+statusBtn+'</td>' +
      '<td>'+esc(t.name)+'</td>' +
      '<td>'+esc(t.unit)+'</td>' +
      '<td>'+esc(b.label)+'</td>' +
      amountCell +
      '<td class="td-amount">'+(remaining ? '&#8369;'+remaining.toLocaleString() : '<span style="color:var(--green)">—</span>')+'</td>' +
      '<td class="td-date">'+(b.due ? formatDate(b.due) : '—')+'</td>' +
      '<td class="td-date">'+(b.paidDate ? formatDate(b.paidDate) : '—')+'</td>' +
      '<td class="td-remark" title="'+(b.remark ? esc(b.remark) : '')+'">'+(b.remark ? esc(b.remark) : '')+'</td>' +
      actionsCell +
    '</tr>';
  }).join('');

  const showMoreBtn = totalRows > tableRowLimit
    ? '<div style="text-align:center;padding:12px;"><button class="btn-generate" onclick="loadMoreTableRows()">Show more (' + (totalRows - tableRowLimit) + ' remaining)</button></div>'
    : '';
  const countNote = '<div style="font-size:11px;color:var(--muted);padding:8px 12px;">Showing ' + capped.length + ' of ' + totalRows + ' bills</div>';

  c.innerHTML = countNote + '<div class="db-table-wrap"><table class="db-table">' +
    '<thead><tr>' +
      thHtml('status','Status') +
      thHtml('tenant','Tenant') +
      thHtml('unit','Unit') +
      thHtml('label','Bill') +
      thHtml('amount','Amount') +
      thHtml('remaining','Balance') +
      thHtml('due','Due Date') +
      thHtml('paidDate','Paid Date') +
      thHtml('remark','Remarks') +
      '<th class="th-actions">Actions</th>' +
    '</tr></thead>' +
    '<tbody>'+tbody+'</tbody>' +
  '</table></div>' + showMoreBtn;
}

// ── INLINE TABLE EDITING ──
// Open the tenant edit modal directly on the Bills tab and scroll to the bill.
// Always force-render all paid bills so that targeting a paid bill outside the
// default 3-row preview still works.
function openEditBillFromTable(tid, bi){
  openEditModal(tid);
  setTimeout(() => {
    const tabs = document.querySelectorAll('.modal-tab');
    if(tabs[1]) tabs[1].click();
    setTimeout(() => {
      if(typeof renderBillListItems === 'function') renderBillListItems(true);
      if(typeof editBillInline === 'function') editBillInline(bi);
      const target = document.getElementById('bill-edit-inline-'+bi);
      if(target && target.scrollIntoView) target.scrollIntoView({behavior:'smooth', block:'center'});
    }, 30);
  }, 30);
}

// Convert an amount cell into an inline input. Enter or blur saves; Escape cancels.
function enterAmountEdit(td){
  if(td.querySelector('input')) return; // already editing
  const tid = td.dataset.tid;
  const bi  = Number(td.dataset.bi);
  const t = tenants.find(t=>t.id===tid);
  if(!t || !t.bills[bi]) return;
  const original = Number(t.bills[bi].amount);
  td.innerHTML = '<input type="text" inputmode="decimal" value="'+original+'" '
    + 'class="td-amt-input" onblur="commitAmountEdit(this)" '
    + 'onkeydown="if(event.key===\'Enter\'){this.blur();}else if(event.key===\'Escape\'){this.dataset.cancel=\'1\';this.blur();}">';
  const input = td.querySelector('input');
  input.focus();
  input.select();
}

async function commitAmountEdit(input){
  const td  = input.closest('td');
  const tid = td.dataset.tid;
  const bi  = Number(td.dataset.bi);
  const t = tenants.find(t=>t.id===tid);
  if(!t || !t.bills[bi]) return;
  const original = Number(t.bills[bi].amount);
  // Cancel path — restore original cell content.
  if(input.dataset.cancel){
    td.innerHTML = '&#8369;'+original.toLocaleString();
    return;
  }
  const raw = String(input.value).replace(/,/g,'').trim();
  const parsed = Number(raw);
  if(isNaN(parsed) || parsed < 0){
    showToast('Amount must be a non-negative number.', false);
    td.innerHTML = '&#8369;'+original.toLocaleString();
    return;
  }
  const next = Math.round(parsed * 100) / 100;
  if(next === original){
    td.innerHTML = '&#8369;'+original.toLocaleString();
    return;
  }
  // Commit to DB then update local state and re-render.
  const billsCopy = structuredClone(t.bills);
  billsCopy[bi].amount = next;
  try {
    await dbUpdate(t.id, {bills: billsCopy});
    t.bills = billsCopy;
    showToast('Amount updated.');
    renderRows();
  } catch(e){
    showToast('Save failed: '+e.message, false);
    td.innerHTML = '&#8369;'+original.toLocaleString();
  }
}

// Pending paid-date action
let _pendingPaid = null;

// Click on a bill badge: unpaid → confirm-paid modal; paid → back to unpaid.
// (The old three-way unpaid → overdue → paid cycle was removed — overdue is
// now derived from the due date, so there is nothing to cycle through.)
async function toggleStatus(tid,bi){
  const t=tenants.find(t=>t.id===tid);
  if(!t||!t.bills[bi]) return;
  if(t.bills[bi].status==='paid'){ revertToPending(tid,bi); return; }
  _pendingPaid={tid,bi};
  document.getElementById('paiddate-bill-name').textContent = t.bills[bi].label + ' — ' + t.name;
  document.getElementById('paiddate-input').value=new Date().toISOString().slice(0,10);
  openModal('paiddate-modal');
}

function closePaidModal(){
  closeModalEl('paiddate-modal');
  _pendingPaid=null;
}

async function confirmPaid(){
  if(!_pendingPaid) return;
  const {tid,bi}=_pendingPaid;
  closePaidModal();
  const dateVal=document.getElementById('paiddate-input').value;
  const ok = await saveBills(tid, bills=>{
    if(!bills[bi]) return;
    bills[bi].status='paid';
    bills[bi].paidDate=dateVal||new Date().toISOString().slice(0,10);
  }, 'Marked as paid ✓');
  if(ok) rerenderAdmin();
}

async function revertToPending(tid,bi){
  const ok = await saveBills(tid, bills=>{
    if(!bills[bi]) return;
    bills[bi].status='unpaid';
    bills[bi].paidDate='';
  }, 'Bill moved back to unpaid.');
  if(ok) rerenderAdmin();
}
async function deleteTenant(tid){
  if(!confirm('Archive this tenant? Their data will be preserved and can be restored.')) return;
  setLoading(true,'Archiving…');
  try {
    await dbUpdate(tid, {archived_at: new Date().toISOString()});
    tenants = tenants.filter(t=>t.id!==tid);
    setLoading(false); showToast('Tenant archived.'); rerenderAdmin();
  } catch(e){ setLoading(false); showToast('Archive failed: '+e.message, false); }
}
async function restoreTenant(tid){
  setLoading(true,'Restoring…');
  try {
    await dbUpdate(tid, {archived_at: null});
    tenants = await dbGetAll() || [];
    setLoading(false); showToast('Tenant restored.'); rerenderAdmin(); loadArchivedTenants();
  } catch(e){ setLoading(false); showToast('Restore failed: '+e.message, false); }
}
async function permanentlyDeleteTenant(tid){
  const wrap = document.getElementById('archived-tenants-wrap');
  const label = wrap ? wrap.querySelector('[data-tid="'+tid+'"]') : null;
  const displayName = label ? label.textContent : 'this tenant';
  // Single, harder-to-misclick confirm: require the admin to type the tenant's name.
  const typed = prompt('This will permanently delete ' + displayName + ' and all their billing data. This cannot be undone.\n\nType the tenant\'s name to confirm:');
  if(typed === null) return; // cancelled
  if(typed.trim().toLowerCase() !== displayName.trim().toLowerCase()){
    showToast('Name did not match — deletion cancelled.', false);
    return;
  }
  setLoading(true,'Deleting permanently…');
  try {
    await dbDelete(tid);
    setLoading(false); showToast('Tenant permanently deleted.'); loadArchivedTenants();
  } catch(e){ setLoading(false); showToast('Delete failed: '+e.message, false); }
}
async function loadArchivedTenants(){
  try {
    const archived = await sbFetch('tenants?select=*&archived_at=not.is.null&order=name');
    const wrap = document.getElementById('archived-tenants-wrap');
    if(!wrap) return;
    if(!archived||!archived.length){ wrap.innerHTML='<div style="font-size:13px;color:var(--muted);padding:12px 0;">No archived tenants.</div>'; return; }
    wrap.innerHTML = archived.map(t=>`
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:600;color:var(--ink);" data-tid="${t.id}">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--muted);">Unit ${esc(t.unit)} &nbsp;·&nbsp; Archived ${formatDate((t.archived_at||'').slice(0,10))}</div>
        </div>
        <button class="btn-icon" onclick="restoreTenant('${t.id}')" title="Restore tenant" aria-label="Restore" style="color:var(--green);border-color:var(--green);">&#8635;</button>
        <button class="btn-icon del" onclick="permanentlyDeleteTenant('${t.id}')" title="Permanently delete" aria-label="Delete">&#10005;</button>
      </div>`).join('');
  } catch(e){ showToast('Could not load archived tenants.', false); }
}

function switchModalTab(tab,btn){
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-info').classList.toggle('active',tab==='info');
  document.getElementById('panel-bills').classList.toggle('active',tab==='bills');
  document.getElementById('panel-templates').classList.toggle('active',tab==='templates');
  if(tab==='bills') renderBillListItems();
  if(tab==='templates') renderTemplateList();
}

function openAddModal(){
  editingId=null;
  document.getElementById('modal-eyebrow').textContent='New Tenant';
  document.getElementById('modal-title').textContent='Add a tenant';
  const saveBtn=document.getElementById('btn-save-tenant'); if(saveBtn) saveBtn.textContent='Add tenant';
  document.getElementById('m-name').value='';
  document.getElementById('m-unit').value='';
  document.getElementById('m-code').value=randCode();
  document.getElementById('m-phone').value='';
  document.getElementById('m-email').value='';
  document.getElementById('m-movein').value='';
  document.getElementById('modal-tabs').style.display='none';
  document.getElementById('new-tenant-bills').style.display='block';
  document.getElementById('panel-info').classList.add('active');
  document.getElementById('panel-bills').classList.remove('active');
  billForms=[{label:'Monthly Rent',amount:'',due:'',status:'unpaid'}];
  renderBillForms();
  openModal('tenant-modal');
}
function openEditModal(tid){
  const t=tenants.find(t=>t.id===tid); if(!t) return; editingId=tid;
  document.getElementById('modal-eyebrow').textContent='Edit Tenant';
  document.getElementById('modal-title').textContent=t.name; // textContent — no HTML-escaping needed
  const saveBtn=document.getElementById('btn-save-tenant'); if(saveBtn) saveBtn.textContent='Save changes';
  document.getElementById('m-name').value=t.name;
  document.getElementById('m-unit').value=t.unit;
  document.getElementById('m-code').value=t.code;
  document.getElementById('m-phone').value=t.phone||'';
  document.getElementById('m-email').value=t.email||'';
  document.getElementById('m-movein').value=t.move_in_date||'';
  // Bills tab manages bills via its own UI; billForms is only used for new tenants.
  billForms = [];
  document.getElementById('modal-tabs').style.display='flex';
  document.getElementById('new-tenant-bills').style.display='none';
  document.querySelectorAll('.modal-tab').forEach((tab,i)=>tab.classList.toggle('active',i===0));
  document.getElementById('panel-info').classList.add('active');
  document.getElementById('panel-bills').classList.remove('active');
  document.getElementById('panel-templates').classList.remove('active');
  document.getElementById('new-bill-inline').style.display='none';
  openModal('tenant-modal');
}
function closeModal(){
  closeModalEl('tenant-modal');
  editingId=null;
  cancelNewBill(); // ensure + Add bill button always reappears
}

function billListItemHtml(b, i, extraClass) {
  const paid = billTotalPaid(b);
  const remaining = billRemaining(b);
  const hasPartial = b.status!=='paid' && paid > 0;
  const paymentsHtml = (b.payments||[]).map((p,pi)=>`
    <div class="payment-entry">
      <span class="payment-entry-date">${formatDate(p.date)}</span>
      <span class="payment-entry-amt">&#8369;${Number(p.amount).toLocaleString()} paid</span>
      ${p.note?`<span class="payment-entry-note">${esc(p.note)}</span>`:'<span class="payment-entry-note"></span>'}
      ${extraClass!=='paid-item'?`<button class="payment-entry-del" onclick="deletePaymentEntry(${i},${pi})" title="Remove" aria-label="Delete">&#10005;</button>`:''}
    </div>`).join('');
  // Use unified due-status so "Upcoming" and "Due Soon" appear instead of red "Unpaid".
  const ds = getDueStatus(b);
  const statusMeta = {
    paid:      {label: 'Paid',      color: 'var(--green)'},
    overdue:   {label: 'Overdue',   color: 'var(--rust)'},
    'due-today':{label:'Due Today', color: 'var(--rust)'},
    'due-soon':{label:'Due Soon',   color: 'var(--orange)'},
    upcoming:  {label: 'Upcoming',  color: 'var(--muted)'},
    'no-date': {label: 'Unscheduled', color: 'var(--muted)'}
  }[ds] || {label: 'Unpaid', color: 'var(--rust)'};
  const statusHtml = b.status==='paid' && b.paidDate
    ? `<span style="color:var(--green);font-weight:600;">Paid ${formatDate(b.paidDate)}</span>`
    : `<span style="color:${statusMeta.color};font-weight:600;">${statusMeta.label}</span>`;
  return `<div class="bill-list-item ${extraClass||''}">
    <div class="bill-list-info" style="flex:1">
      <div class="bill-list-label">${esc(b.label)}</div>
      <div class="bill-list-meta">
        &#8369;${Number(b.amount).toLocaleString()}
        ${b.due?' &nbsp;·&nbsp; Due '+formatDate(b.due):''}
        &nbsp;·&nbsp; ${statusHtml}
      </div>
      ${hasPartial?`<div class="partial-balance${remaining<=0?' settled':''}">&#8369;${paid.toLocaleString()} received &nbsp;·&nbsp; &#8369;${Math.max(0,remaining).toLocaleString()} remaining</div>`:''}
      ${(b.payments&&b.payments.length)?`<div class="payments-log">${paymentsHtml}</div>`:''}
      ${extraClass!=='paid-item'?`<button class="btn-add-payment" onclick="openAddPayment(${i})">+ Add Payment</button><div id="add-payment-form-${i}" style="display:none"></div>`:''}
    </div>
    <div class="bill-list-actions" style="gap:6px;align-self:flex-start;margin-top:2px;">
      <button class="btn-icon" onclick="editBillInline(${i})" aria-label="Edit">&#9998;</button>
      <button class="btn-icon del" onclick="deleteBillFromList(${i})" aria-label="Delete">&#10005;</button>
    </div>
  </div>
  <div id="bill-edit-inline-${i}" style="display:none"></div>`;
}

function renderBillListItems(showAllPaid){
  const t=tenants.find(t=>t.id===editingId); if(!t) return;
  const c=document.getElementById('bill-list-items'); if(!c) return;
  if(!t.bills.length){ c.innerHTML='<div style="text-align:center;padding:24px 0;font-size:13px;color:var(--muted);">No bills yet. Add one below.</div>'; return; }

  const unpaid = t.bills.map((b,i)=>({b,i})).filter(({b})=>b.status!=='paid');
  const paid   = t.bills.map((b,i)=>({b,i})).filter(({b})=>b.status==='paid')
                   .sort((a,b)=>(b.b.paidDate||'').localeCompare(a.b.paidDate||''));

  const LIMIT = 3;
  const visiblePaid = showAllPaid ? paid : paid.slice(0, LIMIT);
  const hiddenCount = paid.length - visiblePaid.length;

  let html = unpaid.map(({b,i})=>billListItemHtml(b,i,'')).join('');

  if(paid.length){
    html += `<div class="bill-list-paid-divider">Paid (${paid.length})</div>`;
    html += visiblePaid.map(({b,i})=>billListItemHtml(b,i,'paid-item')).join('');
    if(hiddenCount > 0){
      html += `<button class="bill-list-show-more" onclick="renderBillListItems(true)">Show all paid bills  (${hiddenCount} more)</button>`;
    } else if(showAllPaid && paid.length > LIMIT){
      html += `<button class="bill-list-show-more" onclick="renderBillListItems(false)">Show less</button>`;
    }
  }

  c.innerHTML = html;
}

function editBillInline(i){
  document.querySelectorAll('[id^="bill-edit-inline-"]').forEach(el=>el.style.display='none');
  const t=tenants.find(t=>t.id===editingId); if(!t||!t.bills[i]) return; const b=t.bills[i];
  const el=document.getElementById('bill-edit-inline-'+i); el.style.display='block';
  el.innerHTML=`<div class="bill-edit-form">
    <div class="form-grid">
      <div class="field"><label>Description</label><input type="text" id="bi-label-${i}" value="${esc(b.label)}"></div>
      <div class="field"><label>Amount (&#8369;)</label><input type="text" id="bi-amount-${i}" value="${b.amount}" inputmode="decimal" pattern="[0-9.]*" autocomplete="off"></div>
      <div class="field"><label>Due Date</label><input type="date" id="bi-due-${i}" value="${b.due||''}"></div>
      <div class="field"><label>Status</label>
        <select id="bi-status-${i}" onchange="document.getElementById('bi-pd-wrap-${i}').style.display=this.value==='paid'?'block':'none'">
          <option value="unpaid" ${b.status!=='paid'?'selected':''}>Unpaid</option>
          <option value="paid" ${b.status==='paid'?'selected':''}>Paid</option>
        </select>
      </div>
      <div class="field full" id="bi-pd-wrap-${i}" style="display:${b.status==='paid'?'block':'none'}"><label>Date Paid</label><input type="date" id="bi-paidDate-${i}" value="${b.paidDate||''}"></div>
      <div class="field full"><label>Remark <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" id="bi-remark-${i}" value="${esc(b.remark||'')}" placeholder="e.g. Partial payment received"></div>
      <div class="field full"><label>Google Drive Scan Link <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" id="bi-scanLink-${i}" value="${esc(b.scanLink||'')}" placeholder="https://drive.google.com/..."></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-cancel" style="flex:1;padding:9px;" onclick="document.getElementById('bill-edit-inline-${i}').style.display='none'">Cancel</button>
      <button class="btn-save" style="flex:2;padding:9px;" onclick="saveBillEdit(${i})">Save</button>
    </div>
  </div>`;
}

async function saveBillEdit(i){
  const t=tenants.find(t=>t.id===editingId); if(!t||!t.bills[i]) return;
  const label=document.getElementById('bi-label-'+i).value.trim();
  if(!label){ showToast('Please enter a bill description.', false); return; }
  const _amt = normalizeAmount(document.getElementById('bi-amount-'+i).value);
  const _raw = Number(String(document.getElementById('bi-amount-'+i).value).replace(/,/g,''));
  if(_raw < 0){ showToast('Amount cannot be negative.', false); return; }
  if(_amt===0 && !confirm('Amount is ₱0. Save anyway?')) return;
  const newStatus=document.getElementById('bi-status-'+i).value==='paid'?'paid':'unpaid';
  const pdInput=document.getElementById('bi-paidDate-'+i);
  const paidDate=newStatus==='paid'?(pdInput?pdInput.value||new Date().toISOString().slice(0,10):new Date().toISOString().slice(0,10)):'';
  let remark=document.getElementById('bi-remark-'+i).value.trim();
  // Auto-clear "pending amount" remark when a real amount is entered
  if(_amt > 0 && remark.toLowerCase().includes('pending amount')) remark = '';
  const due=document.getElementById('bi-due-'+i).value;
  const scanLink=(function(v){return /^https:\/\//i.test(v)?v:'';})(document.getElementById('bi-scanLink-'+i).value.trim());
  const ok = await saveBills(editingId, bills=>{
    if(!bills[i]) return;
    bills[i]={...bills[i],label,amount:_amt,due,status:newStatus,remark,scanLink,paidDate};
  }, 'Bill updated.');
  if(ok){ renderBillListItems(); rerenderAdmin(); }
}

async function deleteBillFromList(i){
  if(!confirm('Delete this bill? This cannot be undone.')) return;
  const ok = await saveBills(editingId, bills=>{ bills.splice(i,1); }, 'Bill deleted.');
  if(ok){ renderBillListItems(); rerenderAdmin(); }
}

function startNewBill(){
  document.getElementById('btn-start-new-bill').style.display='none';
  const c=document.getElementById('new-bill-inline'); c.style.display='block';
  c.innerHTML=`<div class="bill-edit-form">
    <div class="form-grid">
      <div class="field"><label>Description</label><input type="text" id="nb-label" placeholder="e.g. Monthly Rent" autocomplete="off"></div>
      <div class="field"><label>Amount (&#8369;)</label><input type="text" id="nb-amount" placeholder="0" inputmode="decimal" pattern="[0-9.]*" autocomplete="off"></div>
      <div class="field"><label>Due Date</label><input type="date" id="nb-due"></div>
      <div class="field"><label>Status</label>
        <select id="nb-status" onchange="document.getElementById('nb-pd-wrap').style.display=this.value==='paid'?'block':'none'">
          <option value="unpaid" selected>Unpaid</option>
          <option value="paid">Paid</option>
        </select>
      </div>
      <div class="field full" id="nb-pd-wrap" style="display:none"><label>Date Paid</label><input type="date" id="nb-paidDate"></div>
      <div class="field full"><label>Remark <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" id="nb-remark" placeholder="e.g. Partial payment received"></div>
      <div class="field full"><label>Google Drive Scan Link <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" id="nb-scanLink" placeholder="https://drive.google.com/..."></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-cancel" style="flex:1;padding:9px;" onclick="cancelNewBill()">Cancel</button>
      <button class="btn-save" style="flex:2;padding:9px;" onclick="saveNewBill()">Add Bill</button>
    </div>
  </div>`;
}

function cancelNewBill(){
  const inlineEl = document.getElementById('new-bill-inline');
  const btnEl    = document.getElementById('btn-start-new-bill');
  if(inlineEl) inlineEl.style.display='none';
  if(btnEl)    btnEl.style.display='block';
}

async function saveNewBill(){
  const label=document.getElementById('nb-label').value.trim(); if(!label){showToast('Please enter a bill description.',false);return;}
  const _rawNb = Number(String(document.getElementById('nb-amount').value).replace(/,/g,''));
  if(_rawNb < 0){ showToast('Amount cannot be negative.', false); return; }
  const _nbAmt = normalizeAmount(document.getElementById('nb-amount').value);
  if(_nbAmt===0 && !confirm('Amount is ₱0. Add this bill anyway?')) return;
  const status=document.getElementById('nb-status').value==='paid'?'paid':'unpaid';
  const paidDate=status==='paid'?(document.getElementById('nb-paidDate').value||new Date().toISOString().slice(0,10)):'';
  const bill={label,amount:normalizeAmount(document.getElementById('nb-amount').value),due:document.getElementById('nb-due').value,status,remark:document.getElementById('nb-remark').value.trim(),scanLink:(function(v){return /^https:\/\//i.test(v)?v:'';})(document.getElementById('nb-scanLink').value.trim()),paidDate,payments:[]};
  const ok = await saveBills(editingId, bills=>{ bills.push(bill); }, 'Bill added.');
  if(ok){ cancelNewBill(); renderBillListItems(); rerenderAdmin(); }
}
function addBillForm(){ billForms.push({label:'',amount:'',due:'',status:'unpaid'}); renderBillForms(); }
function removeBill(i){ billForms.splice(i,1); renderBillForms(); }
function renderBillForms(){
  document.getElementById('bill-forms').innerHTML=billForms.map((b,i)=>`
    <div class="bill-item">
      <div class="field"><label>Description</label><input type="text" value="${esc(b.label)}" placeholder="e.g. Monthly Rent" oninput="billForms[${i}].label=this.value"></div>
      <div class="field"><label>Amount (&#8369;)</label><input type="text" value="${b.amount}" placeholder="0" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" oninput="billForms[${i}].amount=this.value"></div>
      <div class="field"><label>Due Date</label><input type="date" value="${b.due||''}" onchange="billForms[${i}].due=this.value"></div>
      <div class="field"><label>Status</label>
        <select id="bf-status-${i}" onchange="billForms[${i}].status=this.value;document.getElementById('bf-pd-${i}').style.display=this.value==='paid'?'block':'none'">
          <option value="unpaid"  ${b.status!=='paid'?'selected':''}>Unpaid</option>
          <option value="paid"    ${b.status==='paid'?'selected':''}>Paid</option>
        </select>
      </div>
      <div class="field bill-remark-field" id="bf-pd-${i}" style="display:${b.status==='paid'?'block':'none'}">
        <label>Date Paid</label>
        <input type="date" value="${b.paidDate||''}" onchange="billForms[${i}].paidDate=this.value">
      </div>
      <div class="field bill-remark-field"><label>Remark <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" value="${esc(b.remark||'')}" placeholder="e.g. Partial payment of ₱2,000 received" oninput="billForms[${i}].remark=this.value"></div>
      <div class="field bill-remark-field"><label>Google Drive Scan Link <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" value="${esc(b.scanLink||'')}" placeholder="https://drive.google.com/..." oninput="billForms[${i}].scanLink=this.value"></div>
      <button class="btn-rm" onclick="removeBill(${i})">×</button>
    </div>`).join('');
}
async function saveTenant(){
  const name=document.getElementById('m-name').value.trim();
  const unit=document.getElementById('m-unit').value.trim();
  const code=document.getElementById('m-code').value.trim().toUpperCase();
  const phone=document.getElementById('m-phone').value.trim();
  const email=document.getElementById('m-email').value.trim();
  const move_in_date=document.getElementById('m-movein').value||null;
  if(!name||!unit||!code){showToast('Please fill in name, unit, and access code.',false);return;}
  if(tenants.find(t=>t.code===code&&t.id!==editingId)){showToast('That access code is already in use.',false);return;}
  const savingId = editingId; // capture before closeModal() nullifies it
  // When editing, use the tenant's current bills from memory (not billForms)
  let bills;
  if(savingId) {
    const existing = tenants.find(t=>t.id===savingId);
    bills = existing ? existing.bills : [];
  } else {
    bills = billForms.filter(b=>b.label).map(b=>({
      label:    b.label.trim(),
      amount:   normalizeAmount(b.amount),
      due:      b.due||'',
      status:   b.status==='paid'?'paid':'unpaid',
      remark:   (b.remark||'').trim(),
      scanLink: /^https:\/\//i.test((b.scanLink||'').trim()) ? (b.scanLink||'').trim() : '',
      paidDate: b.status==='paid' ? (b.paidDate || new Date().toISOString().slice(0,10)) : '',
      payments: []
    }));
    const negative = billForms.find(b=>b.label && Number(String(b.amount||'').replace(/,/g,'')) < 0);
    if(negative){ showToast('Amount for "' + negative.label + '" cannot be negative.', false); return; }
    const dropped = billForms.filter(b=>!b.label && (b.amount || b.due));
    if(dropped.length){ showToast(dropped.length + ' bill(s) dropped — missing description.', false); }
    const zeroBill = bills.find(b=>Number(b.amount)===0);
    if(zeroBill && !confirm('Bill "' + zeroBill.label + '" has amount ₱0. Save anyway?')) return;
  }
  const existingTemplates = savingId ? (tenants.find(t=>t.id===savingId)?.templates||[]) : [];
  setLoading(true, savingId?'Saving changes…':'Adding tenant…');
  try {
    if(savingId){
      await dbUpdate(savingId,{name,unit,code,phone,email,move_in_date,bills,templates:existingTemplates});
      tenants=tenants.map(t=>t.id===savingId?{...t,name,unit,code,phone,email,move_in_date,bills,templates:existingTemplates}:t);
      setLoading(false);
      closeModal();
      showToast('Changes saved.');
    } else {
      const rec={id:uid(),name,unit,code,phone,email,move_in_date,bills,templates:[]};
      await dbInsert(rec);
      tenants.push(rec);
      setLoading(false);
      closeModal();
      showToast('Tenant added.');
    }
    rerenderAdmin();
  } catch(e){
    setLoading(false);
    showToast('Error: '+e.message, false);
    // Modal stays open so the admin can correct and retry without re-typing.
  }
}
function generateCode(){ document.getElementById('m-code').value=randCode(); }

// ─────────────────────────────────────────────
// QUICK ADD BILL
// One-screen flow: pick tenant, describe, amount, due — done. Reachable from
// the toolbar and from every tenant row, so adding a bill never requires
// opening the edit modal and hunting through tabs.
// ─────────────────────────────────────────────
function openQuickBill(tid){
  if(!tenants.length){ showToast('Add a tenant first.', false); return; }
  const sel = document.getElementById('qb-tenant');
  const sorted = tenants.slice().sort((a,b)=>unitRank(a.unit)-unitRank(b.unit));
  sel.innerHTML = sorted.map(t=>`<option value="${esc(t.id)}"${tid===t.id?' selected':''}>${esc(t.name)} · Unit ${esc(t.unit)}</option>`).join('');
  // Label suggestions: template labels first, then distinct recent bill labels.
  const seen = new Set(); const sugg = [];
  const addSugg = s => { const k=(s||'').trim(); if(k && !seen.has(k.toLowerCase())){ seen.add(k.toLowerCase()); sugg.push(k); } };
  tenants.forEach(t=>(t.templates||[]).forEach(x=>addSugg(x.label)));
  tenants.forEach(t=>(t.bills||[]).slice().reverse().forEach(b=>addSugg(b.label)));
  document.getElementById('qb-label-suggestions').innerHTML = sugg.slice(0,12).map(s=>`<option value="${esc(s)}">`).join('');
  // Reset fields
  document.getElementById('qb-label').value='';
  document.getElementById('qb-amount').value='';
  document.getElementById('qb-due').value='';
  document.getElementById('qb-remark').value='';
  document.getElementById('qb-scan').value='';
  document.getElementById('qb-paid').checked=false;
  document.getElementById('qb-paiddate-wrap').style.display='none';
  document.getElementById('qb-paiddate').value='';
  const more = document.getElementById('qb-more'); if(more) more.open = false;
  openModal('addbill-modal');
}
function closeQuickBill(){ closeModalEl('addbill-modal'); }
function qbTogglePaid(cb){
  document.getElementById('qb-paiddate-wrap').style.display = cb.checked ? 'block' : 'none';
  if(cb.checked && !document.getElementById('qb-paiddate').value){
    document.getElementById('qb-paiddate').value = new Date().toISOString().slice(0,10);
  }
}
// When the label matches one of this tenant's templates, prefill amount and due date.
function qbAutofill(){
  const label = document.getElementById('qb-label').value.trim().toLowerCase();
  if(!label) return;
  const t = tenants.find(t=>t.id===document.getElementById('qb-tenant').value);
  const tmpl = ((t&&t.templates)||[]).find(x=>(x.label||'').trim().toLowerCase()===label);
  if(!tmpl) return;
  const amtEl = document.getElementById('qb-amount');
  if(!amtEl.value && !tmpl.pendingAmount && Number(tmpl.amount)>0) amtEl.value = tmpl.amount;
  const dueEl = document.getElementById('qb-due');
  if(!dueEl.value && tmpl.dayOfMonth){
    const now = new Date();
    const day = Math.min(Number(tmpl.dayOfMonth), new Date(now.getFullYear(), now.getMonth()+1, 0).getDate());
    dueEl.value = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
}
async function saveQuickBill(addAnother){
  const tid   = document.getElementById('qb-tenant').value;
  const label = document.getElementById('qb-label').value.trim();
  const t = tenants.find(t=>t.id===tid);
  if(!t){ showToast('Please choose a tenant.', false); return; }
  if(!label){ showToast('Please enter a bill description.', false); return; }
  const rawAmt = Number(String(document.getElementById('qb-amount').value).replace(/,/g,''));
  if(rawAmt < 0){ showToast('Amount cannot be negative.', false); return; }
  const amount = normalizeAmount(document.getElementById('qb-amount').value);
  if(amount===0 && !confirm('Amount is ₱0. Add this bill anyway?')) return;
  const due = document.getElementById('qb-due').value;
  // Duplicate guard: same label already billed to this tenant in the same month.
  if(due){
    const dup = t.bills.some(b=>(b.label||'').trim().toLowerCase()===label.toLowerCase() && b.due && b.due.slice(0,7)===due.slice(0,7));
    if(dup && !confirm(t.name+' already has a "'+label+'" bill due '+new Date(due.slice(0,7)+'-02').toLocaleString('default',{month:'long',year:'numeric'})+'. Add another?')) return;
  }
  const isPaid = document.getElementById('qb-paid').checked;
  const paidDate = isPaid ? (document.getElementById('qb-paiddate').value || new Date().toISOString().slice(0,10)) : '';
  const scan = document.getElementById('qb-scan').value.trim();
  const bill = { label, amount, due, status: isPaid?'paid':'unpaid',
    remark: document.getElementById('qb-remark').value.trim(),
    scanLink: /^https:\/\//i.test(scan)?scan:'', paidDate, payments: [] };
  const ok = await saveBills(tid, bills=>{ bills.push(bill); }, 'Bill added for '+t.name+'.');
  if(!ok) return;
  rerenderAdmin();
  if(addAnother){
    document.getElementById('qb-label').value='';
    document.getElementById('qb-amount').value='';
    document.getElementById('qb-remark').value='';
    document.getElementById('qb-scan').value='';
    document.getElementById('qb-paid').checked=false;
    document.getElementById('qb-paiddate-wrap').style.display='none';
    document.getElementById('qb-label').focus();
  } else {
    closeQuickBill();
  }
}


// ─────────────────────────────────────────────
// TIMELINE BUILDER (global so showFullTimeline can access it)
// ─────────────────────────────────────────────
function buildTimeline(bills, showAll) {
  const sorted = bills.slice().sort((a,b)=>{
    const da = a.paidDate||a.due||''; const db = b.paidDate||b.due||'';
    return db.localeCompare(da);
  });
  const groups = {};
  const groupOrder = [];
  sorted.forEach(b => {
    const d = b.paidDate||b.due||'';
    const key = d ? new Date(d+'T00:00:00').toLocaleString('default',{month:'long',year:'numeric'}) : 'Unknown date';
    if(!groups[key]){ groups[key]=[]; groupOrder.push(key); }
    groups[key].push(b);
  });
  const LIMIT = 3;
  const visible = showAll ? groupOrder : groupOrder.slice(0,LIMIT);
  const hidden  = groupOrder.length - visible.length;
  const html = visible.map(month =>
    '<div class="timeline-month-group"><div class="timeline-month-label">'+month+'</div>'+
    groups[month].map(b=>
      '<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-info">'+
      '<div class="timeline-label">'+esc(b.label)+'</div>'+
      '<div class="timeline-date">'+(b.paidDate?'Paid '+formatDate(b.paidDate):b.due?'Billed '+formatDate(b.due):'')+'</div>'+
      ((b.payments&&b.payments.length)?b.payments.map(p=>'<div style="font-size:11px;color:var(--muted);margin-top:2px;">&#8369;'+Number(p.amount).toLocaleString()+' &nbsp;&middot;&nbsp; '+formatDate(p.date)+(p.note?' &nbsp;&middot;&nbsp; '+esc(p.note):'')+' </div>').join(''):'')+
      (b.remark?'<div style="font-size:11px;color:var(--muted);margin-top:3px;font-style:italic;">'+esc(b.remark)+'</div>':'')+
      '</div><div class="timeline-amount">&#8369;'+Number(b.amount).toLocaleString()+'</div></div>'
    ).join('')+'</div>'
  ).join('');
  const moreBtn = (!showAll && hidden>0)
    ? '<button class="timeline-show-more" onclick="showFullTimeline(true)">Show full history &nbsp;('+hidden+' more month'+(hidden>1?'s':'')+')</button>'
    : (showAll && groupOrder.length > LIMIT ? '<button class="timeline-show-more" onclick="showFullTimeline(false)">Show less</button>' : '');
  return html + moreBtn;
}


function renderTenant(){
  const t=currentUser; if(!t) return;

  // All unpaid bills (for summary stats)
  const allActiveBills = t.bills.filter(b=>b.status!=='paid');
  const paidBills = t.bills.filter(b=>b.status==='paid');

  // Balance summary calculations
  const now = new Date(); const curYM = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const thisMonthBills = allActiveBills.filter(b=>b.due&&b.due.startsWith(curYM));
  const overdueBills   = allActiveBills.filter(b=>getDueStatus(b)==='overdue');
  const thisMonthDue   = thisMonthBills.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  const overdueDue     = overdueBills.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  const totalDue       = allActiveBills.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);

  // Month pill list — derive from all bills with a due date
  const monthSet = new Set();
  t.bills.filter(b=>b.due&&b.status!=='paid').forEach(b=>monthSet.add(b.due.slice(0,7)));
  const monthList = Array.from(monthSet).sort().reverse(); // newest first

  // Resolve active filter month
  const activeYM = portalMonth==='current' ? curYM : portalMonth;
  const emptyMsg = portalMonth==='all' ? 'All bills are settled.' : ('No bills for '+new Date(activeYM+'-02').toLocaleString('default',{month:'long',year:'numeric'})+'.');
  const footerLabel = portalMonth!=='all' ? 'Balance Due (shown)' : 'Balance Due';

  // Filter + sort active bills for display
  function sortByUrgency(bills) {
    return bills.slice().sort((a,b)=>getDueUrgencyScore(a)-getDueUrgencyScore(b));
  }
  const activeBills = sortByUrgency(
    portalMonth==='all'
      ? allActiveBills
      : allActiveBills.filter(b=>b.due&&b.due.startsWith(activeYM))
  );
  const due = activeBills.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);

  function dueMeta(b) {
    const s = getDueStatus(b);
    const d = b.due ? formatDate(b.due) : '';
    if(s==='no-date')   return {chip:'', cls:''};
    if(s==='overdue')   return {chip:'Overdue · '+d,  cls:'overdue'};
    if(s==='due-today') return {chip:'Due Today · '+d, cls:'today'};
    if(s==='due-soon')  return {chip:'Due Soon · '+d,  cls:'soon'};
    return {chip:'Due '+d, cls:'normal'};
  }

  const billRow = b => {
    const dm = dueMeta(b);
    const isPendingRemark = b.remark && b.remark.toLowerCase().includes('pending amount');
    const amountHtml = (Number(b.amount)===0&&isPendingRemark)
      ? '<span class="pbill-pending-inline">TBD</span>'
      : '&#8369;'+Number(b.amount).toLocaleString();
    const chipHtml = b.due
      ? `<span class="due-chip ${dm.cls}">${dm.chip}</span>`
      : '<span class="pbill-due">No due date set</span>';
    const remarkHtml = isPendingRemark
      ? '<span class="pbill-pending-inline">&#9888; Amount pending</span>'
      : b.remark ? `<span class="pbill-meta-note">${esc(b.remark)}</span>` : '';
    const _safeLink = b.scanLink && /^https:\/\//i.test(b.scanLink) ? b.scanLink : '';
    const scanHtml = _safeLink
      ? `<a class="pbill-scan-link" href="${esc(_safeLink)}" target="_blank" rel="noopener"><span class="pbill-scan-link-icon">&#128196;</span>View Bill</a>`
      : '';
    const _paid = billTotalPaid(b);
    const _rem  = billRemaining(b);
    const hasPartialPayments = _paid > 0 && b.status !== 'paid';
    const partialHtml = hasPartialPayments
      ? `<span style="font-size:11px;font-weight:600;display:inline-flex;gap:10px;flex-wrap:wrap;margin-top:3px;">` +
        `<span style="color:var(--green);">&#8369;${_paid.toLocaleString()} paid</span>` +
        (_rem > 0 ? `<span style="color:var(--orange);">&#8369;${_rem.toLocaleString()} still due</span>` : `<span style="color:var(--green);">Settled</span>`) +
        `</span>`
      : '';
    const paymentEntriesHtml = (b.payments&&b.payments.length&&b.status!=='paid')
      ? `<div style="margin-top:6px;width:100%;">${b.payments.map(p=>`<div style="font-size:11px;color:var(--muted);padding:3px 0;display:flex;gap:8px;align-items:center;"><span style="flex-shrink:0;">${formatDate(p.date)}</span><span style="color:var(--green);font-weight:600;flex-shrink:0;">&#8369;${Number(p.amount).toLocaleString()} paid</span>${p.note?`<span style="font-style:italic;">${esc(p.note)}</span>`:''}</div>`).join('')}</div>`
      : '';
    return `<div class="portal-bill-row">
      <div class="pbill-top">
        <div class="pbill-label">${esc(b.label)}</div>
        <div class="pbill-amount">${amountHtml}</div>
      </div>
      <div class="pbill-bottom">
        ${chipHtml}
        ${partialHtml}
        ${remarkHtml}
        ${scanHtml}
      </div>
      ${paymentEntriesHtml}
    </div>`;
  };

  // Month pill HTML
  const monthPills = `
    <div class="month-pill-wrap">
      <button class="month-pill ${portalMonth==='all'?'active':''}" onclick="setPortalMonth('all')">All</button>
      ${monthList.map(ym=>`<button class="month-pill ${(portalMonth==='current'&&ym===curYM)||(portalMonth===ym)?'active':''}" onclick="setPortalMonth('${ym}')">${new Date(ym+'-02').toLocaleString('default',{month:'short',year:'numeric'})}</button>`).join('')}
    </div>`;

  document.getElementById('main-content').innerHTML=`
    <div class="portal-wrap">
      <div class="page-eyebrow">Tenant Portal</div>
      <div class="page-title">${esc(t.name)}</div>
      <div class="portal-pull">
        <div class="portal-pull-text">"Your bills, clearly laid out."</div>
        <div class="portal-pull-sub">Unit ${esc(t.unit)} &nbsp;·&nbsp; Contact management if anything looks incorrect.</div>
      </div>
      <div class="portal-balance-strip">
        <div class="portal-bal-stat">
          <div class="portal-bal-label">This Month</div>
          <div class="portal-bal-value ${thisMonthDue===0?'clear':''}">${thisMonthDue?'&#8369;'+thisMonthDue.toLocaleString():'Settled'}</div>
        </div>
        <div class="portal-bal-stat">
          <div class="portal-bal-label">Overdue</div>
          <div class="portal-bal-value ${overdueDue>0?'overdue':'clear'}">${overdueDue?'&#8369;'+overdueDue.toLocaleString():'None'}</div>
        </div>
        <div class="portal-bal-stat">
          <div class="portal-bal-label">Total Outstanding</div>
          <div class="portal-bal-value ${totalDue===0?'clear':''}">${totalDue?'&#8369;'+totalDue.toLocaleString():'Settled'}</div>
        </div>
      </div>
      <div class="bills-card">
        <div class="bills-card-head">
          <div class="bills-card-head-row">
            <div class="bills-card-title">Statement of Account</div>
            <div class="bills-count">${activeBills.length} bill${activeBills.length!==1?'s':''}</div>
          </div>
          ${monthList.length > 1 ? monthPills : ''}
        </div>
        ${activeBills.length
          ? activeBills.map(billRow).join('')
          : `<div class="empty-state" style="padding:32px 24px"><div class="icon" style="font-size:24px;margin-bottom:8px">&#10003;</div><p>${emptyMsg}</p></div>`}
        <div class="bills-footer">
          <div class="footer-label">${footerLabel}</div>
          <div class="footer-total">${due?'&#8369;'+due.toLocaleString():'Settled'}</div>

        </div>
      </div>
      ${paymentInstructions ? `
      <div class="portal-pay-inst">
        <div class="portal-pay-inst-eyebrow">Payment Instructions</div>
        <div class="portal-pay-inst-title">How to pay your bills</div>
        <div class="portal-pay-inst-body">${esc(paymentInstructions)}</div>
      </div>` : ''}
      ${paidBills.length ? `
      <div class="timeline-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--border);">
          <div class="timeline-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">Payment History</div>
          <button onclick="openStmtModal(currentUser)" class="btn-statement" style="font-size:11px;">Generate Statement</button>
        </div>
        ${buildTimeline(paidBills, false)}
      </div>` : ''}
    </div>`;
}

function uid() {
  if(crypto.randomUUID) return crypto.randomUUID();
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b=>b.toString(16).padStart(2,'0')).join('');
}
function normalizeAmount(val) {
  // Accept "1,234.50" plus plain numbers; reject negatives.
  if(val == null) return 0;
  const cleaned = String(val).replace(/,/g,'').trim();
  const n = Number(cleaned);
  if(isNaN(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function randCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const pick = b => c[b % c.length];
  return Array.from(buf.slice(0,4), pick).join('') + '-' + Array.from(buf.slice(4), pick).join('');
}
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDate(d) {
  if(!d) return '';
  const dateStr = String(d).slice(0,10);
  const dt = new Date(dateStr+'T00:00:00');
  if(isNaN(dt.getTime())) {
    console.warn('formatDate: invalid date', d);
    return String(d);
  }
  return dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'});
}
document.addEventListener('DOMContentLoaded',()=>{
  const _wire = (id, fn) => { const el=document.getElementById(id); if(el) el.addEventListener('click',e=>{if(e.target===el)fn();}); };
  _wire('tenant-modal',  closeModal);
  _wire('paiddate-modal', closePaidModal);
  _wire('payinst-modal', closePayInstModal);
  _wire('stmt-modal',    closeStmtModal);
  _wire('genbills-modal', closeGenModal);
  _wire('addbill-modal', closeQuickBill);

  // Detect Supabase password recovery redirect
  checkPasswordRecovery();
});

async function checkPasswordRecovery() {
  const hash = window.location.hash.substring(1);
  if(!hash) return;
  const params = new URLSearchParams(hash);
  const type = params.get('type');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if(type !== 'recovery' || !accessToken) return;

  if(!refreshToken) {
    console.warn('Password-recovery link missing refresh_token; the session may not persist.');
  }
  // Set the session from the recovery token
  try {
    await _sbClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' });
  } catch(e) {
    document.getElementById('login-error').textContent = 'Recovery link expired or invalid. Please request a new one.';
    return;
  }

  // Clear the hash from URL
  history.replaceState(null, '', window.location.pathname);

  // Show password reset form
  const loginWrap = document.querySelector('.login-wrap');
  loginWrap.innerHTML = `
    <div class="login-wordmark">Orange Apartment</div>
    <h1 class="login-heading">Set a new password</h1>
    <p class="login-sub">Enter your new password below.</p>
    <div class="field">
      <label>New Password</label>
      <input type="password" id="reset-pw" placeholder="Enter new password" onkeydown="if(event.key==='Enter')submitPasswordReset()">
    </div>
    <div class="field">
      <label>Confirm Password</label>
      <input type="password" id="reset-pw-confirm" placeholder="Confirm new password" onkeydown="if(event.key==='Enter')submitPasswordReset()">
    </div>
    <button class="btn-primary" onclick="submitPasswordReset()">Update Password</button>
    <div class="login-error" id="reset-error"></div>
    <div class="powered-by powered-by-login">Powered by JEZ</div>
  `;
}

async function submitPasswordReset() {
  const pw = document.getElementById('reset-pw').value;
  const confirmValue = document.getElementById('reset-pw-confirm').value;
  const errEl = document.getElementById('reset-error');
  errEl.textContent = '';
  if(!pw || pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if(pw !== confirmValue) { errEl.textContent = 'Passwords do not match.'; return; }
  setLoading(true, 'Updating password…');
  try {
    const { error } = await _sbClient.auth.updateUser({ password: pw });
    setLoading(false);
    if(error) { errEl.textContent = error.message; return; }
    await _sbClient.auth.signOut();
    showToast('Password updated. Please sign in with your new password.');
    setTimeout(() => location.reload(), 2000);
  } catch(e) {
    setLoading(false);
    errEl.textContent = 'Update failed: ' + e.message;
  }
}

let _lastWidth = window.innerWidth, _rt;
window.addEventListener('resize',()=>{
  clearTimeout(_rt);
  _rt = setTimeout(()=>{
    const w = window.innerWidth;
    const crossed = (_lastWidth<=768&&w>768)||(_lastWidth>768&&w<=768);
    _lastWidth = w;
    if(crossed && currentUser==='admin') renderRows();
  }, 250);
});

// ─────────────────────────────────────────────
// PAYMENT REMINDER GENERATOR
// Builds a ready-to-send message with the tenant's outstanding bills and the
// payment instructions, and copies it to the clipboard so the landlord can
// paste it straight into SMS / Messenger / Viber.
// ─────────────────────────────────────────────
function buildReminderText(t){
  const active = t.bills
    .filter(b=>b.status!=='paid' && Math.max(0,billRemaining(b))>0)
    .sort((a,b)=>getDueUrgencyScore(a)-getDueUrgencyScore(b));
  if(!active.length) return null;
  const lines = active.map(b=>{
    const late = daysOverdue(b);
    const partial = billTotalPaid(b) > 0 ? ' (₱'+billTotalPaid(b).toLocaleString()+' already received)' : '';
    return '• '+b.label+' — ₱'+Math.max(0,billRemaining(b)).toLocaleString()
      + (b.due ? ', due '+formatDate(b.due) : '')
      + (late>0 ? ' ('+late+' day'+(late>1?'s':'')+' overdue)' : '')
      + partial;
  });
  const total = active.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  return 'Hi '+t.name+', this is a friendly reminder from Orange Apartment.\n\n'
    + 'Outstanding bills for Unit '+t.unit+':\n'
    + lines.join('\n') + '\n\n'
    + 'Total due: ₱'+total.toLocaleString()
    + (paymentInstructions ? '\n\nHow to pay:\n'+paymentInstructions : '')
    + '\n\nThank you!';
}
async function copyReminder(tid){
  const t = tenants.find(t=>t.id===tid); if(!t) return;
  const text = buildReminderText(t);
  if(!text){ showToast('No outstanding balance for '+t.name+'.'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Reminder for '+t.name+' copied — paste into SMS / Messenger / Viber.');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Reminder for '+t.name+' copied — paste into SMS / Messenger / Viber.'); }
    catch { showToast('Could not copy automatically.', false); }
    ta.remove();
  }
}

// ─────────────────────────────────────────────
// QUICK MARK PAID (from Action Required)
// ─────────────────────────────────────────────
function quickMarkPaid(tid, bi) {
  const t = tenants.find(t=>t.id===tid);
  if(!t||!t.bills[bi]) return;
  _pendingPaid = {tid, bi};
  document.getElementById('paiddate-bill-name').textContent = t.bills[bi].label + ' — ' + t.name;
  document.getElementById('paiddate-input').value = new Date().toISOString().slice(0,10);
  openModal('paiddate-modal');
}

// ─────────────────────────────────────────────
// TEMPLATE MANAGEMENT
// ─────────────────────────────────────────────
const SCHEMA_NOTE = 'Templates column missing in Supabase. Run this SQL in your Supabase dashboard:\n\nALTER TABLE tenants ADD COLUMN IF NOT EXISTS templates jsonb NOT NULL DEFAULT \'[]\';\n\nThen refresh and try again.';
// Error message for missing templates column

function renderTemplateList() {
  const t = tenants.find(t=>t.id===editingId); if(!t) return;
  const tmpls = t.templates || [];
  const c = document.getElementById('tmpl-list');
  if(!tmpls.length) {
    c.innerHTML = '<div class="tmpl-empty">No templates yet. Add one to auto-generate recurring bills.</div>';
    return;
  }
  c.innerHTML = tmpls.map((tmpl,i) => `
    <div class="tmpl-item">
      <div class="tmpl-info">
        <div class="tmpl-label">${esc(tmpl.label)}</div>
        <div class="tmpl-meta">
          ${tmpl.pendingAmount ? '<span style="color:var(--orange);font-weight:600;">Pending amount</span>' : '&#8369;'+Number(tmpl.amount).toLocaleString()}
          &nbsp;·&nbsp; Due on day ${tmpl.dayOfMonth} of each month
        </div>
      </div>
      <div style="display:flex;gap:5px">
        <button class="btn-icon" onclick="editTemplateInline(${i})" aria-label="Edit">&#9998;</button>
        <button class="btn-icon del" onclick="deleteTemplate(${i})" aria-label="Delete">&#10005;</button>
      </div>
    </div>
    <div id="tmpl-edit-inline-${i}" style="display:none"></div>
  `).join('');
}

function editTemplateInline(i) {
  document.querySelectorAll('[id^="tmpl-edit-inline-"]').forEach(el=>el.style.display='none');
  const t = tenants.find(t=>t.id===editingId); if(!t||!t.templates||!t.templates[i]) return;
  const tmpl = t.templates[i];
  const el = document.getElementById('tmpl-edit-inline-'+i);
  el.style.display = 'block';
  el.innerHTML = `<div class="tmpl-edit-form">
    <div class="form-grid">
      <div class="field"><label>Description</label><input type="text" id="te-label-${i}" value="${esc(tmpl.label)}" placeholder="e.g. Monthly Rent"></div>
      <div class="field"><label>Amount (&#8369;)</label><input type="text" id="te-amount-${i}" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" value="${tmpl.pendingAmount?'':tmpl.amount}" step="0.01" ${tmpl.pendingAmount?'disabled style="opacity:0.4"':''}></div>
      <div class="field"><label>Due Day of Month <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(auto-caps to last day for shorter months)</span></label><input type="number" id="te-day-${i}" value="${tmpl.dayOfMonth}" min="1" max="31" placeholder="1-31"></div>
      <div class="field full" style="display:flex;align-items:center;gap:10px;padding-top:4px;">
        <input type="checkbox" id="te-pending-${i}" ${tmpl.pendingAmount?'checked':''} onchange="(function(){var a=document.getElementById('te-amount-${i}');a.disabled=this.checked;a.style.opacity=this.checked?'0.4':'1';}).call(this)" style="width:15px;height:15px;accent-color:var(--blue);cursor:pointer;">
        <label for="te-pending-${i}" style="font-size:11px;font-weight:600;letter-spacing:0.05em;color:var(--navy);cursor:pointer;text-transform:uppercase;">Pending amount <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(bill created with no amount; you update it when the bill arrives)</span></label>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-cancel" style="flex:1;padding:9px;" onclick="document.getElementById('tmpl-edit-inline-${i}').style.display='none'">Cancel</button>
      <button class="btn-save" style="flex:2;padding:9px;" onclick="saveTemplateEdit(${i})">Save</button>
    </div>
  </div>`;
}


function templateSaveErr(e) {
  if(e.message.includes('templates')) { alert(SCHEMA_NOTE); }
  else { showToast('Save failed: '+e.message, false); }
}

async function saveTemplateEdit(i) {
  const _isPending = (function(){ const el=document.getElementById('te-pending-'+i); return el?el.checked:false; })();
  const amt = _isPending ? 1 : Number(document.getElementById('te-amount-'+i).value);
  if(!_isPending&&amt===0){if(!confirm('The amount is currently set to ₱0. Save anyway?')) return;}
  const day = Number(document.getElementById('te-day-'+i).value);
  if(!day||day<1||day>31){showToast('Due day must be between 1 and 31.',false);return;}
  const t = tenants.find(t=>t.id===editingId); if(!t||!t.templates||!t.templates[i]) return;
  t.templates[i] = {
    ...t.templates[i],
    label:  document.getElementById('te-label-'+i).value.trim(),
    amount: _isPending ? 0 : amt, dayOfMonth: day,
    pendingAmount: _isPending
  };
  try {
    await dbUpdate(t.id,{templates:t.templates});
    tenants = tenants.map(x=>x.id===t.id?t:x);
    showToast('Template saved.');
    renderTemplateList();
  } catch(e){ templateSaveErr(e); }
}

async function deleteTemplate(i) {
  if(!confirm('Delete this template?')) return;
  const t = tenants.find(t=>t.id===editingId); if(!t||!t.templates) return;
  t.templates.splice(i,1);
  try {
    await dbUpdate(t.id,{templates:t.templates});
    tenants = tenants.map(x=>x.id===t.id?t:x);
    showToast('Template deleted.');
    renderTemplateList();
    rerenderAdmin();
  } catch(e){ templateSaveErr(e); }
}

function startNewTemplate() {
  document.getElementById('btn-start-new-tmpl').style.display='none';
  const c = document.getElementById('new-tmpl-inline'); c.style.display='block';
  c.innerHTML = `<div class="tmpl-edit-form">
    <div class="form-grid">
      <div class="field"><label>Description</label><input type="text" id="nt-label" placeholder="e.g. Monthly Rent"></div>
      <div class="field"><label>Amount (&#8369;)</label><input type="text" id="nt-amount" placeholder="0" inputmode="decimal" pattern="[0-9.]*" autocomplete="off"></div>
      <div class="field"><label>Due Day of Month <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(use 28-31 for end-of-month; auto-caps to last day of shorter months)</span></label><input type="number" id="nt-day" placeholder="e.g. 1" min="1" max="31"></div>
      <div class="field full" style="display:flex;align-items:center;gap:10px;padding-top:4px;">
        <input type="checkbox" id="nt-pending" onchange="(function(){var a=document.getElementById('nt-amount');a.disabled=this.checked;a.style.opacity=this.checked?'0.4':'1';}).call(this)" style="width:15px;height:15px;accent-color:var(--blue);cursor:pointer;">
        <label for="nt-pending" style="font-size:11px;font-weight:600;letter-spacing:0.05em;color:var(--navy);cursor:pointer;text-transform:uppercase;">Pending amount <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(bill created with no amount; you update it when the bill arrives)</span></label>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn-cancel" style="flex:1;padding:9px;" onclick="cancelNewTemplate()">Cancel</button>
      <button class="btn-save" style="flex:2;padding:9px;" onclick="saveNewTemplate()">Add Template</button>
    </div>
  </div>`;
}

function cancelNewTemplate() {
  document.getElementById('new-tmpl-inline').style.display='none';
  document.getElementById('btn-start-new-tmpl').style.display='block';
}

async function saveNewTemplate() {
  const label = document.getElementById('nt-label').value.trim();
  if(!label){showToast('Please enter a template description.',false);return;}
  const _ntPending = document.getElementById('nt-pending') && document.getElementById('nt-pending').checked;
  const amt = _ntPending ? 1 : Number(document.getElementById('nt-amount').value);
  if(!_ntPending&&amt===0){ showToast('Note: amount is set to ₱0.',true); }
  const day = Number(document.getElementById('nt-day').value);
  if(!day||day<1||day>31){showToast('Due day must be between 1 and 31.',false);return;}
  const t = tenants.find(t=>t.id===editingId); if(!t) return;
  if(!t.templates) t.templates=[];
  t.templates.push({id:uid(), label, amount:_ntPending?0:amt, dayOfMonth:day, pendingAmount:_ntPending});
  try {
    await dbUpdate(t.id,{templates:t.templates});
    tenants = tenants.map(x=>x.id===t.id?t:x);
    showToast('Template added.');
    cancelNewTemplate();
    renderTemplateList();
    rerenderAdmin();
  } catch(e){ templateSaveErr(e); }
}

// ─────────────────────────────────────────────
// GENERATE BILLS MODAL
// ─────────────────────────────────────────────
function openGenModal() {
  const now = new Date();
  const ym = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('gen-month-input').value = ym;
  openModal('genbills-modal');
  refreshGenPreview();
}
function closeGenModal() { closeModalEl('genbills-modal'); }

function refreshGenPreview() {
  const val = document.getElementById('gen-month-input').value; // "YYYY-MM"
  if(!val) return;
  const [yr, mo] = val.split('-').map(Number);
  const monthName = new Date(yr,mo-1,1).toLocaleString('default',{month:'long',year:'numeric'});
  document.getElementById('genbills-title').textContent = 'Generate Bills — '+monthName;

  const groups = [];
  tenants.forEach(t => {
    const tmpls = t.templates||[];
    if(!tmpls.length) return;
    const rows = tmpls.map(tmpl => {
      // Check if a bill with the same label already exists with a due date in this month/year
      const dueDay = Math.min(tmpl.dayOfMonth, new Date(yr, mo, 0).getDate()); // cap to last day of month
      const dueDate = `${yr}-${String(mo).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`;
      const _normLabel = s => s.trim().toLowerCase();
      const alreadyExists = t.bills.some(b => _normLabel(b.label)===_normLabel(tmpl.label) && b.due && b.due.startsWith(`${yr}-${String(mo).padStart(2,'0')}`));
      return {tmpl, dueDate, alreadyExists};
    });
    groups.push({t, rows});
  });

  if(!groups.length) {
    document.getElementById('gen-preview-body').innerHTML = '<div class="gen-empty">No templates found. Open a tenant\'s edit modal and add templates first.</div>';
    return;
  }

  document.getElementById('gen-preview-body').innerHTML = groups.map((g,gi) => `
    <div class="gen-tenant-group">
      <div class="gen-tenant-name">${esc(g.t.name)} &nbsp;·&nbsp; Unit ${esc(g.t.unit)}</div>
      ${g.rows.map((r,ri) => `
        <div class="gen-bill-row${r.alreadyExists?' skipped':''}">
          <input type="checkbox" id="gen-cb-${gi}-${ri}" ${r.alreadyExists?'disabled':'checked'}>
          <div class="gen-bill-info">
            <div class="gen-bill-label">${esc(r.tmpl.label)}</div>
            ${r.alreadyExists
              ? `<div class="gen-bill-skip-note">⚠ Bill already exists this month — skipped</div>`
              : `<div class="gen-bill-due">Due ${formatDate(r.dueDate)}</div>`
            }
          </div>
          <div class="gen-bill-amount">${r.tmpl.pendingAmount ? '<span style="color:var(--orange);font-size:12px;font-weight:600;">Pending amount</span>' : '&#8369;'+Number(r.tmpl.amount).toLocaleString()}</div>
        </div>`).join('')}
    </div>`).join('');

  // Store the generation data for confirmGenerateBills
  document.getElementById('genbills-modal')._genData = {groups, yr, mo};
}

async function confirmGenerateBills() {
  const modal = document.getElementById('genbills-modal');
  const {groups} = modal._genData || {};
  if(!groups) return;

  // Build candidate bill arrays WITHOUT mutating live tenant objects yet.
  const pending = []; // [{tenant, newBills}]
  groups.forEach((g, gi) => {
    const additions = [];
    g.rows.forEach((r, ri) => {
      if(r.alreadyExists) return;
      const cb = document.getElementById(`gen-cb-${gi}-${ri}`);
      if(!cb || !cb.checked) return;
      additions.push({
        label:    r.tmpl.label,
        amount:   r.tmpl.pendingAmount ? 0 : normalizeAmount(r.tmpl.amount),
        due:      r.dueDate,
        status:   'unpaid',
        remark:   r.tmpl.pendingAmount ? 'Pending amount — to be updated' : '',
        scanLink: '',
        paidDate: '',
        payments: []
      });
    });
    if(additions.length) pending.push({tenant: g.t, newBills: [...g.t.bills, ...additions]});
  });

  if(!pending.length){ showToast('No bills selected to generate.', false); return; }

  setLoading(true,'Generating bills…');
  try {
    await Promise.all(pending.map(p => dbUpdate(p.tenant.id, {bills: p.newBills})));
    // Commit local state only after every save succeeded.
    pending.forEach(p => { p.tenant.bills = p.newBills; });
    setLoading(false);
    closeGenModal();
    showToast('Bills generated ✓');
    rerenderAdmin();
  } catch(e){ setLoading(false); showToast('Error: '+e.message, false); }
}





// ─────────────────────────────────────────────
// FILTER CONTROLS
// ─────────────────────────────────────────────
// ── NOTION-STYLE FILTER HELPERS ──
function getAvailableMonths(showAll) {
  const months = new Set();
  tenants.forEach(t => t.bills.forEach(b => {
    if (b.due) months.add(b.due.slice(0, 7));
  }));
  const sorted = Array.from(months).sort().reverse();
  const limit = showAll ? sorted.length : 12;
  let visible = sorted.slice(0, limit);
  // Always include the currently selected month even if it's older
  if (filterMonth && !visible.includes(filterMonth) && sorted.includes(filterMonth)) {
    visible.push(filterMonth);
    visible.sort().reverse();
  }
  return { months: visible.map(v => ({ value: v, label: new Date(v + '-02').toLocaleString('default', { month: 'long', year: 'numeric' }) })), hasMore: sorted.length > limit };
}
let _showAllMonths = false;
function renderMonthOptions(showAll) {
  const data = getAvailableMonths(showAll || _showAllMonths);
  let html = '<option value="">All Months</option>';
  html += data.months.map(m => '<option value="'+m.value+'" '+(filterMonth===m.value?'selected':'')+'>'+m.label+'</option>').join('');
  if (data.hasMore) html += '<option value="__more__">Show older months\u2026</option>';
  return html;
}
function renderMonthDropdown(showAll) {
  _showAllMonths = !!showAll;
  const sel = document.getElementById('fp-month');
  if (sel) { sel.innerHTML = renderMonthOptions(showAll); sel.value = filterMonth; }
}
function _currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function setFilterThisMonth() {
  const ym = _currentYM();
  filterMonth = (filterMonth === ym) ? '' : ym; // toggle off if already active
  applyFilters();
}
function hasActiveFilters() { return !!(filterTenantId || filterMonth || filterStatuses.length); }
function activeFilterCount() {
  let n = 0;
  if (filterTenantId) n++;
  if (filterMonth) n++;
  if (filterStatuses.length) n += filterStatuses.length;
  return n;
}
function renderFilterChips() {
  const chips = [];
  const statusLabels = {overdue:'Overdue','due-today':'Due Today','due-soon':'Due Soon',upcoming:'Upcoming',paid:'Paid'};
  if (filterTenantId) {
    const t = tenants.find(t=>t.id===filterTenantId);
    if (t) chips.push('<span class="filter-chip">'+esc(t.name)+'<button class="filter-chip-x" onclick="filterTenantId=\'\';applyFilters()">&#10005;</button></span>');
  }
  if (filterMonth) {
    const lbl = new Date(filterMonth+'-02').toLocaleString('default',{month:'short',year:'numeric'});
    chips.push('<span class="filter-chip">'+lbl+'<button class="filter-chip-x" onclick="filterMonth=\'\';applyFilters()">&#10005;</button></span>');
  }
  filterStatuses.forEach(s => {
    chips.push('<span class="filter-chip">'+(statusLabels[s]||s)+'<button class="filter-chip-x" onclick="removeFilterStatus(\''+s+'\')">&#10005;</button></span>');
  });
  return chips.join('');
}
function toggleFilterPopover() {
  const el = document.getElementById('filter-popover');
  el.classList.toggle('open');
  // Close sort popover
  const sp = document.getElementById('sort-popover');
  if (sp) sp.classList.remove('open');
}
function closeFilterPopover() {
  document.getElementById('filter-popover').classList.remove('open');
}
function toggleSortPopover() {
  const el = document.getElementById('sort-popover');
  el.classList.toggle('open');
  // Close filter popover
  const fp = document.getElementById('filter-popover');
  if (fp) fp.classList.remove('open');
}
function setSortOrder(order) {
  sortOrder = order;
  document.getElementById('sort-popover').classList.remove('open');
  rerenderAdmin();
}
function toggleFilterStatus(s) {
  const idx = filterStatuses.indexOf(s);
  if (idx >= 0) filterStatuses.splice(idx, 1);
  else filterStatuses.push(s);
  applyFilters(true); // keep popover open — toggling several statuses in a row is common
}
function removeFilterStatus(s) {
  filterStatuses = filterStatuses.filter(x => x !== s);
  applyFilters();
}
// keepPopover: pass true when the change came from inside the filter popover,
// so the re-render doesn't slam it shut between clicks.
function applyFilters(keepPopover) {
  tableRowLimit = 50;
  rerenderAdmin();
  if (keepPopover) {
    const fp = document.getElementById('filter-popover');
    if (fp) fp.classList.add('open');
  }
}
function clearFilters() {
  filterTenantId = '';
  filterMonth    = '';
  filterStatuses = [];
  filterSearch   = '';
  _showAllMonths = false;
  tableRowLimit  = 50;
  applyFilters(true);
}
// Close popovers when clicking outside
document.addEventListener('click', function(e) {
  // A click on a control inside the popover can synchronously re-render the
  // dashboard, detaching the clicked element before this handler runs. Such a
  // click was inside the popover — never treat it as "outside".
  if (e.target && !e.target.isConnected) return;
  const fpWrap = document.getElementById('filter-popover-wrap');
  const spWrap = document.getElementById('sort-popover-wrap');
  if (fpWrap && !fpWrap.contains(e.target)) {
    const fp = document.getElementById('filter-popover');
    if (fp) fp.classList.remove('open');
  }
  if (spWrap && !spWrap.contains(e.target)) {
    const sp = document.getElementById('sort-popover');
    if (sp) sp.classList.remove('open');
  }
});


// ─────────────────────────────────────────────
// PAYMENT INSTRUCTIONS
// ─────────────────────────────────────────────
function openPayInstModal() {
  document.getElementById('payinst-textarea').value = paymentInstructions || '';
  document.getElementById('payinst-error').style.display = 'none';
  openModal('payinst-modal');
}
function closePayInstModal() {
  closeModalEl('payinst-modal');
}
async function savePayInst() {
  const val = document.getElementById('payinst-textarea').value.trim();
  const errEl = document.getElementById('payinst-error');
  errEl.style.display = 'none';
  try {
    await dbSetSetting('payment_instructions', val);
    paymentInstructions = val;
    closePayInstModal();
    showToast('Payment instructions saved.');
    rerenderAdmin();
  } catch(e) {
    errEl.textContent = 'Save failed. Make sure the settings table exists in Supabase.';
    errEl.style.display = 'block';
  }
}



// ─────────────────────────────────────────────
// PORTAL MONTH FILTER
// ─────────────────────────────────────────────
function setPortalMonth(ym) {
  portalMonth = ym;
  renderTenant();
}

// ─────────────────────────────────────────────
// TIMELINE EXPAND
// ─────────────────────────────────────────────
function showFullTimeline(expand) {
  const t = currentUser;
  const paidBills = t.bills.filter(b=>b.status==='paid');
  const section = document.querySelector('.timeline-section');
  if(!section) return;
  // Preserve the full header row (title + Generate Statement button), not just the title
  const headerRow = section.children[0];
  const headerHtml = headerRow ? headerRow.outerHTML : '';
  section.innerHTML = headerHtml + buildTimeline(paidBills, expand !== false);
}


// ─────────────────────────────────────────────
// F-15: CSV EXPORT + PRINT VIEW
// ─────────────────────────────────────────────
function exportCSV() {
  const dsLabel = { paid:'Paid', overdue:'Overdue', 'due-today':'Due Today', 'due-soon':'Due Soon', upcoming:'Upcoming', 'no-date':'Unscheduled' };
  const rows = [['Tenant Name','Unit','Access Code','Bill Label','Amount','Amount Paid','Remaining','Due Date','Status','Paid Date','Remark']];
  tenants.forEach(t => {
    if(!t.bills||!t.bills.length){
      rows.push([t.name,t.unit,t.code,'','','','','','','','']);
    } else {
      t.bills.forEach(b => {
        const paid = billTotalPaid(b);
        const remaining = billRemaining(b);
        const status = dsLabel[getDueStatus(b)] || b.status;
        rows.push([
          t.name, t.unit, t.code,
          b.label, b.amount, paid, Math.max(0,remaining), b.due||'', status, b.paidDate||'', b.remark||''
        ]);
      });
    }
  });
  const csv = rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'orange-apartment-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported ✓');
}

// ─────────────────────────────────────────────
// "/" focuses the dashboard search box (unless already typing somewhere)
// ─────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if(e.key !== '/') return;
  const el = document.getElementById('tenant-search');
  if(!el) return;
  const a = document.activeElement;
  if(a && (a.tagName==='INPUT' || a.tagName==='TEXTAREA' || a.tagName==='SELECT' || a.isContentEditable)) return;
  e.preventDefault();
  el.focus();
  el.select();
});

// ─────────────────────────────────────────────
// F16: Escape key closes modals
// ─────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if(e.key !== 'Escape') return;
  const _el = id => { const el=document.getElementById(id); return el&&el.classList.contains('open')?el:null; };
  if(_el('paiddate-modal')) { closePaidModal();    return; }
  if(_el('genbills-modal')) { closeGenModal();     return; }
  if(_el('payinst-modal'))  { closePayInstModal(); return; }
  if(_el('stmt-modal'))     { closeStmtModal();    return; }
  if(_el('addbill-modal'))  { closeQuickBill();    return; }
  if(_el('tenant-modal'))   { closeModal();        return; }
});

