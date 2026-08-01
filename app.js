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
      <div class="field"><label>Date</label><input type="date" id="pf-date-${bi}" value="${todayISO()}"></div>
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
  // Overpayment guard: excess beyond the remaining balance doesn't carry
  // anywhere, so make the admin confirm it's intentional (typo catcher).
  const _t = tenants.find(t=>t.id===editingId);
  const _b = _t && _t.bills[bi];
  if(_b){
    const rem = Math.max(0, billRemaining(_b));
    if(amt > rem && !confirm('This payment (₱'+amt.toLocaleString()+') is more than the remaining balance (₱'+rem.toLocaleString()+') for "'+_b.label+'". Record it anyway?')) return;
  }
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
// STATEMENT MODAL — customizable, with live preview
// ─────────────────────────────────────────────
let _stmtTenant = null;        // tenant object for statement
let _stmtPreset = '3m';        // '3m' | '6m' | 'ytd' | 'all' | 'custom'
let _stmtPreviewTimer = null;
let _stmtResizeHandler = null;

const STMT_PREFS_KEY = 'oa_stmt_prefs_v1';
// CSS pixel dimensions of each paper size at 96dpi (portrait)
const STMT_PAPER_PX = { a4:[794,1123], letter:[816,1056] };

function stmtDefaultPrefs() {
  return {
    preset:'3m', filter:'all',
    colDue:true, colStatus:true, colPaid:true, colPaidDate:true, colRemarks:false,
    payments:false, group:'none', breakdown:true, summary:true, sign:false, note:'',
    sort:'oldest', size:'normal', theme:'color', paper:'a4', orient:'portrait'
  };
}

function openStmtModalById(tid) {
  const t = tenants.find(t=>t.id===tid);
  if(t) openStmtModal(t);
}

function openStmtModal(tenantObj) {
  _stmtTenant = tenantObj || currentUser;
  if(!_stmtTenant) return;

  // Restore saved layout preferences (date range is always recomputed fresh).
  let prefs = stmtDefaultPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(STMT_PREFS_KEY));
    if(saved && typeof saved==='object') prefs = Object.assign(prefs, saved);
  } catch {}
  // Migrate: 'group' was a group-by-month boolean before it became a select.
  if(typeof prefs.group === 'boolean') prefs.group = prefs.group ? 'month' : 'none';
  const setChk = (id,v)=>{ document.getElementById(id).checked = !!v; };
  const setVal = (id,v)=>{ document.getElementById(id).value = v; };
  setVal('stmt-filter', prefs.filter);
  setChk('stmt-col-due', prefs.colDue);
  setChk('stmt-col-status', prefs.colStatus);
  setChk('stmt-col-paid', prefs.colPaid);
  setChk('stmt-col-paiddate', prefs.colPaidDate);
  setChk('stmt-col-remarks', prefs.colRemarks);
  setChk('stmt-payments', prefs.payments);
  setVal('stmt-group', prefs.group);
  setChk('stmt-breakdown', prefs.breakdown);
  setChk('stmt-summary', prefs.summary);
  setChk('stmt-sign', prefs.sign);
  setVal('stmt-note', prefs.note||'');
  setVal('stmt-sort', prefs.sort);
  setVal('stmt-size', prefs.size);
  setVal('stmt-theme', prefs.theme);
  setVal('stmt-paper', prefs.paper);
  setVal('stmt-orient', prefs.orient);

  document.getElementById('stmt-title').textContent = 'Statement — '+_stmtTenant.name;
  document.getElementById('stmt-sub').textContent = 'Unit '+_stmtTenant.unit+((_stmtTenant.floor||'').trim()?' · '+_stmtTenant.floor:'')+' · Adjust the options — the preview updates live.';

  // 'custom' can't be restored meaningfully across tenants; fall back to 3 months.
  setStmtPreset(prefs.preset==='custom' ? '3m' : prefs.preset, true);
  openModal('stmt-modal');

  if(!_stmtResizeHandler) {
    _stmtResizeHandler = ()=>fitStmtPreview();
    window.addEventListener('resize', _stmtResizeHandler);
  }
  // Render after the modal is laid out so the preview can measure its width.
  requestAnimationFrame(()=>renderStmtPreview());
}

function closeStmtModal() {
  closeModalEl('stmt-modal');
  _stmtTenant = null;
  if(_stmtResizeHandler) {
    window.removeEventListener('resize', _stmtResizeHandler);
    _stmtResizeHandler = null;
  }
}

function setStmtPreset(preset, skipRender) {
  _stmtPreset = preset;
  document.querySelectorAll('#stmt-presets .stmt-preset').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.preset===preset);
  });
  const fromEl = document.getElementById('stmt-from');
  const toEl   = document.getElementById('stmt-to');
  const ym = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const now = new Date();
  const allTime = preset==='all';
  fromEl.disabled = allTime;
  toEl.disabled   = allTime;
  if(!allTime) {
    const back = preset==='6m' ? 5 : 2;
    fromEl.value = preset==='ytd' ? now.getFullYear()+'-01' : ym(new Date(now.getFullYear(), now.getMonth()-back, 1));
    toEl.value = ym(now);
  }
  if(!skipRender) stmtOptsChanged();
}

function stmtRangeEdited() {
  _stmtPreset = 'custom';
  document.querySelectorAll('#stmt-presets .stmt-preset').forEach(btn=>btn.classList.remove('active'));
  stmtOptsChanged();
}

function getStmtOpts() {
  const chk = id => document.getElementById(id).checked;
  const val = id => document.getElementById(id).value;
  return {
    preset: _stmtPreset,
    from: val('stmt-from'), to: val('stmt-to'),
    filter: val('stmt-filter'),
    colDue: chk('stmt-col-due'), colStatus: chk('stmt-col-status'),
    colPaid: chk('stmt-col-paid'), colPaidDate: chk('stmt-col-paiddate'),
    colRemarks: chk('stmt-col-remarks'),
    payments: chk('stmt-payments'), group: val('stmt-group'),
    breakdown: chk('stmt-breakdown'),
    summary: chk('stmt-summary'), sign: chk('stmt-sign'),
    note: val('stmt-note'),
    sort: val('stmt-sort'), size: val('stmt-size'), theme: val('stmt-theme'),
    paper: val('stmt-paper'), orient: val('stmt-orient')
  };
}

function stmtOptsChanged() {
  const o = getStmtOpts();
  try {
    const {from, to, ...prefs} = o; // range is per-visit, everything else persists
    localStorage.setItem(STMT_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
  clearTimeout(_stmtPreviewTimer);
  _stmtPreviewTimer = setTimeout(()=>renderStmtPreview(), 120);
}

// Which bills the current options select, in print order.
function stmtSelectBills(t, o) {
  let bills = t.bills.slice();
  if(o.preset!=='all' && o.from && o.to) {
    bills = bills.filter(b => {
      const ym = (b.due||b.paidDate||'').slice(0,7);
      // Undated UNPAID bills are open obligations — a period statement that
      // omits them would understate what the tenant owes. Undated paid bills
      // are historic noise and stay out of ranged periods.
      if(!ym) return b.status!=='paid';
      return ym >= o.from && ym <= o.to;
    });
  }
  if(o.filter==='unpaid') bills = bills.filter(b=>b.status!=='paid');
  if(o.filter==='paid')   bills = bills.filter(b=>b.status==='paid');
  const dir = o.sort==='newest' ? -1 : 1;
  bills.sort((a,b)=>{
    const da = a.due||a.paidDate||'', db = b.due||b.paidDate||'';
    if(!da && !db) return 0;
    if(!da) return 1;              // undated bills always sink to the bottom
    if(!db) return -1;
    return da.localeCompare(db)*dir;
  });
  return bills;
}

function buildStatementHTML(t, o) {
  const bills = stmtSelectBills(t, o);
  const bw = o.theme==='bw';

  const fmtM = ym => new Date(ym+'-02').toLocaleString('default',{month:'long',year:'numeric'});
  let rangeLabel = 'All time';
  if(o.preset!=='all' && o.from && o.to)
    rangeLabel = o.from===o.to ? fmtM(o.from) : fmtM(o.from)+' – '+fmtM(o.to);

  const peso = v => '&#8369;'+Number(v||0).toLocaleString();
  // A bill marked paid is settled in full even if partial payments weren't logged.
  const paidOf = b => b.status==='paid' ? Number(b.amount||0) : billTotalPaid(b);
  const balOf  = b => b.status==='paid' ? 0 : Math.max(0, billRemaining(b));

  const billedTotal = bills.reduce((s,b)=>s+Number(b.amount||0),0);
  const paidTotal   = bills.reduce((s,b)=>s+paidOf(b),0);
  const balTotal    = bills.reduce((s,b)=>s+balOf(b),0);
  const unpaidCount = bills.filter(b=>b.status!=='paid').length;
  // True outstanding balance is over ALL bills, not just the selected subset.
  const outstandingAllTime = t.bills.filter(b=>b.status!=='paid').reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);

  const dueStatusLabels = { paid:'Paid', overdue:'Overdue', 'due-today':'Due Today', 'due-soon':'Due Soon', upcoming:'Upcoming', 'no-date':'Unscheduled' };
  const dueStatusColors = { paid:'#1e8449', overdue:'#c0392b', 'due-today':'#c0392b', 'due-soon':'#b9770e', upcoming:'#5a6776', 'no-date':'#5a6776' };
  const statusCell = b => {
    const ds = getDueStatus(b);
    const label = dueStatusLabels[ds]||ds;
    if(bw) return esc(label);
    const c = dueStatusColors[ds]||'#5a6776';
    return '<span class="pill" style="color:'+c+';background:'+c+'14;">'+esc(label)+'</span>';
  };

  const cols = [
    { th:'Bill', td:b=>esc(b.label||''), cls:'c-bill' },
    o.colDue      && { th:'Due Date', td:b=>b.due?formatDate(b.due):'&mdash;' },
    { th:'Amount', td:b=>peso(b.amount), cls:'num' },
    o.colPaid     && { th:'Paid', td:b=>paidOf(b)?peso(paidOf(b)):'&mdash;', cls:'num' },
    o.colPaid     && { th:'Balance', td:b=>balOf(b)?peso(balOf(b)):(b.status==='paid'?peso(0):'&mdash;'), cls:'num' },
    o.colStatus   && { th:'Status', td:statusCell },
    o.colPaidDate && { th:'Paid Date', td:b=>b.paidDate?formatDate(b.paidDate):'&mdash;' },
    o.colRemarks  && { th:'Remarks', td:b=>esc(b.remark||''), cls:'c-remarks' }
  ].filter(Boolean);

  const rowHtml = b => {
    let h = '<tr>'+cols.map(c=>'<td class="'+(c.cls||'')+'">'+c.td(b)+'</td>').join('')+'</tr>';
    if(o.payments && b.payments && b.payments.length) {
      h += '<tr class="payrow"><td colspan="'+cols.length+'">'+
        b.payments.map(p=>'&#8627; '+peso(p.amount)+' received'+(p.date?' &middot; '+formatDate(p.date):'')+(p.note?' &middot; '+esc(p.note):'')).join('<br>')+
        '</td></tr>';
    }
    return h;
  };

  let bodyHtml = '';
  if(o.group!=='none' && bills.length) {
    const byCat = o.group==='category';
    const labelSpan = 1 + (o.colDue?1:0);
    const tailSpan  = (o.colStatus?1:0)+(o.colPaidDate?1:0)+(o.colRemarks?1:0);
    const keyOf = b => byCat ? billCategory(b) : ((b.due||b.paidDate||'').slice(0,7) || 'none');
    let keys = []; const groups = {};
    bills.forEach(b=>{
      const k = keyOf(b);
      if(!groups[k]){ groups[k]=[]; keys.push(k); }
      groups[k].push(b);
    });
    // Category groups always print rent first, then utilities, then other.
    if(byCat) keys = BILL_CATEGORIES.map(c=>c.key).filter(k=>groups[k]);
    const catLabels = {}; BILL_CATEGORIES.forEach(c=>catLabels[c.key]=c.label);
    bodyHtml = keys.map(k=>{
      const g = groups[k];
      const name = byCat ? catLabels[k] : (k==='none' ? 'No due date' : fmtM(k));
      const gBilled = g.reduce((s,b)=>s+Number(b.amount||0),0);
      const gPaid   = g.reduce((s,b)=>s+paidOf(b),0);
      const gBal    = g.reduce((s,b)=>s+balOf(b),0);
      return '<tr class="grouphead"><td colspan="'+cols.length+'">'+esc(name)+'</td></tr>'+
        g.map(rowHtml).join('')+
        '<tr class="subtotal"><td colspan="'+labelSpan+'">Subtotal</td><td class="num">'+peso(gBilled)+'</td>'+
        (o.colPaid ? '<td class="num">'+peso(gPaid)+'</td><td class="num">'+peso(gBal)+'</td>' : '')+
        (tailSpan ? '<td colspan="'+tailSpan+'"></td>' : '')+'</tr>';
    }).join('');
  } else {
    bodyHtml = bills.map(rowHtml).join('');
  }

  const tableHtml = bills.length
    ? '<table><thead><tr>'+cols.map(c=>'<th class="'+(c.cls||'')+'">'+c.th+'</th>').join('')+'</tr></thead><tbody>'+bodyHtml+'</tbody></table>'
    : '<div class="empty">No bills match the selected period and filters.</div>';

  const showAllTimeLine = balTotal !== outstandingAllTime;
  // Per-category share of the outstanding balance, rent first and emphasized.
  const catBal = { rent:0, utilities:0, other:0 };
  bills.forEach(b=>{ catBal[billCategory(b)] += balOf(b); });
  const catRows = (o.breakdown && balTotal)
    ? BILL_CATEGORIES.filter(c=>catBal[c.key]>0 || c.key==='rent').map(c=>
        '<tr class="catrow'+(c.key==='rent'?' rent':'')+'"><td>'+c.label+' outstanding</td><td class="num">'+peso(catBal[c.key])+'</td></tr>').join('')
    : '';
  const summaryHtml = o.summary ? '<div class="summary"><table class="sumtable">'+
      '<tr><td>Total billed ('+bills.length+' bill'+(bills.length!==1?'s':'')+')</td><td class="num">'+peso(billedTotal)+'</td></tr>'+
      '<tr><td>Total paid</td><td class="num">'+peso(paidTotal)+'</td></tr>'+
      catRows+
      '<tr class="bal"><td>Balance outstanding'+(o.preset!=='all'?' (this period)':'')+'</td><td class="num">'+peso(balTotal)+'</td></tr>'+
      (showAllTimeLine ? '<tr class="allnote"><td>Total outstanding, all time</td><td class="num">'+peso(outstandingAllTime)+'</td></tr>' : '')+
      '</table></div>' : '';

  const noteHtml = (o.note||'').trim()
    ? '<div class="notes"><div class="sec-label">Notes</div><div class="notes-body">'+esc(o.note.trim()).replace(/\n/g,'<br>')+'</div></div>'
    : '';

  const signHtml = o.sign
    ? '<div class="signs">'+
        '<div class="sign"><div class="sign-line"></div><div class="sign-label">Prepared by &middot; Date</div></div>'+
        '<div class="sign"><div class="sign-line"></div><div class="sign-label">Received by &middot; Date</div></div>'+
      '</div>'
    : '';

  const genDate = new Date().toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'});
  const headBalance = bw
    ? '<div class="head-bal">'+(outstandingAllTime?peso(outstandingAllTime):'Settled')+'</div>'
    : '<div class="head-bal" style="color:'+(outstandingAllTime?'#c0392b':'#1e8449')+'">'+(outstandingAllTime?peso(outstandingAllTime):'Settled')+'</div>';

  const sizes = {
    compact:{ base:'10.5px', pad:'5px 8px',  h1:'19px', bal:'17px' },
    normal: { base:'12px',   pad:'7px 9px',  h1:'21px', bal:'19px' },
    large:  { base:'13.5px', pad:'9px 10px', h1:'23px', bal:'21px' }
  };
  const sz = sizes[o.size]||sizes.normal;
  const accent = bw ? '#111111' : '#e67e22';
  const headings = bw ? '#111111' : '#2c3e50';
  const theadBg = bw ? '#f2f2f2' : '#f1f5f9';
  const muted = bw ? '#444444' : '#5a6776';
  const pageSize = (o.paper==='letter'?'letter':'A4')+' '+(o.orient==='landscape'?'landscape':'portrait');

  const css =
    '*{margin:0;padding:0;box-sizing:border-box}'+
    'body{font-family:Inter,Arial,Helvetica,sans-serif;color:#111;font-size:'+sz.base+';line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.doc{padding:44px 48px;max-width:1040px;margin:0 auto}'+
    '.doc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:2.5px solid '+headings+';margin-bottom:18px}'+
    '.brand{font-family:"Source Serif 4",Georgia,serif;font-size:'+sz.h1+';font-weight:700;color:'+headings+';display:flex;align-items:center;gap:9px}'+
    '.brand .dot{width:0.55em;height:0.55em;border-radius:50%;background:'+accent+';display:inline-block;flex-shrink:0}'+
    '.brand-sub{font-size:0.72em;font-weight:400;color:'+muted+';font-family:Inter,Arial,sans-serif;margin-top:3px;letter-spacing:0.02em}'+
    '.doc-type{text-align:right}'+
    '.doc-type-title{font-size:0.95em;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:'+headings+'}'+
    '.doc-type-gen{font-size:0.88em;color:'+muted+';margin-top:4px}'+
    '.doc-meta{display:flex;justify-content:space-between;gap:20px;margin-bottom:20px}'+
    '.meta-label{font-size:0.78em;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:'+muted+';margin-bottom:3px}'+
    '.meta-main{font-weight:600;color:#111}'+
    '.meta-sub{font-size:0.92em;color:'+muted+';margin-top:1px}'+
    '.meta-block.right{text-align:right}'+
    '.head-bal{font-family:"Source Serif 4",Georgia,serif;font-size:'+sz.bal+';font-weight:700}'+
    'table{width:100%;border-collapse:collapse}'+
    'thead{display:table-header-group}'+
    'th{background:'+theadBg+';padding:'+sz.pad+';text-align:left;font-size:0.82em;letter-spacing:0.08em;text-transform:uppercase;color:'+muted+';border-bottom:1.5px solid #d5d9e0}'+
    'td{padding:'+sz.pad+';border-bottom:1px solid #e8e8ed;vertical-align:top}'+
    'tr{page-break-inside:avoid}'+
    '.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'+
    '.c-bill{font-weight:500}'+
    '.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:0.9em;font-weight:600;white-space:nowrap}'+
    '.payrow td{padding-top:2px;font-size:0.9em;color:'+muted+';border-bottom:1px solid #e8e8ed;padding-left:1.6em}'+
    '.grouphead td{background:'+(bw?'#fafafa':'#fbf7f2')+';font-family:"Source Serif 4",Georgia,serif;font-weight:600;color:'+headings+';border-bottom:1px solid #d5d9e0;padding-top:0.9em}'+
    '.subtotal td{font-weight:600;background:'+(bw?'#fafafa':'#fcfcfd')+';border-bottom:2px solid #d5d9e0;color:'+headings+'}'+
    '.summary{display:flex;justify-content:flex-end;margin-top:16px}'+
    '.sumtable{width:auto;min-width:46%}'+
    '.sumtable td{border-bottom:1px solid #e8e8ed;padding:'+sz.pad+'}'+
    '.sumtable td:first-child{color:'+muted+';padding-right:28px}'+
    '.sumtable .catrow td{font-size:0.95em}'+
    '.sumtable .catrow.rent td{color:#111;font-weight:600}'+
    '.sumtable .bal td{font-weight:700;color:#111;border-bottom:2px solid '+headings+'}'+
    '.sumtable .allnote td{font-size:0.9em;color:'+muted+';border-bottom:none}'+
    '.notes{margin-top:22px;padding:12px 16px;background:'+(bw?'#f7f7f7':'#f8f9fc')+';border-left:3px solid '+accent+';page-break-inside:avoid}'+
    '.sec-label{font-size:0.78em;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:'+muted+';margin-bottom:4px}'+
    '.notes-body{white-space:normal}'+
    '.signs{display:flex;gap:48px;margin-top:44px;page-break-inside:avoid}'+
    '.sign{flex:1;max-width:260px}'+
    '.sign-line{border-bottom:1.5px solid #111;height:2.2em}'+
    '.sign-label{font-size:0.85em;color:'+muted+';margin-top:5px}'+
    '.empty{padding:36px 0;text-align:center;color:'+muted+'}'+
    '.doc-foot{margin-top:28px;padding-top:10px;border-top:1px solid #e8e8ed;display:flex;justify-content:space-between;font-size:0.82em;color:'+muted+'}'+
    '@page{size:'+pageSize+';margin:14mm}'+
    '@media print{.doc{padding:0;max-width:none}}';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement — '+esc(t.name)+'</title>'+
    '<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">'+
    '<style>'+css+'</style></head><body><div class="doc">'+
    '<div class="doc-head">'+
      '<div><div class="brand"><span class="dot"></span>'+esc(propertyName)+'</div><div class="brand-sub">'+esc(propertySubtitle)+'</div></div>'+
      '<div class="doc-type"><div class="doc-type-title">Statement of Account</div><div class="doc-type-gen">Generated '+genDate+'</div></div>'+
    '</div>'+
    '<div class="doc-meta">'+
      '<div class="meta-block"><div class="meta-label">Billed To</div><div class="meta-main">'+esc(t.name)+'</div><div class="meta-sub">Unit '+esc(t.unit)+((t.floor||'').trim()?' &middot; '+esc(t.floor):'')+'</div></div>'+
      '<div class="meta-block"><div class="meta-label">Period</div><div class="meta-main">'+rangeLabel+'</div><div class="meta-sub">'+bills.length+' bill'+(bills.length!==1?'s':'')+(unpaidCount?' &middot; '+unpaidCount+' unpaid':'')+'</div></div>'+
      '<div class="meta-block right"><div class="meta-label">Balance Due</div>'+headBalance+'</div>'+
    '</div>'+
    tableHtml + summaryHtml + noteHtml + signHtml +
    '<div class="doc-foot"><span>'+esc(propertyName)+' &middot; Statement of Account</span><span>'+esc(t.name)+' &middot; Unit '+esc(t.unit)+'</span></div>'+
    '</div></body></html>';
}

function renderStmtPreview() {
  if(!_stmtTenant) return;
  const iframe = document.getElementById('stmt-preview');
  if(!iframe) return;
  const o = getStmtOpts();
  const html = buildStatementHTML(_stmtTenant, o);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();

  // Footer hint mirrors the numbers on the statement.
  const bills = stmtSelectBills(_stmtTenant, o);
  const cat = outstandingByCategory(bills);
  const hint = document.getElementById('stmt-hint');
  if(hint) hint.innerHTML = bills.length+' bill'+(bills.length!==1?'s':'')+' on statement'+
    (cat.total ? ' &middot; &#8369;'+cat.total.toLocaleString()+' outstanding'+(cat.rent?' (&#8369;'+cat.rent.toLocaleString()+' rent)':'') : '');

  fitStmtPreview();
  // Re-fit once content (and web fonts) settle so the page height is right.
  setTimeout(fitStmtPreview, 120);
}

// Scale the paper-sized iframe down to fit the preview pane.
function fitStmtPreview() {
  const frame = document.getElementById('stmt-preview-frame');
  const scaleDiv = document.getElementById('stmt-preview-scale');
  const iframe = document.getElementById('stmt-preview');
  if(!frame || !scaleDiv || !iframe || !frame.clientWidth) return;
  const o = getStmtOpts();
  let [w,h] = STMT_PAPER_PX[o.paper] || STMT_PAPER_PX.a4;
  if(o.orient==='landscape') [w,h] = [h,w];
  let contentH = h;
  try {
    const body = iframe.contentDocument && iframe.contentDocument.body;
    if(body) contentH = Math.max(h, body.scrollHeight);
  } catch {}
  const pad = 28; // preview frame padding
  const s = Math.min(1, (frame.clientWidth - pad) / w);
  iframe.style.width = w+'px';
  iframe.style.height = contentH+'px';
  scaleDiv.style.width = w+'px';
  scaleDiv.style.transform = 'scale('+s+')';
  scaleDiv.style.height = Math.ceil(contentH*s)+'px';
}

function printStatement() {
  if(!_stmtTenant) return;
  renderStmtPreview(); // make sure the printed document matches the options
  const iframe = document.getElementById('stmt-preview');
  // Small delay so the freshly written document finishes layout first.
  setTimeout(()=>{
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      // Fall back to a pop-up window if iframe printing is blocked.
      try {
        const win = window.open('','_blank');
        if(!win) throw new Error('blocked');
        win.document.write(buildStatementHTML(_stmtTenant, getStmtOpts()));
        win.document.close();
        setTimeout(()=>{ try { win.print(); } catch(err){} }, 400);
      } catch(err) {
        showToast('Could not open the print dialog — please allow pop-ups.', false);
      }
    }
  }, 250);
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
    // Keep the admin session alive for the life of the tab. Nothing is
    // persisted to storage (persistSession stays false); without this the
    // JWT expired after ~an hour and writes silently fell back to the anon
    // key — RLS filtered them to zero rows and the UI showed success.
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

const SESSION_EXPIRED_MSG = 'Your session has expired — please sign out and sign in again.';

async function _getAuthHeaders() {
  const { data: { session } } = await _sbClient.auth.getSession();
  // An admin with no live session must NEVER fall back to the anon key:
  // anon writes match zero rows under RLS and would be mistaken for success.
  if(!session && currentUser === 'admin') throw new Error(SESSION_EXPIRED_MSG);
  const token = session ? session.access_token : SB_KEY;
  return { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

async function sbFetch(path, options={}) {
  const headers = await _getAuthHeaders();
  if(options.headers_extra) { Object.assign(headers, options.headers_extra); delete options.headers_extra; }
  const res = await fetch(SB_URL + '/rest/v1/' + path, { headers, ...options });
  if (!res.ok) {
    // Surface the PostgREST message text, not the raw JSON body — these
    // strings end up in user-facing toasts.
    const body = await res.text();
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = j.message || j.error_description || j.msg || j.hint || body;
    } catch {}
    if(res.status === 401 && currentUser === 'admin') msg = SESSION_EXPIRED_MSG;
    if(!msg) msg = 'Request failed (HTTP ' + res.status + '). Please check your connection and try again.';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
// Legacy rows (or rows created outside the app) can have null bills/templates;
// normalize once at load so render code never has to null-check arrays.
function _normalizeTenant(t) {
  if(!t) return t;
  if(!Array.isArray(t.bills)) t.bills = [];
  if(!Array.isArray(t.templates)) t.templates = [];
  return t;
}
async function dbGetAll()       { const rows = await sbFetch('tenants?select=*&order=name&archived_at=is.null'); (rows||[]).forEach(_normalizeTenant); return rows; }
async function dbInsert(t)      { return await sbFetch('tenants', { method:'POST', body: JSON.stringify(t) }); }
async function dbUpdate(id, t)  { return await sbFetch('tenants?id=eq.' + id, { method:'PATCH', body: JSON.stringify(t) }); }
async function dbDelete(id)     { return await sbFetch('tenants?id=eq.' + id, { method:'DELETE' }); }

// Optimistic-concurrency write for tenant bills/templates (uses the rev
// column from supabase-migration-2.sql; degrades to a plain PATCH when the
// column doesn't exist). Two admin tabs PATCHing the whole jsonb array used
// to silently overwrite each other — last write won and payments vanished.
// Now a stale write matches zero rows; we reload the fresh row and throw a
// conflict error so the caller can tell the admin to redo the change.
async function dbUpdateTenantGuarded(t, patch) {
  if(t.rev == null) { await dbUpdate(t.id, patch); return; }
  const nextRev = Number(t.rev) + 1;
  const rows = await sbFetch('tenants?id=eq.' + t.id + '&rev=eq.' + t.rev,
    { method:'PATCH', body: JSON.stringify({ ...patch, rev: nextRev }) });
  if(rows && rows.length) { t.rev = nextRev; return; }
  try {
    const fresh = await sbFetch('tenants?id=eq.' + t.id + '&select=*');
    if(fresh && fresh.length) {
      _normalizeTenant(fresh[0]);
      tenants = tenants.map(x => x.id === t.id ? fresh[0] : x);
    }
  } catch {}
  const err = new Error('This tenant was just updated from another tab or device. The latest data has been reloaded — please redo your change.');
  err.conflict = true;
  throw err;
}

// ── EXPENSES (admin-only; table added in supabase-migration-2.sql) ──
async function dbGetExpenses()      { return await sbFetch('expenses?select=*&order=expense_date.desc,created_at.desc'); }
async function dbInsertExpense(x)   { return await sbFetch('expenses', { method:'POST', body: JSON.stringify(x) }); }
async function dbUpdateExpense(id,x){ return await sbFetch('expenses?id=eq.' + encodeURIComponent(id), { method:'PATCH', body: JSON.stringify(x) }); }
async function dbDeleteExpense(id)  { return await sbFetch('expenses?id=eq.' + encodeURIComponent(id), { method:'DELETE' }); }

let paymentInstructions = ''; // loaded from Supabase settings table
let announcements       = ''; // notice board shown on every tenant portal
// Branding defaults match the historical hardcoded strings, so an instance
// that never runs migration 2 or sets a name looks exactly the same as before.
let propertyName        = 'Orange Apartment';
let propertySubtitle    = 'Tenant Billing Portal · Baguio';

// Tenant-visible settings, batched. Falls back to per-key read_setting calls
// when the read_portal_settings RPC (migration 2) isn't installed yet.
async function loadPortalSettings() {
  let s = null;
  let anyLoaded = false;
  try { s = await sbFetch('rpc/read_portal_settings', { method:'POST', body:'{}' }); anyLoaded = true; } catch {}
  if(!s || typeof s !== 'object') {
    s = {};
    const keys = ['payment_instructions','announcements','property_name','property_subtitle'];
    await Promise.all(keys.map(async k => {
      try { s[k] = await sbFetch('rpc/read_setting', { method:'POST', body: JSON.stringify({ setting_key: k }) }); anyLoaded = true; } catch {}
    }));
  }
  // Total failure (e.g. offline at page load): clear the cached promise so
  // the next tenant login retries instead of serving the failure all session.
  if(!anyLoaded) _portalSettingsPromise = null;
  paymentInstructions = (typeof s.payment_instructions === 'string') ? s.payment_instructions : '';
  announcements       = (typeof s.announcements === 'string') ? s.announcements : '';
  if(typeof s.property_name === 'string' && s.property_name.trim()) propertyName = s.property_name.trim();
  if(typeof s.property_subtitle === 'string' && s.property_subtitle.trim()) propertySubtitle = s.property_subtitle.trim();
  try { localStorage.setItem('oa_branding', JSON.stringify({ name: propertyName, sub: propertySubtitle })); } catch {}
  applyBranding();
}

// Admin-side settings load: one query instead of one per key.
let _settingsLoadFailed = false;
async function loadAdminSettings() {
  _settingsLoadFailed = false;
  try {
    const rows = await sbFetch('settings?select=key,value&key=in.(payment_instructions,announcements,property_name,property_subtitle)');
    const map = {}; (rows||[]).forEach(r=>{ map[r.key]=r.value; });
    paymentInstructions = map.payment_instructions || '';
    announcements       = map.announcements || '';
    if((map.property_name||'').trim()) propertyName = map.property_name.trim();
    if((map.property_subtitle||'').trim()) propertySubtitle = map.property_subtitle.trim();
  } catch {
    // A transient failure must not masquerade as "Not set" — editing on top
    // of that would overwrite the real values with blanks.
    _settingsLoadFailed = true;
    showToast('Could not load portal settings — shown values may be stale. Refresh before editing them.', false);
  }
  try { localStorage.setItem('oa_branding', JSON.stringify({ name: propertyName, sub: propertySubtitle })); } catch {}
  applyBranding();
}

// Stamp the property name onto the static chrome (tab title, wordmarks).
function applyBranding() {
  document.title = propertyName;
  const login = document.querySelector('.login-wordmark');
  if(login) login.textContent = propertyName;
  const nav = document.querySelector('.nav-wordmark');
  if(nav) nav.innerHTML = '<span class="nav-dot"></span>' + esc(propertyName);
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
// Expenses ledger (admin-only). `expensesAvailable` flips false when the
// expenses table doesn't exist yet (migration 2 not run) so the dashboard
// can show setup instructions instead of a broken panel.
let expenses = [];
let expensesAvailable = true;
let _expensesLoadError = false; // true = fetch failed for a non-schema reason
let _expensesOpen = false;
let expenseMonth = '';      // '' = current month, else 'YYYY-MM'
let _editingExpenseId = null;
// localStorage key for the remembered tenant access code. The code is a
// bearer credential for a READ-ONLY view of the tenant's own bills; storing
// it on the tenant's device is an accepted trade-off for one-tap access.
const PORTAL_CODE_KEY = 'oa_tenant_code';
let filterTenantId = '';   // '' = all
let filterMonth    = '';   // '' = all, else 'YYYY-MM'
let filterFloor    = '';   // '' = all, '__none__' = tenants without a floor, else exact floor label
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
  'floor-asc':    'Floor &#8593;',
  'name-asc':     'Name A&ndash;Z',
  'balance-desc': 'Balance high &rarr; low',
  'balance-asc':  'Balance low &rarr; high',
  'urgency':      'Most urgent first'
};

// Card-view grouping. 'auto' keeps the historical behavior (floor headers
// when floor labels exist and the list is unit-sorted). 'unit' groups the
// tenants of one physical unit under a shared header with a combined
// balance — the natural view when several per-head all-inclusive tenants
// share a unit.
let groupMode = 'auto'; // 'auto' | 'floor' | 'unit' | 'none'
const GROUP_LABELS = {
  auto:  'Auto',
  floor: 'By floor',
  unit:  'By unit',
  none:  'No grouping'
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
  // Longer messages (errors, conflict explanations) stay up long enough to read.
  const hold = Math.min(7000, 2500 + Math.max(0, msg.length - 40) * 35);
  el._t = setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(-50%) translateY(12px)'; }, hold);
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
    if(rows && rows.length) {
      _loginAttempts.count = 0;
      currentUser=_normalizeTenant(rows[0]); tenants=rows;
      const rememberEl = document.getElementById('tenant-remember');
      try {
        if(!rememberEl || rememberEl.checked) localStorage.setItem(PORTAL_CODE_KEY, code);
        else localStorage.removeItem(PORTAL_CODE_KEY);
      } catch {}
      showApp();
    }
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
      const [rows] = await Promise.all([
        dbGetAll(),
        loadAdminSettings(),
        dbGetExpenses().then(x=>{ expenses = x||[]; expensesAvailable = true; _expensesLoadError = false; })
          .catch(e=>{
            expenses = [];
            // "Table missing" means migration 2 hasn't run — show setup help.
            // Anything else (network, auth) is a load error, NOT missing setup.
            const missing = /relation .*expenses|expenses.*does not exist|Could not find the table/i.test(e.message||'');
            expensesAvailable = !missing;
            _expensesLoadError = !missing;
          })
      ]);
      tenants = rows || [];
    } catch(e) {
      setLoading(false);
      document.getElementById('main-content').innerHTML = '<div style="padding:48px 24px;text-align:center;"><div style="font-size:32px;margin-bottom:16px;">⚠</div><div style="font-family:Inter,sans-serif;font-size:16px;font-weight:600;color:var(--ink);margin-bottom:8px;">Could not connect to database</div><div style="font-size:13px;color:var(--muted);margin-bottom:24px;">'+esc(e.message)+'</div><button class="btn-primary" style="width:auto;padding:10px 24px;" onclick="location.reload()">Retry</button></div>';
      tenants=[];
      return;
    }
    setLoading(false); renderAdmin();
  } else {
    document.getElementById('header-info').textContent=`Unit ${currentUser.unit}`;
    // Reuse the page-load settings fetch instead of firing a second one.
    await (_portalSettingsPromise || loadPortalSettings().catch(()=>{}));
    renderTenant();
  }
}

// Silent login from a ?code=XXXX portal link or a remembered device code.
// Runs once on page load; any failure falls back to the normal login screen.
async function tryAutoLogin() {
  if(window.location.hash) return; // password-recovery flow owns the URL hash
  let code = '';
  let fromLink = false;
  try {
    const params = new URLSearchParams(window.location.search);
    code = (params.get('code')||'').trim().toUpperCase();
  } catch {}
  if(code) {
    fromLink = true;
    // Strip the code from the address bar so it isn't left in plain sight.
    history.replaceState(null, '', window.location.pathname);
  } else {
    try { code = (localStorage.getItem(PORTAL_CODE_KEY)||'').trim().toUpperCase(); } catch {}
  }
  if(!code) return;
  setLoading(true, 'Signing you in…');
  try {
    const rows = await sbFetch('rpc/login_tenant', { method:'POST', body: JSON.stringify({ access_code: code }) });
    if(rows && rows.length) {
      currentUser = _normalizeTenant(rows[0]); tenants = rows;
      // Deep-link visits deliberately do NOT persist the code: the link may
      // have been opened on a shared or borrowed device. Staying signed in
      // is the remember-me checkbox's job on the manual login form.
      setLoading(false);
      showApp();
      return;
    }
    // Code no longer valid (tenant archived / code regenerated): forget it.
    try { localStorage.removeItem(PORTAL_CODE_KEY); } catch {}
    switchTab('tenant');
    document.getElementById('tenant-code').value = code;
    if(fromLink) document.getElementById('login-error').textContent = 'That link is no longer valid — please check your access code.';
  } catch(e) {
    // Offline or rate-limited. The URL code was already stripped from the
    // address bar, so hand it back via the form — otherwise the tenant is
    // stranded with no code and no explanation.
    switchTab('tenant');
    document.getElementById('tenant-code').value = code;
    document.getElementById('login-error').textContent = 'Connection problem — tap "View My Bills" to try again.';
  }
  setLoading(false);
}
async function logout() {
  if(currentUser==='admin') await _sbClient.auth.signOut();
  else { try { localStorage.removeItem(PORTAL_CODE_KEY); } catch {} }
  // Reset every piece of session state so a subsequent login starts clean.
  currentUser = null;
  tenants = [];
  editingId = null;
  paymentInstructions = '';
  announcements = '';
  _portalSettingsPromise = null; // next tenant login refetches fresh settings
  expenses = [];
  expensesAvailable = true;
  _expensesOpen = false;
  expenseMonth = '';
  _editingExpenseId = null;
  filterTenantId = '';
  filterMonth    = '';
  filterFloor    = '';
  filterStatuses = [];
  filterSearch   = '';
  _openPaid      = new Set();
  sortOrder      = 'unit-asc';
  groupMode      = 'auto';
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
          return '<div class="cg-bar-row" role="button" tabindex="0" onkeydown="if(event.key===\'Enter\')this.click()" onclick="filterTenantId=\''+esc(x.id)+'\';applyFilters()" title="Filter to '+esc(x.name)+'">'
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
  // ── 5. Net position: collected − expenses, per month ──
  // Only rendered when the expenses table exists; the whole point is showing
  // whether all-inclusive rates still clear a margin after utilities.
  let netCardHtml = '';
  if(expensesAvailable && _expensesLoadError) {
    // A transient load failure must not render collected − ₱0 as "profit".
    netCardHtml = '<div class="insights-card insights-card-net">'
      + '<div class="insights-card-title">Net Position <span class="insights-card-sub">collected &minus; expenses</span></div>'
      + '<div class="cg-bar-empty">Expenses could not be loaded — refresh to see real figures.</div>'
      + '</div>';
  } else if(expensesAvailable) {
    const peso = v => '&#8369;'+Math.abs(v).toLocaleString();
    const netRows = months.map((ym,i) => {
      const col = collected[i];
      const exp = _expensesInMonth(ym);
      const net = col - exp;
      return '<div class="net-row">'
        + '<span class="net-mon">'+_ymLabel(ym)+'</span>'
        + '<span class="net-col" title="Collected">+'+peso(col)+'</span>'
        + '<span class="net-exp" title="Expenses">&minus;'+peso(exp)+'</span>'
        + '<span class="net-val '+(net>=0?'pos':'neg')+'">'+(net<0?'&minus;':'')+peso(net)+'</span>'
        + '</div>';
    }).join('');
    netCardHtml = '<div class="insights-card insights-card-net">'
      + '<div class="insights-card-title">Net Position <span class="insights-card-sub">collected &minus; expenses</span></div>'
      + '<div class="net-head"><span class="net-mon"></span><span class="net-col">Collected</span><span class="net-exp">Expenses</span><span class="net-val">Net</span></div>'
      + '<div class="net-rows">'+netRows+'</div>'
      + '</div>';
  }

  const agingMax = Math.max(1, ...agingBuckets.map(x=>x.amt));
  const agingTotal = agingBuckets.reduce((s,x)=>s+x.amt,0);
  const agingHtml = agingTotal === 0
    ? '<div class="cg-bar-empty">Nothing overdue. All caught up.</div>'
    : '<div class="cg-bars">'
      + agingBuckets.map(x => {
          const pct = (x.amt / agingMax * 100).toFixed(1);
          return '<div class="cg-bar-row" role="button" tabindex="0" onkeydown="if(event.key===\'Enter\')this.click()" onclick="filterStatuses=[\'overdue\'];applyFilters()" title="Show overdue bills">'
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
          +   netCardHtml
          + '</div>'
          + '</div>'
        : '')
    + '</div>';
}

// ─────────────────────────────────────────────
// EXPENSES — what the building actually spends.
// Once any tenant is on an all-inclusive rate, management shoulders the
// utilities, so collected-vs-spent is the number that tells the landlord
// whether the flat rate is actually profitable.
// ─────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  { key:'electricity', label:'Electricity' },
  { key:'water',       label:'Water' },
  { key:'internet',    label:'Internet' },
  { key:'maintenance', label:'Maintenance' },
  { key:'taxes',       label:'Taxes & Fees' },
  { key:'other',       label:'Other' }
];
const _expCatLabel = k => (EXPENSE_CATEGORIES.find(c=>c.key===k)||{label:k||'Other'}).label;

function _expYM(){ return expenseMonth || _currentYM(); }
function _expensesInMonth(ym) {
  return expenses.reduce((s,x)=>s+((x.expense_date||'').startsWith(ym)?Number(x.amount)||0:0),0);
}
function toggleExpenses(){ _expensesOpen = !_expensesOpen; rerenderAdmin(); }
function setExpenseMonth(v){ expenseMonth = v||''; _editingExpenseId = null; rerenderAdmin(); }

function _expFormHtml(idSuffix, x) {
  const today = todayISO();
  return `<div class="exp-form">
    <div class="exp-form-grid">
      <div class="field"><label for="exp-date-${idSuffix}">Date</label><input type="date" id="exp-date-${idSuffix}" value="${esc(x?x.expense_date:today)}"></div>
      <div class="field"><label for="exp-cat-${idSuffix}">Category</label>
        <select id="exp-cat-${idSuffix}">${EXPENSE_CATEGORIES.map(c=>`<option value="${c.key}"${x&&x.category===c.key?' selected':''}>${c.label}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="exp-amount-${idSuffix}">Amount (&#8369;)</label><input type="text" id="exp-amount-${idSuffix}" inputmode="decimal" autocomplete="off" placeholder="0" value="${x?x.amount:''}"></div>
      <div class="field exp-note-field"><label for="exp-note-${idSuffix}">Note <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(optional)</span></label><input type="text" id="exp-note-${idSuffix}" maxlength="200" placeholder="e.g. BENECO bill for July" value="${esc(x?x.note||'':'')}"></div>
    </div>
    <div class="exp-form-actions">
      ${x?`<button class="btn-cancel" onclick="cancelExpenseEdit()">Cancel</button><button class="btn-save" onclick="saveExpenseEdit('${esc(x.id)}')">Save</button>`
         :`<button class="btn-save" onclick="addExpense()">+ Add Expense</button>`}
    </div>
  </div>`;
}

function renderExpensesPanel() {
  const ym = _expYM();
  const monthLabel = new Date(ym+'-02').toLocaleString('default',{month:'long',year:'numeric'});
  const monthTotal = _expensesInMonth(ym);
  const curTotal = _expensesInMonth(_currentYM());
  const headSub = !expensesAvailable ? 'setup needed'
    : _expensesLoadError ? 'could not load — refresh'
    : (curTotal ? '&#8369;'+curTotal.toLocaleString()+' this month' : 'none recorded this month');

  let body = '';
  if(_expensesOpen) {
    if(!expensesAvailable) {
      body = `<div class="insights-body"><div class="exp-setup-note">
        The expenses table doesn't exist in your database yet.<br>
        Run <strong>supabase-migration-2.sql</strong> in the Supabase SQL Editor (Dashboard &gt; SQL Editor), then refresh this page.
      </div></div>`;
    } else {
      const loadErrNote = _expensesLoadError
        ? `<div class="exp-setup-note" style="margin-bottom:12px;">Expenses could not be loaded just now — the list below may be incomplete. Refresh the page to retry.</div>`
        : '';
      const monthExpenses = expenses
        .filter(x=>(x.expense_date||'').startsWith(ym))
        .slice().sort((a,b)=>(b.expense_date||'').localeCompare(a.expense_date||''));
      const collected = _collectedInMonth(ym);
      const net = collected - monthTotal;
      const shortDate = d => { const dt=new Date(String(d).slice(0,10)+'T00:00:00'); return isNaN(dt.getTime())?String(d):dt.toLocaleDateString('en-PH',{month:'short',day:'numeric'}); };
      const rows = monthExpenses.length ? monthExpenses.map(x =>
        _editingExpenseId===x.id
          ? `<div class="exp-edit-wrap">${_expFormHtml('edit', x)}</div>`
          : `<div class="exp-row">
              <span class="exp-date">${shortDate(x.expense_date)}</span>
              <span class="exp-cat exp-cat-${esc(x.category||'other')}">${esc(_expCatLabel(x.category))}</span>
              <span class="exp-note">${esc(x.note||'')}</span>
              <span class="exp-amt">&#8369;${(Number(x.amount)||0).toLocaleString()}</span>
              <span class="exp-actions">
                <button class="btn-icon" onclick="editExpense('${esc(x.id)}')" aria-label="Edit">&#9998;</button>
                <button class="btn-icon del" onclick="deleteExpense('${esc(x.id)}')" aria-label="Delete">&#10005;</button>
              </span>
            </div>`).join('')
        : `<div class="exp-empty">No expenses recorded for ${esc(monthLabel)}.</div>`;
      body = `<div class="insights-body">
        ${loadErrNote}
        <div class="exp-toolbar">
          <label for="exp-month-filter" class="exp-toolbar-label">Month</label>
          <input type="month" id="exp-month-filter" value="${ym}" onchange="setExpenseMonth(this.value)">
          <div class="exp-net ${net>=0?'pos':'neg'}" title="Payments collected minus expenses for ${esc(monthLabel)}">
            Collected &#8369;${collected.toLocaleString()} &nbsp;&minus;&nbsp; Expenses &#8369;${monthTotal.toLocaleString()} &nbsp;=&nbsp; <strong>Net ${net<0?'&minus;':''}&#8369;${Math.abs(net).toLocaleString()}</strong>
          </div>
          <button class="btn-generate" style="margin-left:auto;" onclick="exportExpensesCSV()" title="Export all expenses to CSV">&#128190; Export</button>
        </div>
        ${_editingExpenseId?'':_expFormHtml('new', null)}
        <div class="exp-list">${rows}</div>
      </div>`;
    }
  }
  return `<div class="insights-panel expense-panel" id="expense-panel">
    <button class="insights-toggle" onclick="toggleExpenses()" aria-expanded="${_expensesOpen?'true':'false'}">
      <span class="insights-arrow${_expensesOpen?' open':''}">›</span> Expenses <span class="exp-head-sub">${headSub}</span>
    </button>
    ${body}
  </div>`;
}

let _expenseSaving = false;
async function addExpense() {
  if(_expenseSaving) return; // double-click inserts duplicate rows otherwise
  const date = document.getElementById('exp-date-new').value;
  const category = document.getElementById('exp-cat-new').value;
  const rawAmt = document.getElementById('exp-amount-new').value;
  const note = document.getElementById('exp-note-new').value.trim();
  if(!date){ showToast('Please pick the expense date.', false); return; }
  const amount = normalizeAmount(rawAmt);
  if(!amount || amount<=0){ showToast('Please enter a valid amount.', false); return; }
  const rec = { id: uid(), expense_date: date, category, amount, note };
  _expenseSaving = true;
  try {
    await dbInsertExpense(rec);
    expenses.push(rec);
    // Jump the panel to the month the expense was filed under so it's visible.
    expenseMonth = date.slice(0,7)===_currentYM() ? '' : date.slice(0,7);
    showToast('Expense recorded.');
    rerenderAdmin();
  } catch(e) {
    if(/relation .*expenses|expenses.*does not exist|Could not find the table/i.test(e.message||'')) { expensesAvailable=false; rerenderAdmin(); }
    else showToast('Save failed: '+e.message, false);
  } finally { _expenseSaving = false; }
}
function editExpense(id){ _editingExpenseId = id; rerenderAdmin(); }
function cancelExpenseEdit(){ _editingExpenseId = null; rerenderAdmin(); }
async function saveExpenseEdit(id) {
  const x = expenses.find(x=>x.id===id); if(!x) return;
  const date = document.getElementById('exp-date-edit').value;
  const category = document.getElementById('exp-cat-edit').value;
  const amount = normalizeAmount(document.getElementById('exp-amount-edit').value);
  const note = document.getElementById('exp-note-edit').value.trim();
  if(!date){ showToast('Please pick the expense date.', false); return; }
  if(!amount || amount<=0){ showToast('Please enter a valid amount.', false); return; }
  const patch = { expense_date: date, category, amount, note };
  try {
    await dbUpdateExpense(id, patch);
    Object.assign(x, patch);
    _editingExpenseId = null;
    showToast('Expense updated.');
    rerenderAdmin();
  } catch(e) { showToast('Save failed: '+e.message, false); }
}
async function deleteExpense(id) {
  if(!confirm('Delete this expense?')) return;
  try {
    await dbDeleteExpense(id);
    expenses = expenses.filter(x=>x.id!==id);
    if(_editingExpenseId===id) _editingExpenseId = null;
    showToast('Expense deleted.');
    rerenderAdmin();
  } catch(e) { showToast('Delete failed: '+e.message, false); }
}
function exportExpensesCSV() {
  if(!expenses.length){ showToast('No expenses to export yet.', false); return; }
  const rows = [['Date','Category','Amount','Note']];
  expenses.slice().sort((a,b)=>(a.expense_date||'').localeCompare(b.expense_date||''))
    .forEach(x=>rows.push([x.expense_date||'', _expCatLabel(x.category), x.amount, x.note||'']));
  const csv = rows.map(r=>r.map(csvCell).join(',')).join('\n');
  const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'expenses-'+todayISO()+'.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Expenses CSV exported ✓');
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
  const catDue = outstandingByCategory(tenants.flatMap(t=>t.bills));
  document.getElementById('main-content').innerHTML=`
    <div class="page-eyebrow">Dashboard</div>
    <div class="page-title">Tenant Overview</div>
    <div class="summary-strip">
      <div class="summary-stat"><div class="stat-label">Tenants</div><div class="stat-value">${tenants.length}</div><div class="stat-sub">${unpaidCount} unpaid bill${unpaidCount!==1?'s':''}</div></div>
      <div class="summary-stat"><div class="stat-label">Outstanding</div><div class="stat-value blue">&#8369;${totalDue.toLocaleString()}</div>${totalDue?`<div class="stat-lines">${balanceLinesHtml(catDue,'stat-line')}</div>`:`<div class="stat-sub">all unpaid bills</div>`}</div>
      <div class="summary-stat"><div class="stat-label">Overdue</div><div class="stat-value ${overdueDue>0?'rust':'green'}">${overdueDue>0?'&#8369;'+overdueDue.toLocaleString():'None'}</div><div class="stat-sub">${overdueCount>0?overdueCount+' bill'+(overdueCount!==1?'s':'')+' past due':'nothing past due'}</div></div>
      <div class="summary-stat"><div class="stat-label">Collected &middot; ${monthLabel}</div><div class="stat-value green">&#8369;${collectedThisMonth.toLocaleString()}</div><div class="stat-sub">of &#8369;${billedThisMonth.toLocaleString()} billed</div></div>
      <div class="summary-stat"><div class="stat-label">Collection Rate</div><div class="stat-value">${rate===null?'&mdash;':rate+'%'}</div><div class="stat-sub">collected vs billed &middot; ${monthLabel}</div></div>
    </div>
    ${renderInsights()}
    ${renderExpensesPanel()}
    <div class="settings-cards">
      <div class="pay-inst-card">
        <div class="pay-inst-head">
          <div class="pay-inst-label">&#128176; Payment Instructions</div>
          <button class="btn-pay-inst-edit" onclick="openPayInstModal()">Edit</button>
        </div>
        ${paymentInstructions
          ? `<div class="pay-inst-preview">${esc(paymentInstructions)}</div>`
          : `<div class="pay-inst-empty">Not set — tenants will not see payment instructions.</div>`}
      </div>
      <div class="pay-inst-card">
        <div class="pay-inst-head">
          <div class="pay-inst-label">&#128226; Announcements</div>
          <button class="btn-pay-inst-edit" onclick="openAnnounceModal()">Edit</button>
        </div>
        ${announcements
          ? `<div class="pay-inst-preview">${esc(announcements)}</div>`
          : `<div class="pay-inst-empty">Not set — the tenant notice board is hidden.</div>`}
      </div>
      <div class="pay-inst-card">
        <div class="pay-inst-head">
          <div class="pay-inst-label">&#127968; Property</div>
          <button class="btn-pay-inst-edit" onclick="openBrandingModal()">Edit</button>
        </div>
        <div class="pay-inst-preview">${esc(propertyName)}<span style="color:var(--muted)"> · ${esc(propertySubtitle)}</span></div>
      </div>
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
        <button class="btn-generate" onclick="openGenModal()">&#128197; Generate Bills</button>
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
              ${tenants.map(t=>`<option value="${t.id}" ${filterTenantId===t.id?'selected':''}>${esc(t.name)} · Unit ${esc(t.unit)}${(t.floor||'').trim()?' · '+esc(t.floor):''}</option>`).join('')}
            </select>
          </div>
          <div class="filter-popover-row">
            <div class="filter-popover-label">Month</div>
            <select id="fp-month" onchange="if(this.value==='__more__'){renderMonthDropdown(true);return;}filterMonth=this.value;applyFilters(true)">
              ${renderMonthOptions()}
            </select>
          </div>
          ${floorList().length?`<div class="filter-popover-row">
            <div class="filter-popover-label">Floor</div>
            <select id="fp-floor" onchange="filterFloor=this.value;applyFilters(true)">
              <option value="">All Floors</option>
              ${floorList().map(f=>`<option value="${esc(f)}" ${filterFloor===f?'selected':''}>${esc(f)}</option>`).join('')}
              ${tenants.some(t=>!(t.floor||'').trim())?`<option value="__none__" ${filterFloor==='__none__'?'selected':''}>(No floor set)</option>`:''}
            </select>
          </div>`:''}
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
      ${viewMode==='card'?`<div style="position:relative;display:inline-block;" id="sort-popover-wrap">
        <button class="sort-toolbar-btn${sortOrder!=='unit-asc'?' active':''}" onclick="toggleSortPopover()">&#8645; Sort${sortOrder!=='unit-asc'?': '+(SORT_LABELS[sortOrder]||''):''}</button>
        <div class="sort-popover" id="sort-popover">
          ${Object.entries(SORT_LABELS).map(([k,lbl])=>`<button class="sort-option${sortOrder===k?' active':''}" onclick="setSortOrder('${k}')">${lbl}</button>`).join('')}
        </div>
      </div>
      <div style="position:relative;display:inline-block;" id="group-popover-wrap">
        <button class="sort-toolbar-btn${groupMode!=='auto'?' active':''}" onclick="toggleGroupPopover()" title="Group tenants under floor or unit headers with combined balances">&#9638; Group${groupMode!=='auto'?': '+(GROUP_LABELS[groupMode]||''):''}</button>
        <div class="sort-popover" id="group-popover">
          ${Object.entries(GROUP_LABELS).map(([k,lbl])=>`<button class="sort-option${groupMode===k?' active':''}" onclick="setGroupMode('${k}')">${lbl}</button>`).join('')}
        </div>
      </div>`:''}
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
// BILL CATEGORIES — rent vs utilities vs other
// ─────────────────────────────────────────────
// Categories are inferred from the bill label so existing data just works.
const BILL_CATEGORIES = [
  { key:'rent',      label:'Monthly Rent'  },
  { key:'utilities', label:'Utilities'     },
  { key:'other',     label:'Other Charges' }
];

function billCategory(b) {
  const l = (b.label||'').toLowerCase();
  if(/rent/.test(l)) return 'rent';
  if(/electric|kuryente|power|beneco|meralco|water|tubig|internet|wi-?fi|gas\b|cable|utilit/.test(l)) return 'utilities';
  return 'other';
}

// Unpaid remainder per category (mirrors the Math.max(0, billRemaining) rule
// used everywhere outstanding balances are summed).
function outstandingByCategory(bills) {
  const out = { rent:0, utilities:0, other:0, total:0 };
  (bills||[]).forEach(b=>{
    if(b.status==='paid') return;
    const rem = Math.max(0, billRemaining(b));
    if(!rem) return;
    out[billCategory(b)] += rem;
    out.total += rem;
  });
  return out;
}

// Compact inline breakdown ("Rent ₱8,000 · Utilities ₱930"), rent emphasized.
// Returns '' when nothing is owed.
function balanceBreakdownHtml(cat) {
  if(!cat.total) return '';
  const parts = [];
  if(cat.rent)      parts.push('<span class="bb-rent">Rent &#8369;'+cat.rent.toLocaleString()+'</span>');
  if(cat.utilities) parts.push('<span>Utilities &#8369;'+cat.utilities.toLocaleString()+'</span>');
  if(cat.other)     parts.push('<span>Other &#8369;'+cat.other.toLocaleString()+'</span>');
  return '<div class="bal-break">'+parts.join('<span class="bb-sep">&middot;</span>')+'</div>';
}

// Stacked line items for the dashboard / portal stat cards. Rent is always
// listed when something is owed (a ₱0 rent line is a useful signal);
// utilities/other only when non-zero.
function balanceLinesHtml(cat, cls) {
  if(!cat.total) return '';
  const line = (label, v, extra) =>
    '<div class="'+cls+(extra?' '+extra:'')+'"><span>'+label+'</span><span>&#8369;'+v.toLocaleString()+'</span></div>';
  return line('Monthly Rent', cat.rent, 'rent')+
    (cat.utilities ? line('Utilities', cat.utilities) : '')+
    (cat.other ? line('Other Charges', cat.other) : '');
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
    await dbUpdateTenantGuarded(t, {bills: billsCopy});
    t.bills = billsCopy;
    if(toastMsg) showToast(toastMsg);
    return true;
  } catch(e) {
    showToast(e.conflict ? e.message : 'Save failed: '+e.message, false);
    if(e.conflict){ rerenderAdmin(); return 'conflict'; }
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
    // Older overdue sorts first. Math.round, not floor: both timestamps are
    // local midnights, so a DST change makes the diff 23h/25h per boundary
    // and floor would be off by one.
    const today=new Date(); today.setHours(0,0,0,0);
    const days = bill.due ? Math.round((today-new Date(bill.due+'T00:00:00'))/86400000) : 0;
    return -days;
  }
  if(s==='due-today') return 1;
  if(s==='due-soon')  return 2;
  if(s==='upcoming'){
    const today=new Date(); today.setHours(0,0,0,0);
    return 3+Math.round((new Date(bill.due+'T00:00:00')-today)/(86400000));
  }
  if(s==='no-date') return 900;
  return 1000; // paid sorts last
}
// Days a bill is past due (0 if not overdue / no due date)
function daysOverdue(bill) {
  if(bill.status==='paid' || !bill.due) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(bill.due+'T00:00:00');
  return d < today ? Math.round((today-d)/86400000) : 0;
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
// Floor labels rank like units, except ground floor sorts first.
function floorRank(s) {
  return /\bground\b|^g\/?f\b/i.test(s) ? 0 : unitRank(s);
}
// Distinct floor labels currently in use, in floor order.
function floorList() {
  const set = new Set();
  tenants.forEach(t=>{ const f=(t.floor||'').trim(); if(f) set.add(f); });
  return Array.from(set).sort((a,b)=>floorRank(a)-floorRank(b) || a.localeCompare(b));
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

  // Apply floor filter ('__none__' = tenants without a floor label)
  if (filterFloor) {
    const want = filterFloor==='__none__' ? '' : filterFloor;
    filtered = filtered.filter(t => (t.floor||'').trim() === want);
  }

  // Apply search — matches tenants (name / unit / access code) OR bills
  // (label / remark). A tenant match shows the whole tenant; a bill-only
  // match narrows that tenant's bill list to just the matching bills, so
  // typing "water" surfaces every water bill across all tenants.
  if (filterSearch.trim()) {
    const q = filterSearch.trim().toLowerCase();
    const tenantHit = t =>
      (t.name||'').toLowerCase().includes(q) ||
      (t.unit||'').toLowerCase().includes(q) ||
      (t.floor||'').toLowerCase().includes(q) ||
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
    else if(sortOrder==='floor-asc')    r = floorRank((a.floor||'').trim()||'zz')-floorRank((b.floor||'').trim()||'zz');
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

  const buildCard = t=>{
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
    // All-inclusive tenants have a single rent line; a category breakdown
    // would just repeat the total.
    const totalBreak = (due && t.billing_model!=='inclusive') ? balanceBreakdownHtml(outstandingByCategory(activeBills)) : '';
    const hasBalance = orig.bills.some(b=>b.status!=='paid' && billRemaining(b)>0);
    const actions = `<div class="row-actions"><button class="btn-statement" style="padding:4px 10px;font-size:10px;" onclick="openStmtModalById('${t.id}')" aria-label="Generate statement">Statement</button>${hasBalance?`<button class="btn-icon" onclick="copyReminder('${t.id}')" title="Copy payment reminder" aria-label="Copy payment reminder">&#9993;</button>`:''}<button class="btn-icon" onclick="copyPortalLink('${t.id}')" title="Copy portal link (logs the tenant straight in)" aria-label="Copy portal link">&#128279;</button><button class="btn-icon" onclick="openQuickBill('${t.id}')" title="Add bill" aria-label="Add bill">&#65291;</button><button class="btn-icon" onclick="openEditModal('${t.id}')" title="Edit tenant" aria-label="Edit">&#9998;</button><button class="btn-icon del" onclick="deleteTenant('${t.id}')" title="Archive tenant (kept, restorable)" aria-label="Archive">&#128451;</button></div>`;

    // Active bill badges sorted by urgency, coloured by derived due-status
    const sortedActive = activeBills.slice().sort((a,b)=>getDueUrgencyScore(a)-getDueUrgencyScore(b));
    const activeBadges = sortedActive.length
      ? sortedActive.map(b=>{
          const bi=origBillIndex(b);
          const ds=getDueStatus(b);
          const rem=Math.max(0,billRemaining(b));
          const tip=`&#8369;${Number(b.amount).toLocaleString()}${b.due?' · due '+formatDate(b.due):''}${b.remark?' · '+esc(b.remark):''} — click to mark paid`;
          // Due date rendered visibly — title tooltips never show on touch
          // devices, and the phone is where the landlord actually works.
          const dueBit = b.due ? `<span class="mini-status-due">· ${shortDate(b.due)}</span>` : '';
          return `<button class="mini-status ${dsBadgeClass(ds)}" onclick="toggleStatus('${t.id}',${bi})" title="${tip}">${esc(b.label)} &#8369;${rem.toLocaleString()} ${dueBit}</button>`;
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
        <div class="tenant-row-footer"><div class="row-total-label">Balance Due</div><div class="row-total" style="text-align:right;">${total}${totalBreak}</div></div>
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
        <div class="row-total col-center">${total}${totalBreak}</div>
        ${actions}
      </div>
      ${paidSection}
    </div>`;
  };

  // ── Grouping — render group headers with rollups (tenant count + real
  // outstanding balance). Two dimensions:
  //   floor: one header per floor/group label
  //   unit:  one header per physical unit — the right view when several
  //          per-head all-inclusive tenants share one unit
  // 'auto' preserves the historical default: floor headers when floor labels
  // exist AND the list is unit-sorted (interleaving group headers into a
  // balance-sorted list would be misleading). Explicit modes always group.
  let keyOf = null, labelOf = null, rankOf = null;
  if(groupMode==='floor' ||
     (groupMode==='auto' && (sortOrder==='unit-asc'||sortOrder==='unit-desc'||sortOrder==='floor-asc')
       && filtered.some(t=>(t.floor||'').trim()))) {
    keyOf   = t => (t.floor||'').trim();
    labelOf = k => k ? esc(k) : 'Unassigned';
    rankOf  = floorRank;
  } else if(groupMode==='unit') {
    keyOf   = t => (t.unit||'').trim();
    labelOf = k => k ? 'Unit '+esc(k) : 'No unit';
    rankOf  = unitRank;
  }
  if(!keyOf){
    c.innerHTML = filtered.map(buildCard).join('');
    return;
  }
  const groupKeys = []; const groupMap = {};
  filtered.forEach(t=>{
    const k = keyOf(t);
    if(!(k in groupMap)){ groupMap[k]=[]; groupKeys.push(k); }
    groupMap[k].push(t);
  });
  groupKeys.sort((a,b)=>{
    if(!a) return 1; if(!b) return -1;           // unassigned tenants sink last
    const r = rankOf(a)-rankOf(b);
    return (sortOrder==='unit-desc' ? -r : r) || a.localeCompare(b);
  });
  c.innerHTML = groupKeys.map(k=>{
    const list = groupMap[k];
    // Rollup uses the ORIGINAL tenants so filters can't understate what's owed.
    const out = list.reduce((s,t)=>{ const orig=tenants.find(ot=>ot.id===t.id)||t; return s+tenantBalance(orig); },0);
    // For a unit whose tenants are all on the flat rate, say so in the header —
    // it reads as "this unit is per-head all-inclusive" at a glance.
    const allInclusive = groupMode==='unit' && list.length>0 && list.every(t=>{
      const orig = tenants.find(ot=>ot.id===t.id)||t;
      return orig.billing_model==='inclusive';
    });
    const meta = `${list.length} tenant${list.length!==1?'s':''}`
      + (allInclusive?' &nbsp;·&nbsp; all-inclusive':'')
      + ` &nbsp;·&nbsp; ${out?'&#8369;'+out.toLocaleString()+' outstanding':'settled'}`;
    const head = `<div class="floor-group-head"><span class="floor-group-name">${labelOf(k)}</span><span class="floor-group-meta">${meta}</span></div>`;
    return head + list.map(buildCard).join('');
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
      case 'floor':     r = (floorRank((a.tenant.floor||'').trim()||'zz') - floorRank((b.tenant.floor||'').trim()||'zz')) * dir; break;
      case 'label':     r = (a.bill.label || '').localeCompare(b.bill.label || '') * dir; break;
      case 'amount':    r = ((Number(a.bill.amount) || 0) - (Number(b.bill.amount) || 0)) * dir; break;
      case 'remaining': {
        // Sort by the same value the column displays: paid bills owe 0.
        const remOf = x => x.status==='paid' ? 0 : Math.max(0, billRemaining(x));
        r = (remOf(a.bill) - remOf(b.bill)) * dir; break;
      }
      case 'due':       r = cmpDate(a.bill.due, b.bill.due); break;
      case 'paidDate':  r = cmpDate(a.bill.paidDate, b.bill.paidDate); break;
      case 'remark':    r = (a.bill.remark || '').localeCompare(b.bill.remark || '') * dir; break;
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

  // Floor column only when the field is in use — no dead column otherwise.
  const showFloor = tenants.some(t=>(t.floor||'').trim());

  const totalRows = rows.length;
  const capped = rows.slice(0, tableRowLimit);

  const tbody = capped.map(r => {
    const b = r.bill, t = r.tenant;
    const ds = b.status === 'paid' ? 'paid' : getDueStatus(b);
    const isPaid = b.status === 'paid';
    // Paid bills owe nothing, even when partial payments weren't logged.
    const remaining = isPaid ? 0 : Math.max(0, billRemaining(b));
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
      (showFloor ? '<td>'+esc(t.floor||'')+'</td>' : '') +
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
      (showFloor ? thHtml('floor','Floor') : '') +
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
  // Commit to DB then update local state and re-render. Full re-render so
  // the summary stats, Insights, and Action Required pick up the new amount
  // too — not just the table rows.
  const billsCopy = structuredClone(t.bills);
  billsCopy[bi].amount = next;
  try {
    await dbUpdateTenantGuarded(t, {bills: billsCopy});
    t.bills = billsCopy;
    showToast('Amount updated.');
    rerenderAdmin();
  } catch(e){
    showToast(e.conflict ? e.message : 'Save failed: '+e.message, false);
    if(e.conflict){ rerenderAdmin(); return; }
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
  document.getElementById('paiddate-input').value=todayISO();
  openModal('paiddate-modal');
}

function closePaidModal(){
  closeModalEl('paiddate-modal');
  _pendingPaid=null;
}

async function confirmPaid(){
  if(!_pendingPaid) return;
  const {tid,bi}=_pendingPaid;
  // Save FIRST, close on success. Closing before the save meant a failed
  // request was only a 2.5-second toast and the admin walked away believing
  // the payment was recorded.
  const btn = document.querySelector('#paiddate-modal .btn-save');
  if(btn && btn.disabled) return; // double-click guard
  if(btn){ btn.disabled=true; btn.textContent='Saving…'; }
  const dateVal=document.getElementById('paiddate-input').value;
  const ok = await saveBills(tid, bills=>{
    if(!bills[bi]) return;
    bills[bi].status='paid';
    bills[bi].paidDate=dateVal||todayISO();
  }, 'Marked as paid ✓');
  if(btn){ btn.disabled=false; btn.textContent='Confirm Paid'; }
  // 'conflict' (truthy) also closes: the tenant row was reloaded, so the
  // remembered bill INDEX may now point at a different bill — retrying the
  // stale index could mark the wrong bill paid. The admin re-taps instead.
  if(ok){ closePaidModal(); rerenderAdmin(); }
  // On a plain failure (no reload) the modal stays open so the admin can retry.
}

async function revertToPending(tid,bi){
  // Destructive: clears the recorded paid date, which the Collected insights
  // key off. A stray tap must not silently rewrite history.
  const t = tenants.find(t=>t.id===tid);
  const b = t && t.bills[bi];
  const when = b && b.paidDate ? ' (paid '+formatDate(b.paidDate)+')' : '';
  if(!confirm('Move this bill back to unpaid?'+when+' The recorded paid date will be cleared.')) return;
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
          <div style="font-size:11px;color:var(--muted);">Unit ${esc(t.unit)}${(t.floor||'').trim()?' &nbsp;·&nbsp; '+esc(t.floor):''} &nbsp;·&nbsp; Archived ${formatDate((t.archived_at||'').slice(0,10))}</div>
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

// Show the flat-rate field only for the all-inclusive billing model.
function onBillingModelChange(){
  const model = document.getElementById('m-billing').value;
  document.getElementById('m-flatrate-wrap').style.display = model==='inclusive' ? 'block' : 'none';
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
  document.getElementById('m-floor').value='';
  document.getElementById('m-billing').value='itemized';
  document.getElementById('m-flatrate').value='';
  onBillingModelChange();
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
  _showAllPaidBills = false; // each tenant starts with the compact paid list
  document.getElementById('modal-eyebrow').textContent='Edit Tenant';
  document.getElementById('modal-title').textContent=t.name; // textContent — no HTML-escaping needed
  const saveBtn=document.getElementById('btn-save-tenant'); if(saveBtn) saveBtn.textContent='Save changes';
  document.getElementById('m-name').value=t.name;
  document.getElementById('m-unit').value=t.unit;
  document.getElementById('m-code').value=t.code;
  document.getElementById('m-phone').value=t.phone||'';
  document.getElementById('m-email').value=t.email||'';
  document.getElementById('m-movein').value=t.move_in_date||'';
  document.getElementById('m-floor').value=t.floor||'';
  document.getElementById('m-billing').value=t.billing_model==='inclusive'?'inclusive':'itemized';
  document.getElementById('m-flatrate').value=(t.flat_rate!=null && t.flat_rate!=='')?t.flat_rate:'';
  onBillingModelChange();
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

// Remember the expanded/collapsed choice across the instant-save re-renders,
// so editing a paid bill doesn't collapse the list and hide that very bill.
let _showAllPaidBills = false;
function renderBillListItems(showAllPaid){
  if(showAllPaid===undefined) showAllPaid = _showAllPaidBills;
  else _showAllPaidBills = !!showAllPaid;
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
  const paidDate=newStatus==='paid'?(pdInput?pdInput.value||todayISO():todayISO()):'';
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
  const paidDate=status==='paid'?(document.getElementById('nb-paidDate').value||todayISO()):'';
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
  const floor=document.getElementById('m-floor').value.trim();
  const billing_model=document.getElementById('m-billing').value==='inclusive'?'inclusive':'itemized';
  const _frRaw=document.getElementById('m-flatrate').value;
  if(billing_model==='inclusive'){
    const _frNum = Number(String(_frRaw).replace(/,/g,'').trim());
    if(String(_frRaw).trim()===''){ showToast('Please enter the monthly flat rate for an all-inclusive tenant.',false); return; }
    // A typo like "6,5o0" must not silently save as ₱0.
    if(!isFinite(_frNum) || _frNum < 0){ showToast('Flat rate must be a non-negative number.',false); return; }
  }
  const flat_rate=billing_model==='inclusive' ? normalizeAmount(_frRaw) : null;
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
      paidDate: b.status==='paid' ? (b.paidDate || todayISO()) : '',
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
  // All-inclusive tenants get a monthly bill template automatically when they
  // have none, so Generate Bills covers them from day one. Billing day comes
  // from the first bill's due date, else the move-in date, else the 1st.
  let templates = existingTemplates.slice();
  let autoTemplate = false;
  if(billing_model==='inclusive' && flat_rate>0 && !templates.length){
    const _dayOf = s => { const d=Number(String(s||'').slice(8,10)); return d>=1&&d<=31?d:0; };
    const day = _dayOf((bills.find(b=>b.due)||{}).due) || _dayOf(move_in_date) || 1;
    templates.push({id:uid(), label:'Monthly Rent (All-Inclusive)', amount:flat_rate, dayOfMonth:day, pendingAmount:false});
    autoTemplate = true;
  }
  const fields = {name,unit,code,phone,email,move_in_date,floor,billing_model,flat_rate,bills,templates};
  setLoading(true, savingId?'Saving changes…':'Adding tenant…');
  try {
    if(savingId){
      const tObj = tenants.find(t=>t.id===savingId);
      await dbUpdateTenantGuarded(tObj, fields);
      tenants=tenants.map(t=>t.id===savingId?{...t,...fields}:t);
      setLoading(false);
      closeModal();
      showToast(autoTemplate?'Changes saved — monthly bill template created.':'Changes saved.');
    } else {
      const rec={id:uid(),...fields};
      // Use the returned row so server defaults (rev, etc.) are in memory.
      const inserted = await dbInsert(rec);
      tenants.push(_normalizeTenant((inserted && inserted[0]) || rec));
      setLoading(false);
      closeModal();
      showToast(autoTemplate?'Tenant added — monthly bill template created.':'Tenant added.');
    }
    rerenderAdmin();
  } catch(e){
    setLoading(false);
    if(e.conflict){ showToast(e.message, false); closeModal(); rerenderAdmin(); }
    else if(/billing_model|flat_rate|floor/.test(e.message||'')) alert(SCHEMA2_NOTE);
    else showToast('Error: '+e.message, false);
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
  sel.innerHTML = sorted.map(t=>`<option value="${esc(t.id)}"${tid===t.id?' selected':''}>${esc(t.name)} · Unit ${esc(t.unit)}${(t.floor||'').trim()?' · '+esc(t.floor):''}</option>`).join('');
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
    document.getElementById('qb-paiddate').value = todayISO();
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
  const paidDate = isPaid ? (document.getElementById('qb-paiddate').value || todayISO()) : '';
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
  const catDue         = outstandingByCategory(allActiveBills);

  // ── All-inclusive tenants: one predictable number, so the header answers
  // "am I paid up this month?" instead of repeating the same figure 3 times.
  const isInclusive = t.billing_model==='inclusive';
  const _tmplRate = (t.templates||[]).find(x=>/rent/i.test(x.label||'')) || (t.templates||[])[0];
  const flatRate = Number(t.flat_rate) || (_tmplRate && !_tmplRate.pendingAmount ? Number(_tmplRate.amount) : 0) || 0;
  const monthName = now.toLocaleString('default',{month:'long'});
  const curMonthBills  = t.bills.filter(b=>b.due&&b.due.startsWith(curYM));
  const curMonthUnpaid = curMonthBills.filter(b=>b.status!=='paid');
  const curMonthPaid   = curMonthBills.filter(b=>b.status==='paid');
  const pastDue        = allActiveBills.filter(b=>!(b.due&&b.due.startsWith(curYM)))
                          .reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  let monthCardValue='', monthCardSub='', monthCardCls='';
  if(curMonthUnpaid.length){
    const most = curMonthUnpaid.slice().sort((a,b)=>getDueUrgencyScore(a)-getDueUrgencyScore(b))[0];
    const ds = getDueStatus(most);
    monthCardValue = '&#8369;'+thisMonthDue.toLocaleString();
    monthCardCls = (ds==='overdue'||ds==='due-today') ? 'overdue' : '';
    monthCardSub = ds==='overdue' ? 'Overdue — was due '+formatDate(most.due)
                 : ds==='due-today' ? 'Due today'
                 : 'Due '+formatDate(most.due);
  } else if(curMonthPaid.length){
    const lastPaid = curMonthPaid.slice().sort((a,b)=>(b.paidDate||'').localeCompare(a.paidDate||''))[0];
    monthCardValue = 'Paid &#10003;';
    monthCardCls = 'clear';
    monthCardSub = lastPaid.paidDate ? 'on '+formatDate(lastPaid.paidDate) : 'Thank you!';
  } else {
    monthCardValue = 'No bill yet';
    monthCardCls = 'clear';
    monthCardSub = flatRate ? ('&#8369;'+flatRate.toLocaleString()+' expected for '+monthName) : ('Nothing posted for '+monthName+' yet');
  }

  // Month pill list — derive from all bills with a due date
  const monthSet = new Set();
  t.bills.filter(b=>b.due&&b.status!=='paid').forEach(b=>monthSet.add(b.due.slice(0,7)));
  const monthList = Array.from(monthSet).sort().reverse(); // newest first

  // Resolve active filter month
  const activeYM = portalMonth==='current' ? curYM : portalMonth;
  const activeMonthName = portalMonth==='all' ? '' : new Date(activeYM+'-02').toLocaleString('default',{month:'long',year:'numeric'});
  const footerLabel = portalMonth!=='all' ? 'Due for '+activeMonthName.split(' ')[0] : 'Total Balance Due';

  // Filter + sort active bills for display. Bills with NO due date are shown
  // in every view — they're open obligations that belong to no month, and
  // hiding them behind the 'All' pill made them effectively invisible.
  function sortByUrgency(bills) {
    return bills.slice().sort((a,b)=>getDueUrgencyScore(a)-getDueUrgencyScore(b));
  }
  const activeBills = sortByUrgency(
    portalMonth==='all'
      ? allActiveBills
      : allActiveBills.filter(b=>!b.due || b.due.startsWith(activeYM))
  );
  const due = activeBills.reduce((s,b)=>s+Math.max(0,billRemaining(b)),0);
  const hiddenDue = totalDue - due; // owed in months outside the current view
  // A tenant with only old debt must still be able to reach it: show the
  // pills whenever any owing month differs from the current one.
  const showPills = monthList.length > 1 || (monthList.length===1 && monthList[0]!==curYM);
  const emptyMsg = portalMonth==='all'
    ? 'All bills are settled.'
    : (hiddenDue>0
        ? 'No unpaid bills for '+activeMonthName+' — but &#8369;'+hiddenDue.toLocaleString()+' is still owed from other months.<br><button class="btn-statement" style="margin-top:10px;" onclick="setPortalMonth(\'all\')">View all bills</button>'
        : 'No bills for '+activeMonthName+'.');

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
        <div class="portal-pull-sub">Unit ${esc(t.unit)}${(t.floor||'').trim()?' &nbsp;·&nbsp; '+esc(t.floor):''}${isInclusive?' &nbsp;·&nbsp; All-inclusive rate':''} &nbsp;·&nbsp; Contact management if anything looks incorrect.</div>
      </div>
      ${announcements?`
      <div class="portal-announce">
        <div class="portal-announce-eyebrow">&#128226; Announcements</div>
        <div class="portal-announce-body">${esc(announcements)}</div>
      </div>`:''}
      ${isInclusive&&flatRate?`
      <div class="portal-rate-banner">
        <div class="portal-rate-main">
          <div class="portal-rate-label">Your Monthly Rate</div>
          <div class="portal-rate-value">&#8369;${flatRate.toLocaleString()}<span class="portal-rate-per">/month</span></div>
        </div>
        <div class="portal-rate-sub">All-inclusive</div>
      </div>`:''}
      ${isInclusive?`
      <div class="portal-balance-strip inclusive-strip">
        <div class="portal-bal-stat">
          <div class="portal-bal-label">${esc(monthName)}</div>
          <div class="portal-bal-value ${monthCardCls}">${monthCardValue}</div>
          <div class="portal-bal-sub">${monthCardSub}</div>
        </div>
        <div class="portal-bal-stat">
          <div class="portal-bal-label">Past Due</div>
          <div class="portal-bal-value ${pastDue>0?'overdue':'clear'}">${pastDue?'&#8369;'+pastDue.toLocaleString():'None'}</div>
          <div class="portal-bal-sub">${pastDue?'from earlier months &mdash; listed below':'you are fully caught up'}</div>
        </div>
      </div>`:`
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
          ${totalDue?`<div class="portal-bal-break">${balanceLinesHtml(catDue,'portal-bal-line')}</div>`:''}
        </div>
      </div>`}
      <div class="bills-card">
        <div class="bills-card-head">
          <div class="bills-card-head-row">
            <div class="bills-card-title">Your Bills</div>
            <div style="display:flex;gap:10px;align-items:center;">
              ${!paidBills.length&&t.bills.length?`<button onclick="openStmtModal(currentUser)" class="btn-statement" style="font-size:11px;">Generate Statement</button>`:''}
              <div class="bills-count">${activeBills.length} bill${activeBills.length!==1?'s':''}</div>
            </div>
          </div>
          ${showPills ? monthPills : ''}
        </div>
        ${activeBills.length
          ? activeBills.map(billRow).join('')
          : `<div class="empty-state" style="padding:32px 24px"><div class="icon" style="font-size:24px;margin-bottom:8px">${portalMonth!=='all'&&hiddenDue>0?'&#9888;':'&#10003;'}</div><p>${emptyMsg}</p></div>`}
        <div class="bills-footer">
          <div>
            <div class="footer-label">${footerLabel}</div>
            ${portalMonth!=='all'&&hiddenDue>0?`<div class="footer-alltime">Total owed, all months: <strong>&#8369;${totalDue.toLocaleString()}</strong></div>`:''}
          </div>
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
  // Accept "1,234.50" plus plain numbers; reject negatives and non-finite
  // values ("Infinity" JSON-serializes to null and would wipe the amount).
  if(val == null) return 0;
  const cleaned = String(val).replace(/,/g,'').trim();
  const n = Number(cleaned);
  if(!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

// Today as YYYY-MM-DD in the USER'S timezone. toISOString() is UTC, which
// stamped yesterday's date on payments recorded before 8 AM Philippine time.
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
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
    // Escaped: this return value flows into innerHTML sinks, and echoing a
    // malformed value raw would be a stored-XSS foothold.
    return esc(String(d));
  }
  return dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'});
}
// Compact date for tight UI (badges, expense rows): "Aug 5"
function shortDate(d) {
  if(!d) return '';
  const dt = new Date(String(d).slice(0,10)+'T00:00:00');
  if(isNaN(dt.getTime())) return esc(String(d));
  return dt.toLocaleDateString('en-PH',{month:'short',day:'numeric'});
}
let _portalSettingsPromise = null;
document.addEventListener('DOMContentLoaded',()=>{
  const _wire = (id, fn) => { const el=document.getElementById(id); if(el) el.addEventListener('click',e=>{if(e.target===el)fn();}); };
  _wire('tenant-modal',  closeModal);
  _wire('paiddate-modal', closePaidModal);
  _wire('payinst-modal', closePayInstModal);
  _wire('announce-modal', closeAnnounceModal);
  _wire('branding-modal', closeBrandingModal);
  _wire('stmt-modal',    closeStmtModal);
  _wire('genbills-modal', closeGenModal);
  _wire('addbill-modal', closeQuickBill);

  // Apply the cached property name instantly (no flash of the default),
  // then refresh from the server in the background.
  try {
    const cached = JSON.parse(localStorage.getItem('oa_branding'));
    if(cached && cached.name) { propertyName = cached.name; propertySubtitle = cached.sub || propertySubtitle; }
  } catch {}
  applyBranding();
  _portalSettingsPromise = loadPortalSettings().catch(()=>{});

  // Detect Supabase password recovery redirect
  checkPasswordRecovery();

  // Silent login from a portal link or a remembered code.
  tryAutoLogin();
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
  return 'Hi '+t.name+', this is a friendly reminder from '+propertyName+'.\n\n'
    + 'Outstanding bills for Unit '+t.unit+':\n'
    + lines.join('\n') + '\n\n'
    + 'Total due: ₱'+total.toLocaleString()
    + (paymentInstructions ? '\n\nHow to pay:\n'+paymentInstructions : '')
    + '\n\nView your bills anytime: '+portalLinkFor(t)
    + '\n\nThank you!';
}

// One-tap portal link for a tenant — the code in the URL logs them straight in.
function portalLinkFor(t){
  return window.location.origin + window.location.pathname + '?code=' + encodeURIComponent(t.code);
}
async function copyPortalLink(tid){
  const t = tenants.find(t=>t.id===tid); if(!t) return;
  const link = portalLinkFor(t);
  const done = () => showToast('Portal link for '+t.name+' copied — send it via SMS / Messenger / Viber.');
  try {
    await navigator.clipboard.writeText(link);
    done();
  } catch {
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch { showToast('Could not copy automatically.', false); }
    ta.remove();
  }
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
  document.getElementById('paiddate-input').value = todayISO();
  openModal('paiddate-modal');
}

// ─────────────────────────────────────────────
// TEMPLATE MANAGEMENT
// ─────────────────────────────────────────────
const SCHEMA_NOTE = 'Templates column missing in Supabase. Run this SQL in your Supabase dashboard:\n\nALTER TABLE tenants ADD COLUMN IF NOT EXISTS templates jsonb NOT NULL DEFAULT \'[]\';\n\nThen refresh and try again.';
// Error message for missing templates column
const SCHEMA2_NOTE = 'Your database is missing the v2 columns (billing model / flat rate / floor).\n\nRun supabase-migration-2.sql in the Supabase SQL Editor (Dashboard > SQL Editor), then refresh and try again.';

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
  // Parse like every other money field: commas allowed, negatives rejected.
  const amtRaw = document.getElementById('te-amount-'+i).value;
  const amtNum = Number(String(amtRaw).replace(/,/g,'').trim());
  if(!_isPending && (isNaN(amtNum) || amtNum < 0)){ showToast('Amount must be a non-negative number.', false); return; }
  const amt = _isPending ? 0 : normalizeAmount(amtRaw);
  if(!_isPending&&amt===0){if(!confirm('The amount is currently set to ₱0. Save anyway?')) return;}
  const day = Number(document.getElementById('te-day-'+i).value);
  if(!day||day<1||day>31){showToast('Due day must be between 1 and 31.',false);return;}
  const t = tenants.find(t=>t.id===editingId); if(!t||!t.templates||!t.templates[i]) return;
  // Copy → save → commit, so a failed request never leaves the UI diverged.
  const templatesCopy = structuredClone(t.templates);
  templatesCopy[i] = {
    ...templatesCopy[i],
    label:  document.getElementById('te-label-'+i).value.trim(),
    amount: amt, dayOfMonth: day,
    pendingAmount: _isPending
  };
  try {
    await dbUpdateTenantGuarded(t, {templates: templatesCopy});
    t.templates = templatesCopy;
    tenants = tenants.map(x=>x.id===t.id?t:x);
    showToast('Template saved.');
    renderTemplateList();
  } catch(e){ if(e.conflict){ showToast(e.message,false); renderTemplateList(); rerenderAdmin(); } else templateSaveErr(e); }
}

async function deleteTemplate(i) {
  if(!confirm('Delete this template?')) return;
  const t = tenants.find(t=>t.id===editingId); if(!t||!t.templates) return;
  const templatesCopy = structuredClone(t.templates);
  templatesCopy.splice(i,1);
  try {
    await dbUpdateTenantGuarded(t, {templates: templatesCopy});
    t.templates = templatesCopy;
    tenants = tenants.map(x=>x.id===t.id?t:x);
    showToast('Template deleted.');
    renderTemplateList();
    rerenderAdmin();
  } catch(e){ if(e.conflict){ showToast(e.message,false); renderTemplateList(); rerenderAdmin(); } else templateSaveErr(e); }
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
  const amtRaw = document.getElementById('nt-amount').value;
  const amtNum = Number(String(amtRaw).replace(/,/g,'').trim());
  if(!_ntPending && (isNaN(amtNum) || amtNum < 0)){ showToast('Amount must be a non-negative number.', false); return; }
  const amt = _ntPending ? 0 : normalizeAmount(amtRaw);
  if(!_ntPending&&amt===0){ showToast('Note: amount is set to ₱0.',true); }
  const day = Number(document.getElementById('nt-day').value);
  if(!day||day<1||day>31){showToast('Due day must be between 1 and 31.',false);return;}
  const t = tenants.find(t=>t.id===editingId); if(!t) return;
  // Copy → save → commit: a failed save must not leave a phantom template
  // in memory that a later save would silently persist.
  const templatesCopy = structuredClone(t.templates || []);
  templatesCopy.push({id:uid(), label, amount:amt, dayOfMonth:day, pendingAmount:_ntPending});
  try {
    await dbUpdateTenantGuarded(t, {templates: templatesCopy});
    t.templates = templatesCopy;
    tenants = tenants.map(x=>x.id===t.id?t:x);
    showToast('Template added.');
    cancelNewTemplate();
    renderTemplateList();
    rerenderAdmin();
  } catch(e){ if(e.conflict){ showToast(e.message,false); renderTemplateList(); rerenderAdmin(); } else templateSaveErr(e); }
}

// ─────────────────────────────────────────────
// GENERATE BILLS MODAL
// Built to scale: with a handful of tenants it looks like a simple list,
// with dozens it becomes floor sections with check-all toggles under a
// summary bar. Selection state lives in _genState (not DOM checkboxes) so
// collapsing a section can't lose choices, and already-generated bills
// compress to one note per tenant instead of a wall of disabled rows.
// ─────────────────────────────────────────────
let _genState = null;    // {yr, mo, useGroups, groups:[{key, entries:[{t, rows}]}]}
let _genOpenGroups = {}; // group key -> bool; unset keys use the render default

function openGenModal() {
  const now = new Date();
  const ym = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('gen-month-input').value = ym;
  _genOpenGroups = {};
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

  const _normLabel = s => s.trim().toLowerCase();
  const entries = [];
  tenants.forEach(t => {
    const tmpls = t.templates||[];
    if(!tmpls.length) return;
    const rows = tmpls.map(tmpl => {
      // Cap the due day to the last day of shorter months.
      const dueDay = Math.min(tmpl.dayOfMonth, new Date(yr, mo, 0).getDate());
      const dueDate = `${yr}-${String(mo).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`;
      const alreadyExists = t.bills.some(b => _normLabel(b.label)===_normLabel(tmpl.label) && b.due && b.due.startsWith(`${yr}-${String(mo).padStart(2,'0')}`));
      return {tmpl, dueDate, alreadyExists, selected: !alreadyExists};
    });
    entries.push({t, rows});
  });

  if(!entries.length) {
    _genState = null;
    document.getElementById('gen-preview-body').innerHTML = '<div class="gen-empty">No templates found. Open a tenant\'s edit modal and add templates first.</div>';
    _genUpdateButton();
    return;
  }

  const groupMap = {}; const groupOrder = [];
  entries.forEach(e => {
    const k = (e.t.floor||'').trim();
    if(!(k in groupMap)){ groupMap[k]=[]; groupOrder.push(k); }
    groupMap[k].push(e);
  });
  groupOrder.sort((a,b)=>{ if(!a) return 1; if(!b) return -1; return floorRank(a)-floorRank(b) || a.localeCompare(b); });
  _genState = {
    yr, mo,
    useGroups: groupOrder.length > 1,
    groups: groupOrder.map(k=>({key:k, entries:groupMap[k]}))
  };
  renderGenPreview();
}

function _genAllRows() {
  if(!_genState) return [];
  const out = [];
  _genState.groups.forEach(g=>g.entries.forEach(e=>e.rows.forEach(r=>out.push(r))));
  return out;
}
// Totals over a set of rows: selected count, peso total, pending-amount
// count (no peso value yet), and how many were skipped as already existing.
function _genTotals(rows) {
  let count=0, amount=0, pendingCount=0, skipped=0;
  rows.forEach(r=>{
    if(r.alreadyExists){ skipped++; return; }
    if(!r.selected) return;
    count++;
    if(r.tmpl.pendingAmount) pendingCount++;
    else amount += Number(r.tmpl.amount)||0;
  });
  return {count, amount, pendingCount, skipped};
}
function _genUpdateButton() {
  const btn = document.getElementById('gen-confirm-btn');
  if(!btn) return;
  const tot = _genTotals(_genAllRows());
  btn.disabled = !tot.count;
  btn.textContent = tot.count ? 'Generate '+tot.count+' Bill'+(tot.count!==1?'s':'') : 'Nothing to Generate';
}

function renderGenPreview() {
  if(!_genState) return;
  const all = _genAllRows();
  const tot = _genTotals(all);
  const selectable = all.filter(r=>!r.alreadyExists).length;
  // Small runs stay fully expanded; big runs start collapsed to their
  // per-floor rollups so the admin reviews totals, not sixty rows.
  const defaultOpen = !_genState.useGroups || selectable <= 10;

  const summary = `<div class="gen-summary">
    <div class="gen-summary-main"><strong>${tot.count} bill${tot.count!==1?'s':''}</strong> selected
      &nbsp;·&nbsp; &#8369;${tot.amount.toLocaleString()}${tot.pendingCount?' + '+tot.pendingCount+' pending-amount':''}
      ${tot.skipped?`&nbsp;·&nbsp; <span class="gen-summary-skip">${tot.skipped} already generated</span>`:''}
    </div>
    ${selectable?`<div class="gen-summary-actions">
      <button class="gen-mini-btn" onclick="genSetAll(true)">Select all</button>
      <button class="gen-mini-btn" onclick="genSetAll(false)">Clear</button>
    </div>`:''}
  </div>`;

  const rowHtml = (r, gi, ei, ri) => r.alreadyExists ? '' : `
    <div class="gen-bill-row">
      <input type="checkbox" ${r.selected?'checked':''} onchange="genToggleRow(${gi},${ei},${ri},this.checked)" aria-label="Include ${esc(r.tmpl.label)}">
      <div class="gen-bill-info">
        <div class="gen-bill-label">${esc(r.tmpl.label)}</div>
        <div class="gen-bill-due">Due ${formatDate(r.dueDate)}</div>
      </div>
      <div class="gen-bill-amount">${r.tmpl.pendingAmount ? '<span style="color:var(--orange);font-size:12px;font-weight:600;">Pending amount</span>' : '&#8369;'+Number(r.tmpl.amount).toLocaleString()}</div>
    </div>`;

  const tenantHtml = (e, gi, ei) => {
    const skippedRows = e.rows.filter(r=>r.alreadyExists);
    return `<div class="gen-tenant-group">
      <div class="gen-tenant-name">${esc(e.t.name)} &nbsp;·&nbsp; Unit ${esc(e.t.unit)}</div>
      ${e.rows.map((r,ri)=>rowHtml(r,gi,ei,ri)).join('')}
      ${skippedRows.length?`<div class="gen-bill-skip-note">&#9888; Already generated this month: ${skippedRows.map(r=>esc(r.tmpl.label)).join(', ')}</div>`:''}
    </div>`;
  };

  let body;
  if(!_genState.useGroups) {
    body = _genState.groups.map((g,gi)=>g.entries.map((e,ei)=>tenantHtml(e,gi,ei)).join('')).join('');
  } else {
    body = _genState.groups.map((g,gi)=>{
      const rows = [];
      g.entries.forEach(e=>e.rows.forEach(r=>rows.push(r)));
      const gt = _genTotals(rows);
      const gSelectable = rows.filter(r=>!r.alreadyExists);
      const open = (g.key in _genOpenGroups) ? _genOpenGroups[g.key] : defaultOpen;
      const allSel = gSelectable.length>0 && gSelectable.every(r=>r.selected);
      const label = g.key ? esc(g.key) : 'No floor set';
      const meta = gSelectable.length
        ? `${gt.count}/${gSelectable.length} bill${gSelectable.length!==1?'s':''} &nbsp;·&nbsp; &#8369;${gt.amount.toLocaleString()}${gt.pendingCount?' +'+gt.pendingCount+' pending':''}`
        : 'all generated &#10003;';
      return `<div class="gen-group">
        <div class="gen-group-head">
          ${gSelectable.length?`<input type="checkbox" ${allSel?'checked':''} onchange="genToggleGroup(${gi},this.checked)" aria-label="Select all bills in ${label}">`:'<span class="gen-group-spacer"></span>'}
          <button class="gen-group-title" onclick="genToggleOpen(${gi})" aria-expanded="${open?'true':'false'}">
            <span class="insights-arrow${open?' open':''}">›</span> ${label}
            <span class="gen-group-meta">${meta}</span>
          </button>
        </div>
        ${open?`<div class="gen-group-body">${g.entries.map((e,ei)=>tenantHtml(e,gi,ei)).join('')}</div>`:''}
      </div>`;
    }).join('');
  }

  document.getElementById('gen-preview-body').innerHTML = summary + body;
  _genUpdateButton();
}

function genToggleRow(gi, ei, ri, checked) {
  const g = _genState && _genState.groups[gi];
  const r = g && g.entries[ei] && g.entries[ei].rows[ri];
  if(!r || r.alreadyExists) return;
  r.selected = !!checked;
  renderGenPreview();
}
function genToggleGroup(gi, checked) {
  const g = _genState && _genState.groups[gi];
  if(!g) return;
  g.entries.forEach(e=>e.rows.forEach(r=>{ if(!r.alreadyExists) r.selected = !!checked; }));
  renderGenPreview();
}
function genToggleOpen(gi) {
  const g = _genState && _genState.groups[gi];
  if(!g) return;
  const selectable = _genAllRows().filter(r=>!r.alreadyExists).length;
  const defaultOpen = !_genState.useGroups || selectable <= 10;
  const cur = (g.key in _genOpenGroups) ? _genOpenGroups[g.key] : defaultOpen;
  _genOpenGroups[g.key] = !cur;
  renderGenPreview();
}
function genSetAll(sel) {
  if(!_genState) return;
  _genState.groups.forEach(g=>g.entries.forEach(e=>e.rows.forEach(r=>{ if(!r.alreadyExists) r.selected = !!sel; })));
  renderGenPreview();
}

async function confirmGenerateBills() {
  if(!_genState){ showToast('No bills selected to generate.', false); return; }

  // Build candidate bill arrays WITHOUT mutating live tenant objects yet.
  const pending = []; // [{tenant, newBills}]
  _genState.groups.forEach(g => g.entries.forEach(e => {
    const additions = [];
    e.rows.forEach(r => {
      if(r.alreadyExists || !r.selected) return;
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
    if(additions.length) pending.push({tenant: e.t, newBills: [...e.t.bills, ...additions]});
  }));

  if(!pending.length){ showToast('No bills selected to generate.', false); return; }

  setLoading(true,'Generating bills…');
  try {
    // Guarded per-tenant: generation must not overwrite payments recorded
    // from another device, nor write without bumping rev (which would let a
    // stale tab clobber the generated bills later without any conflict).
    await Promise.all(pending.map(p => dbUpdateTenantGuarded(p.tenant, {bills: p.newBills})));
    // Commit local state only after every save succeeded.
    pending.forEach(p => { p.tenant.bills = p.newBills; });
    setLoading(false);
    closeGenModal();
    showToast('Bills generated ✓');
    rerenderAdmin();
  } catch(e){
    setLoading(false);
    if(e.conflict){ showToast(e.message, false); closeGenModal(); rerenderAdmin(); }
    else showToast('Error: '+e.message, false);
  }
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
function hasActiveFilters() { return !!(filterTenantId || filterMonth || filterFloor || filterStatuses.length); }
function activeFilterCount() {
  let n = 0;
  if (filterTenantId) n++;
  if (filterMonth) n++;
  if (filterFloor) n++;
  if (filterStatuses.length) n += filterStatuses.length;
  return n;
}
function renderFilterChips() {
  const chips = [];
  const statusLabels = {overdue:'Overdue','due-today':'Due Today','due-soon':'Due Soon',upcoming:'Upcoming',paid:'Paid'};
  if (filterTenantId) {
    const t = tenants.find(t=>t.id===filterTenantId);
    if (t) chips.push('<span class="filter-chip">'+esc(t.name)+'<button class="filter-chip-x" aria-label="Remove tenant filter" onclick="filterTenantId=\'\';applyFilters()">&#10005;</button></span>');
  }
  if (filterMonth) {
    const lbl = new Date(filterMonth+'-02').toLocaleString('default',{month:'short',year:'numeric'});
    chips.push('<span class="filter-chip">'+lbl+'<button class="filter-chip-x" aria-label="Remove month filter" onclick="filterMonth=\'\';applyFilters()">&#10005;</button></span>');
  }
  if (filterFloor) {
    const lbl = filterFloor==='__none__' ? 'No floor set' : esc(filterFloor);
    chips.push('<span class="filter-chip">'+lbl+'<button class="filter-chip-x" aria-label="Remove floor filter" onclick="filterFloor=\'\';applyFilters()">&#10005;</button></span>');
  }
  filterStatuses.forEach(s => {
    chips.push('<span class="filter-chip">'+(statusLabels[s]||s)+'<button class="filter-chip-x" aria-label="Remove status filter" onclick="removeFilterStatus(\''+s+'\')">&#10005;</button></span>');
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
  // Close the other popovers
  const fp = document.getElementById('filter-popover');
  if (fp) fp.classList.remove('open');
  const gp = document.getElementById('group-popover');
  if (gp) gp.classList.remove('open');
}
function setSortOrder(order) {
  sortOrder = order;
  document.getElementById('sort-popover').classList.remove('open');
  rerenderAdmin();
}
function toggleGroupPopover() {
  const el = document.getElementById('group-popover');
  el.classList.toggle('open');
  const fp = document.getElementById('filter-popover');
  if (fp) fp.classList.remove('open');
  const sp = document.getElementById('sort-popover');
  if (sp) sp.classList.remove('open');
}
function setGroupMode(mode) {
  groupMode = GROUP_LABELS[mode] ? mode : 'auto';
  const gp = document.getElementById('group-popover');
  if (gp) gp.classList.remove('open');
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
  filterFloor    = '';
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
  const gpWrap = document.getElementById('group-popover-wrap');
  if (gpWrap && !gpWrap.contains(e.target)) {
    const gp = document.getElementById('group-popover');
    if (gp) gp.classList.remove('open');
  }
});


// ─────────────────────────────────────────────
// PAYMENT INSTRUCTIONS
// ─────────────────────────────────────────────
// Editing settings whose load failed would overwrite the real saved values
// with the blanks on screen — refuse until a reload succeeds.
function _guardSettingsEdit() {
  if(_settingsLoadFailed) {
    showToast('Settings failed to load, so editing now could overwrite your saved values with blanks. Please refresh the page first.', false);
    return false;
  }
  return true;
}
function openPayInstModal() {
  if(!_guardSettingsEdit()) return;
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
// ANNOUNCEMENTS (tenant notice board)
// ─────────────────────────────────────────────
function openAnnounceModal() {
  if(!_guardSettingsEdit()) return;
  document.getElementById('announce-textarea').value = announcements || '';
  document.getElementById('announce-error').style.display = 'none';
  openModal('announce-modal');
}
function closeAnnounceModal() {
  closeModalEl('announce-modal');
}
async function saveAnnouncements() {
  const val = document.getElementById('announce-textarea').value.trim();
  const errEl = document.getElementById('announce-error');
  errEl.style.display = 'none';
  try {
    await dbSetSetting('announcements', val);
    announcements = val;
    closeAnnounceModal();
    showToast(val ? 'Announcements saved — tenants will see them on their portal.' : 'Announcements cleared.');
    rerenderAdmin();
  } catch(e) {
    errEl.textContent = 'Save failed. Make sure the settings table exists in Supabase.';
    errEl.style.display = 'block';
  }
}

// ─────────────────────────────────────────────
// BRANDING (property name — makes the portal reusable for any building)
// ─────────────────────────────────────────────
function openBrandingModal() {
  if(!_guardSettingsEdit()) return;
  document.getElementById('branding-name').value = propertyName;
  document.getElementById('branding-sub').value = propertySubtitle;
  document.getElementById('branding-error').style.display = 'none';
  openModal('branding-modal');
}
function closeBrandingModal() {
  closeModalEl('branding-modal');
}
async function saveBranding() {
  const name = document.getElementById('branding-name').value.trim();
  const sub  = document.getElementById('branding-sub').value.trim();
  const errEl = document.getElementById('branding-error');
  errEl.style.display = 'none';
  if(!name){ errEl.textContent = 'Property name cannot be empty.'; errEl.style.display = 'block'; return; }
  try {
    await dbSetSetting('property_name', name);
    await dbSetSetting('property_subtitle', sub);
    propertyName = name;
    propertySubtitle = sub || 'Tenant Billing Portal';
    try { localStorage.setItem('oa_branding', JSON.stringify({ name: propertyName, sub: propertySubtitle })); } catch {}
    applyBranding();
    closeBrandingModal();
    showToast('Property name saved.');
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
// Quote a CSV cell. Values that a spreadsheet would execute as a formula
// (=..., +..., @..., tab/CR-prefixed) get a leading apostrophe so a bill
// label like "=HYPERLINK(...)" can never run when the export is opened in
// Excel/Sheets. Plain numbers are exempt so amounts stay numeric.
function csvCell(v){
  let s = String(v==null?'':v).replace(/"/g,'""');
  if(/^[=+@\t\r-]/.test(s) && String(v).trim()!=='' && isNaN(Number(String(v)))) s = "'"+s;
  return '"'+s+'"';
}
function exportCSV() {
  const dsLabel = { paid:'Paid', overdue:'Overdue', 'due-today':'Due Today', 'due-soon':'Due Soon', upcoming:'Upcoming', 'no-date':'Unscheduled' };
  const rows = [['Tenant Name','Unit','Floor','Billing Model','Access Code','Bill Label','Amount','Amount Paid','Remaining','Due Date','Status','Paid Date','Remark']];
  tenants.forEach(t => {
    const base = [t.name, t.unit, t.floor||'', t.billing_model==='inclusive'?'All-inclusive':'Itemized', t.code];
    if(!t.bills||!t.bills.length){
      rows.push([...base,'','','','','','','','']);
    } else {
      t.bills.forEach(b => {
        // A bill marked paid is settled in full even when partial payments
        // weren't logged — mirror the statement's paidOf/balOf rules so the
        // export never claims money is still owed on a paid bill.
        const paid = b.status==='paid' ? Number(b.amount||0) : billTotalPaid(b);
        const remaining = b.status==='paid' ? 0 : Math.max(0,billRemaining(b));
        const status = dsLabel[getDueStatus(b)] || b.status;
        rows.push([
          ...base,
          b.label, b.amount, paid, remaining, b.due||'', status, b.paidDate||'', b.remark||''
        ]);
      });
    }
  });
  const csv = rows.map(r=>r.map(csvCell).join(',')).join('\n');
  // UTF-8 BOM so Excel renders ₱ and non-ASCII names correctly.
  const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'orange-apartment-'+todayISO()+'.csv';
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
  if(_el('announce-modal')) { closeAnnounceModal();return; }
  if(_el('branding-modal')) { closeBrandingModal();return; }
  if(_el('stmt-modal'))     { closeStmtModal();    return; }
  if(_el('addbill-modal'))  { closeQuickBill();    return; }
  if(_el('tenant-modal'))   { closeModal();        return; }
});

// ─────────────────────────────────────────────
// Focus trap: keep Tab inside the open dialog. The modals declare
// aria-modal, but without this the background stayed keyboard-reachable —
// Tab could land on (and activate) destructive controls behind the overlay.
// ─────────────────────────────────────────────
const _MODAL_IDS = ['paiddate-modal','genbills-modal','payinst-modal','announce-modal','branding-modal','stmt-modal','addbill-modal','tenant-modal'];
document.addEventListener('keydown', function(e) {
  if(e.key !== 'Tab') return;
  let openEl = null;
  for(const id of _MODAL_IDS){
    const el = document.getElementById(id);
    if(el && el.classList.contains('open')){ openEl = el; break; }
  }
  if(!openEl) return;
  const focusables = Array.from(openEl.querySelectorAll(
    'button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.disabled && el.offsetParent !== null);
  if(!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length-1];
  const active = document.activeElement;
  if(e.shiftKey) {
    if(active === first || !openEl.contains(active)) { e.preventDefault(); last.focus(); }
  } else {
    if(active === last || !openEl.contains(active)) { e.preventDefault(); first.focus(); }
  }
});

