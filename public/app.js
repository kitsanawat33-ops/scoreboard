/* =====================================================================
   ClassHub — หน้าเว็บ (เวอร์ชัน Firebase)
   ใช้หน้าตาและการทำงานเดิมจากระบบ Apps Script
   gas('ชื่อฟังก์ชัน', ...) เรียก API ใน api.js แทน google.script.run
   ===================================================================== */
let state = {
  students:[], subjects:[], allSubjects:[], gradeRules:[], settings:{}, summary:{}, categories:{},
  attendanceStatuses:[], taskStatuses:[], registeredTerms:['1/2569'], currentSemester:'1', currentYear:'2569', me:null
};
const STATUS_LABELS = { NORMAL: 'ปกติ', I: 'ร', W: 'มส', ZERO: '0' };

let scoreData = null;
let lastReport = null;
let attendanceData = null;
let editingAttendanceStatusId = null;
let taskData = null;
let editingTaskStatusId = null;
let taskSummaryBaseScore = 10;
let usersCache = [];

let viewMode = 'mine';
function subjRoomsUI(s){ return (Array.isArray(s.rooms) && s.rooms.length ? s.rooms : [s.room]).map(String); }
function subjRoomLabel(s){ return `${s.level||'-'}/${subjRoomsUI(s).join('+')}`; }
function isCombined(s){ return subjRoomsUI(s).length > 1; }
function isAdminRole(){ return !!(state.me && state.me.role === 'admin'); }
function isAdminUI(){ return isAdminRole() && viewMode === 'admin'; }
function myHomerooms(){ return (state.me && state.me.homerooms) || []; }
function teacherName(email){
  const u = usersCache.find(x => x.email === email);
  return u ? (u.name || email) : email;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => { showPage(btn.dataset.page); toggleSidebar(false); }));
  initTabletMode();
  if (window.API) bootAuth(); else window.addEventListener('api-ready', bootAuth, { once: true });
  window.addEventListener('online', () => updateNetBadge());
  window.addEventListener('offline', () => { updateNetBadge(); toast('ออฟไลน์อยู่ — ใช้งานต่อได้ ระบบจะส่งข้อมูลให้เองเมื่อกลับมาออนไลน์', 'error'); });
});

/* ===================== เข้าสู่ระบบ ===================== */
function bootAuth(){
  // กันค้าง: ถ้าตรวจสอบนานเกิน 12 วินาที ให้แสดงปุ่มเข้าสู่ระบบ
  setTimeout(() => document.body.classList.remove('auth-pending'), 12000);
  API.onAuth(async user => {
    if (!user) { try { localStorage.removeItem('classhub_last_email'); } catch (e) {} return showLogin(); }
    try { localStorage.setItem('classhub_last_email', user.email || ''); } catch (e) {}
    showLoading(true);
    try {
      const r = await API.resolveUser(user);
      showLoading(false);
      if (!r.ok) {
        const msg = r.reason === 'suspended'
          ? `บัญชี ${esc(r.email)} ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ`
          : `บัญชี ${esc(r.email)} ยังไม่ได้ลงทะเบียนในระบบ<br>กรุณาให้ผู้ดูแลระบบเพิ่มอีเมลนี้ที่เมนู "บุคลากร / สิทธิ์"`;
        return showLogin(msg, true);
      }
      hideLogin();
      await loadApp();
    } catch (e) {
      showLoading(false);
      showLogin('เข้าสู่ระบบไม่สำเร็จ: ' + esc(e.message || e), true);
    }
  });
}
function showLogin(msg, signedIn){
  document.body.classList.remove('auth-pending');
  document.body.classList.add('logged-out');
  const box = document.getElementById('loginMsg');
  if (box) box.innerHTML = msg || '';
  const out = document.getElementById('loginSwitch');
  if (out) out.style.display = signedIn ? 'inline-flex' : 'none';
}
function toggleAuthFallback(){
  let on = false; try { on = localStorage.getItem('classhub_auth_legacy') === '1'; } catch (e) {}
  try { on ? localStorage.removeItem('classhub_auth_legacy') : localStorage.setItem('classhub_auth_legacy', '1'); } catch (e) {}
  location.reload();
}
document.addEventListener('DOMContentLoaded', () => {
  let on = false; try { on = localStorage.getItem('classhub_auth_legacy') === '1'; } catch (e) {}
  const b = document.getElementById('authAltBtn'); if (b && on) b.textContent = 'กำลังใช้วิธีสำรอง • กลับไปใช้วิธีปกติ';
});
function hideLogin(){ document.body.classList.remove('logged-out', 'auth-pending'); }
async function doLogin(){
  try { await API.login(); } catch (e) {
    if (e && e.code === 'auth/popup-closed-by-user') return;
    if (e && e.code === 'classhub/popup-blocked') return showLogin(`เบราว์เซอร์บล็อกหน้าต่างล็อกอิน (ป๊อปอัป)<br><small>iPhone/iPad: ไปที่ <b>การตั้งค่า → Safari → ปิด "ปิดกั้นหน้าต่างที่แสดงขึ้น"</b> แล้วกดเข้าสู่ระบบอีกครั้ง<br>คอมพิวเตอร์/Android: กดไอคอนป๊อปอัปที่ช่องที่อยู่ → อนุญาต</small>`);
    showLogin('เข้าสู่ระบบไม่สำเร็จ: ' + esc(e.message || e));
  }
}
async function doLogout(){
  if (!confirm('ต้องการออกจากระบบหรือไม่?')) return;
  await API.logout(); location.reload();
}

function updateNetBadge(){
  const b = document.getElementById('netBadge');
  if (!b) return;
  b.textContent = navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์';
  b.classList.toggle('off', !navigator.onLine);
}

/* ===================== Tablet Mode Controller ===================== */
function initTabletMode() {
  let saved = null;
  try { saved = localStorage.getItem('scoreboard_tablet_mode'); } catch (e) {}
  const isTabletScreen = window.innerWidth >= 600 && window.innerWidth <= 1200;
  setTabletMode(saved === 'true' || (saved === null && isTabletScreen));
}
function toggleTabletMode() {
  const cur = document.body.classList.contains('tablet-mode');
  setTabletMode(!cur);
  toast(!cur ? 'สลับเข้าสู่โหมด Tablet เรียบร้อย' : 'สลับกลับสู่โหมดมาตรฐานเรียบร้อย');
}
function setTabletMode(enable) {
  document.body.classList.toggle('tablet-mode', enable);
  try { localStorage.setItem('scoreboard_tablet_mode', enable); } catch (e) {}
  const btn = document.getElementById('btnTabletToggle');
  if (btn) {
    btn.innerHTML = enable ? '💻 สลับเป็นโหมดคอมพิวเตอร์' : '📟 สลับเป็นโหมด Tablet';
    btn.style.background = enable ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.18)';
  }
}

function toggleSidebar(force){
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;
  const open = typeof force === 'boolean' ? force : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  overlay?.classList.toggle('show', open);
  document.body.classList.toggle('no-scroll', open);
}

/* ===================== เรียก API (แทน google.script.run) ===================== */
async function gas(fn, ...args) {
  if (!window.API || typeof API[fn] !== 'function') throw new Error('ไม่พบฟังก์ชัน ' + fn);
  showLoading(true);
  try {
    const r = await API[fn](...args);
    return r;
  } catch (e) {
    toast(friendlyError(e), 'error');
    throw e;
  } finally {
    showLoading(false);
  }
}
function friendlyError(e){
  const m = String((e && e.message) || e || '');
  if (/permission|insufficient/i.test(m)) return 'ไม่มีสิทธิ์ทำรายการนี้ (ตรวจสอบสิทธิ์กับผู้ดูแลระบบ หรือคะแนนวิชานี้ถูกล็อกอยู่)';
  if (/offline|unavailable|network/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ข้อมูลที่บันทึกถูกเก็บไว้ในเครื่องแล้ว';
  return m;
}

async function loadApp(){
  try{
    if (API.me() && API.me().role === 'admin') {
      let saved = null; try { saved = localStorage.getItem('classhub_view'); } catch (e) {}
      viewMode = API.setView(saved || 'admin');
    } else viewMode = API.setView('mine');
    state = await gas('getInitialData');
    state.currentSemester = String(state.settings.CURRENT_SEMESTER || '1');
    state.currentYear = String(state.settings.CURRENT_YEAR || '2569');
    state.registeredTerms = state.registeredTerms || ['1/2569'];
    if (isAdminRole()) { try { usersCache = await API.getUsers(); } catch (e) { usersCache = []; } }
    renderAll();
    dashStale = true; if (document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard(true);
    const first = document.getElementById('subjectSelectTop')?.value;
    if (first) API.prefetchSubject(first);
    const cur = document.querySelector('.page.active')?.id?.replace('page-', '');
    if (cur && document.querySelector(`.nav-btn[data-page="${cur}"]`)?.classList.contains('admin-only') && !isAdminUI()) showPage('dashboard');
    // ครูที่ยังไม่ได้เลือกงานสอน: พาไปหน้า "งานสอนของฉัน" ก่อน
    if (viewMode === 'mine' && !state.subjects.length && !myHomerooms().length && !loadApp.welcomed) {
      loadApp.welcomed = true;
      showPage('mywork');
      toast('ยังไม่มีวิชาที่สอนหรือห้องประจำชั้น — กรุณาแจ้งผู้ดูแลระบบให้กำหนดงานสอนให้');
    }
  }catch(e){ console.error(e); }
}

function categories(){
  return {
    classwork: state.categories?.CLASSWORK || 'คะแนนเก็บ',
    attendance: state.categories?.ATTENDANCE || 'คะแนนเข้าเรียน',
    tasks: state.categories?.TASKS || 'ส่งงาน',
    midterm: state.categories?.MIDTERM || 'กลางภาค',
    final: state.categories?.FINAL || 'ปลายภาค'
  };
}

function renderAll(){
  document.body.classList.toggle('is-admin', isAdminUI());
  document.body.classList.toggle('is-admin-role', isAdminRole());
  document.body.classList.toggle('has-homeroom', isAdminUI() || myHomerooms().length > 0);
  document.getElementById('viewMine')?.classList.toggle('active', viewMode === 'mine');
  document.getElementById('viewAdmin')?.classList.toggle('active', viewMode === 'admin');
  document.getElementById('schoolName').textContent = state.settings.SCHOOL_NAME || '';
  document.getElementById('sidebarTermLabel').textContent = `${state.currentSemester}/${state.currentYear}`;
  document.getElementById('dashboardTermEyebrow').textContent = `SEMESTER ${state.currentSemester} / ${state.currentYear}`;
  const me = state.me || {};
  document.getElementById('meName').textContent = me.name || me.email || '';
  document.getElementById('meRole').textContent = isAdminRole() ? (viewMode === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ดูแล • โหมดครู') : 'ครู';
  fillHomeroomGradeSelect();
  document.getElementById('meAvatar').textContent = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  updateNetBadge();


  fillTermSelects();
  fillSubjectSelects();
  renderStudents();
  renderSubjects();
  renderItems();
  fillReportStudents();
}

/* ===================== ภาคเรียน / ปีการศึกษา Controller ===================== */

function fillTermSelects(){
  const select = document.getElementById('termSelectTop');
  if (!select) return;

  const currentVal = `${state.currentSemester}/${state.currentYear}`;
  const terms = Array.from(new Set(state.registeredTerms || [currentVal])).sort((a,b) => b.localeCompare(a));

  select.innerHTML = terms.map(t => `<option value="${t}" ${t === currentVal ? 'selected' : ''}>ภาคเรียน ${t}</option>`).join('');
}

async function changeActiveTerm(termVal) {
  if (!termVal) return;
  const parts = termVal.split('/');
  if (parts.length !== 2) return;

  state.currentSemester = parts[0];
  state.currentYear = parts[1];

  document.getElementById('sidebarTermLabel').textContent = termVal;
  document.getElementById('dashboardTermEyebrow').textContent = `SEMESTER ${parts[0]} / ${parts[1]}`;

  const res = await gas('switchTerm', parts[0], parts[1]);
  state.settings = res.settings;
  state.registeredTerms = res.registeredTerms;
  state.students = res.students;
  state.subjects = res.subjects;
  state.summary = res.summary;

  fillTermSelects();
  fillSubjectSelects();
  renderStudents();
  renderSubjects();
  fillReportStudents();
  renderDashboardStats();

  const activePage = document.querySelector('.page.active')?.id;
  if (activePage === 'page-scores') loadScorePage();
  else if (activePage === 'page-items') renderItems();
  else if (activePage === 'page-attendance') { if (attMode === 'homeroom') await fillHomeroomSelect(); loadAttendancePage(); }
  else if (activePage === 'page-tasks') loadTaskPage();

  toast(`สลับไปยังภาคเรียน ${termVal} แล้ว`);
}

function openTermManageModal() {
  const currentVal = `${state.currentSemester}/${state.currentYear}`;
  const terms = Array.from(new Set(state.registeredTerms || [currentVal])).sort((a,b) => b.localeCompare(a));
  const termOptions = terms.map(t => `<option value="${t}" ${t === currentVal ? 'selected' : ''}>ภาคเรียน ${t}</option>`).join('');

  document.getElementById('modalTitle').textContent = 'จัดการภาคเรียน';
  if (!isAdminUI()) {
    document.getElementById('modalBody').innerHTML = `<p style="color:var(--ink-soft)">เลือกภาคเรียนที่ต้องการดูได้จากช่อง "ภาคเรียน/ปีการศึกษา" ด้านบน<br>การสร้าง คัดลอก หรือลบภาคเรียน ทำได้เฉพาะผู้ดูแลระบบ</p><div class="modal-actions"><button class="secondary" onclick="closeModal()">ปิด</button></div>`;
    return openModal();
  }
  document.getElementById('modalBody').innerHTML = `
    <h4 style="margin:0 0 6px;font-size:14px;color:var(--fb-blue);">➕ 1. สร้างภาคเรียนใหม่</h4>
    <p style="margin:0 0 10px;font-size:12.5px;color:var(--ink-soft);">
      เพิ่มภาคเรียนใหม่เข้าสู่ระบบ เพื่อเริ่มจัดการวิชาและนักเรียนในเทอมใหม่
    </p>
    <div class="form-grid">
      <div class="form-row"><label>ภาคเรียน</label>
        <select id="m_new_semester">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">ฤดูร้อน</option>
        </select>
      </div>
      <div class="form-row"><label>ปีการศึกษา (พ.ศ.)</label>
        <input id="m_new_year" type="number" value="${esc(state.currentYear||'2569')}">
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="primary small-btn" onclick="processCreateNewTerm()">✨ สร้างและเปิดใช้งานภาคเรียนนี้</button>
    </div>

    <hr style="border:0;border-top:1px solid var(--line-light);margin:14px 0;">

    <h4 style="margin:0 0 6px;font-size:14px;color:var(--green);">📋 2. คัดลอกข้อมูลนักเรียน/รายวิชาข้ามภาคเรียน</h4>
    <p style="margin:0 0 10px;font-size:12.5px;color:var(--ink-soft);">
      คัดลอกรายชื่อนักเรียนเดิม รายวิชา และองค์ประกอบคะแนนจากเทอมเดิมไปยังเทอมใหม่
    </p>
    <div class="form-grid">
      <div class="form-row"><label>เทอมต้นทาง</label>
        <select id="m_copy_src_select">${termOptions}</select>
      </div>
      <div class="form-row"><label>เทอมปลายทาง (ที่จะนำข้อมูลเข้า)</label>
        <input id="m_copy_tgt_input" value="${state.currentSemester==='1'?'2':'1'}/${state.currentSemester==='1'?state.currentYear:String(Number(state.currentYear)+1)}" placeholder="เช่น 2/2569">
      </div>
    </div>

    <div style="background:var(--surface-alt);padding:10px 12px;border-radius:8px;margin:8px 0;">
      <div style="margin-bottom:6px;">
        <label><input type="checkbox" id="m_opt_students" checked style="width:auto"> <b>คัดลอกรายชื่อนักเรียนเดิมไปใช้ในเทอมใหม่</b></label>
      </div>
      <div style="margin-left:22px;margin-bottom:6px;">
        <label><input type="checkbox" id="m_opt_promote" style="width:auto"> <b>เลื่อนระดับชั้นอัตโนมัติ</b> (เช่น ม.5 -> ม.6)</label>
      </div>
      <div style="margin-bottom:6px;">
        <label><input type="checkbox" id="m_opt_subjects" checked style="width:auto"> <b>คัดลอกรายวิชาทั้งหมด</b></label>
      </div>
      <div style="margin-left:22px;">
        <label><input type="checkbox" id="m_opt_items" checked style="width:auto"> <b>คัดลอกองค์ประกอบคะแนนของแต่ละวิชาด้วย</b></label>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="primary small-btn" onclick="processCopyTermData()">🚀 ดำเนินการคัดลอกข้อมูล</button>
    </div>

    <hr style="border:0;border-top:1px solid var(--line-light);margin:14px 0;">

    <h4 style="margin:0 0 6px;font-size:14px;color:var(--red);">🗑️ 3. ลบภาคเรียน (ลบออกไปเลยทั้งภาคเรียน)</h4>
    <p style="margin:0 0 8px;font-size:12px;color:var(--ink-soft);">
      ระบบจะนำภาคเรียนนี้ออกจาก Dropdown และปิดใช้งานรายวิชา/นักเรียนของเทอมนั้น (เฉพาะผู้ดูแลระบบ — พิมพ์ภาคเรียนที่จะลบเพื่อยืนยัน เช่น 2/2569)
    </p>

    <div class="form-grid">
      <div class="form-row"><label>เลือกภาคเรียนที่จะลบ</label>
        <select id="m_del_term_select">${termOptions}</select>
      </div>
      <div class="form-row"><label>พิมพ์ภาคเรียนที่จะลบเพื่อยืนยัน</label>
        <input id="m_del_password" placeholder="เช่น 2/2569" autocomplete="off">
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;">
      <button class="danger small-btn" style="border: 1px solid var(--red); color: var(--red);" onclick="processDeleteTermCompletely()">🗑️ ลบภาคเรียนนี้ออกถาวร</button>
    </div>

    <div class="modal-actions" style="margin-top:16px;">
      <button class="secondary" onclick="closeModal()">ปิดหน้าต่าง</button>
    </div>
  `;
  openModal();
}

async function processCreateNewTerm() {
  const sem = v('m_new_semester');
  const yr = v('m_new_year');
  if(!sem || !yr) return toast('กรุณากรอกภาคเรียนและปีการศึกษา', 'error');

  try {
    const res = await gas('createNewTerm', sem, yr);
    state.registeredTerms = res.registeredTerms;
    state.currentSemester = res.currentSemester;
    state.currentYear = res.currentYear;
    state.students = res.students;
    state.subjects = res.subjects;
    state.settings = res.settings;
    state.summary = await gas('getDashboardSummary', null, sem, yr);

    closeModal();
    renderAll();
    toast(`สร้างและเปิดใช้งานภาคเรียน ${res.createdTerm} เรียบร้อยแล้ว`);
  } catch(err) {
    toast(err.message || 'เกิดข้อผิดพลาดในการสร้างภาคเรียน', 'error');
  }
}

async function processCopyTermData() {
  const src = v('m_copy_src_select').trim();
  const tgt = v('m_copy_tgt_input').trim();
  if(!src || !tgt) return toast('กรุณาระบุเทอมต้นทางและปลายทาง (เช่น 1/2569)', 'error');
  if(src === tgt) return toast('เทอมต้นทางและปลายทางต้องไม่ซ้ำกัน', 'error');

  const srcParts = src.split('/');
  const tgtParts = tgt.split('/');
  if(srcParts.length !== 2 || tgtParts.length !== 2) return toast('รูปแบบไม่ถูกต้อง กรุณาใช้ ภาคเรียน/ปีการศึกษา (เช่น 1/2569)', 'error');

  if(!confirm(`ยืนยันการคัดลอกข้อมูลจากภาคเรียน ${src} ไปยัง ${tgt} หรือไม่?`)) return;

  const payload = {
    sourceSemester: srcParts[0].trim(),
    sourceYear: srcParts[1].trim(),
    targetSemester: tgtParts[0].trim(),
    targetYear: tgtParts[1].trim(),
    copyStudents: document.getElementById('m_opt_students').checked,
    promoteLevel: document.getElementById('m_opt_promote').checked,
    copySubjects: document.getElementById('m_opt_subjects').checked,
    copyScoreItems: document.getElementById('m_opt_items').checked
  };

  const result = await gas('copyTermData', payload);
  state.subjects = result.subjects;
  state.students = result.students;
  state.allSubjects = result.allSubjects || result.subjects;
  state.settings = result.settings;
  state.registeredTerms = result.registeredTerms;
  state.currentSemester = tgtParts[0].trim();
  state.currentYear = tgtParts[1].trim();

  closeModal();
  renderAll();
  toast(`คัดลอกข้อมูลสำเร็จ! (วิชา: ${result.copiedSubjectsCount}, นักเรียน: ${result.copiedStudentsCount} คน)`);
}

async function processDeleteTermCompletely() {
  const delTerm = v('m_del_term_select').trim();
  const pwd = v('m_del_password').trim();

  if (!delTerm) return toast('กรุณาเลือกภาคเรียนที่ต้องการลบ', 'error');
  if (pwd !== delTerm) return toast(`กรุณาพิมพ์ ${delTerm} ให้ตรงเพื่อยืนยันการลบ`, 'error');

  const parts = delTerm.split('/');
  if (parts.length !== 2) return toast('รูปแบบไม่ถูกต้อง กรุณาใช้ ภาคเรียน/ปีการศึกษา (เช่น 2/2569)', 'error');

  if (!confirm(`⚠️ คำเตือนสำคัญ: คุณแน่ใจหรือไม่ว่าต้องการลบ "ภาคเรียน ${delTerm}" ออกไปเลยทั้งภาคเรียน? (ข้อมูลรายวิชา นักเรียน และคะแนนในเทอมนี้จะถูกลบทั้งหมด)`)) {
    return;
  }

  try {
    const result = await gas('deleteTermCompletely', parts[0].trim(), parts[1].trim(), pwd);
    closeModal();
    
    state.registeredTerms = result.registeredTerms;
    state.currentSemester = result.currentSemester;
    state.currentYear = result.currentYear;
    state.subjects = result.subjects;
    state.allSubjects = result.allSubjects;
    state.students = result.students;
    state.settings = result.settings;
    state.summary = await gas('getDashboardSummary', null, state.currentSemester, state.currentYear);

    renderAll();
    toast(`ลบภาคเรียน ${delTerm} ออกจากระบบเรียบร้อยแล้ว`);
  } catch (err) {
    toast(err.message || 'เกิดข้อผิดพลาดในการลบภาคเรียน', 'error');
  }
}

function syncSubject(val) {
  const topSelect = document.getElementById('subjectSelectTop');
  const scoreSelect = document.getElementById('scoreSubject');
  const attSelect = document.getElementById('attSubject');
  const taskSelect = document.getElementById('taskSubject');
  if (topSelect && topSelect.value !== val) topSelect.value = val;
  if (scoreSelect && scoreSelect.value !== val) scoreSelect.value = val;
  if (attSelect && attSelect.value !== val) attSelect.value = val;
  if (taskSelect && taskSelect.value !== val) taskSelect.value = val;
  if (val && window.API && API.prefetchSubject) API.prefetchSubject(val);

  const activePage = document.querySelector('.page.active')?.id;
  if (activePage === 'page-scores') loadScorePage();
  else if (activePage === 'page-items') renderItems();
  else if (activePage === 'page-reports') loadClassReport();
  else if (activePage === 'page-attendance') loadAttendancePage();
  else if (activePage === 'page-tasks') loadTaskPage();
}

function showPage(page){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active', x.dataset.page===page));
  document.querySelectorAll('.tablet-nav-item').forEach(x=>x.classList.toggle('active', x.dataset.page===page));

  const titles={dashboard:'หน้าแรก',scores:'บันทึกคะแนน',attendance:'เช็คชื่อ',tasks:'เช็คงาน',students:'นักเรียน',subjects:'รายวิชาทั้งหมด',items:'องค์ประกอบคะแนน',reports:'รายงานผลการเรียน',users:'บุคลากร / ภาระงาน',mywork:'งานสอนของฉัน',dataio:'นำเข้า / ส่งออกข้อมูล'};
  document.getElementById('pageTitle').textContent=titles[page]||'หน้าแรก';
  
  if(page==='scores') loadScorePage();
  if(page==='items') renderItems();
  if(page==='attendance'){
    const d=document.getElementById('attDate');
    if(d && !d.value) d.value = todayStr();
    loadAttendancePage();
  }
  if(page==='tasks') loadTaskPage();
  if(page==='users') loadUsersPage();
  if(page==='mywork') loadMyWork();
  if(page==='dashboard') loadDashboard();
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fillSubjectSelects(){
  const active = state.subjects.filter(s => 
    s.status !== 'INACTIVE' &&
    (!state.currentSemester || String(s.semester) === String(state.currentSemester)) &&
    (!state.currentYear || String(s.academic_year) === String(state.currentYear))
  );

  ['subjectSelectTop','scoreSubject','attSubject','taskSubject'].forEach(id=>{
    const el=document.getElementById(id); if(!el)return;
    const old=el.value;
    el.innerHTML='<option value="">-- เลือกรายวิชา --</option>'+active.map(s=> {
      const code = esc(s.subject_code||'-');
      const name = esc(s.subject_name);
      const levelRoom = esc(subjRoomLabel(s)) + (isCombined(s) ? ' (เรียนรวม)' : '');
      return `<option value="${esc(s.subject_id)}">${code}, ${name}, ${levelRoom}</option>`;
    }).join('');
    if(active.some(s=>s.subject_id===old)) el.value=old;
  });
}

/* ===================== เช็คชื่อ: รายวิชา | ประจำชั้น ===================== */

let attMode = 'subject';          // 'subject' | 'homeroom'
let homeroomList = [];

function todayStr(){
  const d=new Date(), pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }

function attTargetId(){ return attMode === 'homeroom' ? (attendanceData && attendanceData.roster_id) : (attendanceData && attendanceData.subject && attendanceData.subject.subject_id); }
function attDraftKey(mode, id, date){ return `att_draft::${mode}::${id}::${date}`; }

// ร่างอัตโนมัติ: เก็บสถานะที่กดไว้ในเครื่องทุกครั้ง จนกว่าจะกดบันทึก
function saveAttendanceDraft(){
  if(!attendanceData || !attendanceData.rows) return;
  const map = {};
  attendanceData.rows.forEach(r => { const s = String(r.status_id || '').trim(); if(s) map[String(r.student_id)] = s; });
  lsSet(attDraftKey(attMode, attTargetId(), attendanceData.date), { savedAt: Date.now(), map });
  updateAttPendingBar();
}
function applyAttendanceDraft(){
  if(!attendanceData || !attendanceData.rows) return 0;
  const d = lsGet(attDraftKey(attMode, attTargetId(), attendanceData.date));
  if(!d || !d.map) return 0;
  let n = 0;
  attendanceData.rows.forEach(r => { const s = d.map[String(r.student_id)]; if(s && String(r.status_id || '') !== s){ r.status_id = s; n++; } });
  return n;
}
function hasAttendanceDraft(){ return !!(attendanceData && lsGet(attDraftKey(attMode, attTargetId(), attendanceData.date))); }
function clearAttendanceDraft(mode, id, date, olderThan){
  const k = attDraftKey(mode, id, date);
  if(olderThan){ const d = lsGet(k); if(d && d.savedAt > olderThan) return; }
  lsDel(k);
}

function updateAttPendingBar(){
  const list = document.getElementById('attendanceList');
  if(!list) return;
  let bar = document.getElementById('attPendingBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'attPendingBar';
    bar.className = 'pending-bar';
    list.parentNode.insertBefore(bar, list);
  }
  const msgs = [];
  if(!navigator.onLine) msgs.push('📴 ออฟไลน์อยู่ — กดบันทึกได้ตามปกติ ระบบจะส่งขึ้นเซิร์ฟเวอร์ให้เองเมื่อกลับมาออนไลน์');
  if(hasAttendanceDraft()) msgs.push('📝 หน้านี้มีการเปลี่ยนแปลงที่ยังไม่ได้กด "บันทึกการเช็คชื่อ" (เก็บไว้ในเครื่องแล้ว)');
  if(!msgs.length){ bar.style.display = 'none'; return; }
  bar.innerHTML = msgs.join('<br>');
  bar.style.display = 'block';
  bar.classList.toggle('warn', !navigator.onLine);
}

/* ---------- สลับโหมด ---------- */
async function setAttMode(mode){
  attMode = mode;
  document.querySelectorAll('.seg-btn[data-attmode]').forEach(b => b.classList.toggle('active', b.dataset.attmode === mode));
  document.getElementById('attSubjectWrap').style.display = mode === 'subject' ? '' : 'none';
  document.getElementById('attHomeroomWrap').style.display = mode === 'homeroom' ? '' : 'none';
  document.getElementById('attSummaryTitle').textContent = mode === 'homeroom' ? 'สรุปการมาเรียนประจำชั้น' : 'สรุปการเข้าเรียนรายวิชา';
  document.getElementById('attSummaryDesc').textContent = mode === 'homeroom'
    ? 'จำนวนวันมา/ขาด/ลา/สาย ร้อยละเวลามาเรียน และประวัติย้อนหลังของห้อง'
    : 'สถิติรวม ประวัติย้อนหลัง และคะแนนเข้าเรียนของนักเรียนแต่ละคน';
  document.getElementById('attendanceSummaryBox').innerHTML = '';
  attendanceData = null;
  if(mode === 'homeroom') await fillHomeroomSelect();
  loadAttendancePage();
}

async function fillHomeroomSelect(){
  const sel = document.getElementById('attHomeroom');
  try { homeroomList = await API.getMyHomerooms(state.currentSemester, state.currentYear); }
  catch(e){ homeroomList = []; }
  const old = sel.value;
  sel.innerHTML = homeroomList.length
    ? homeroomList.map(h => `<option value="${esc(h.roster_id)}">ชั้น ${esc(h.level)}/${esc(h.room)} (${h.count} คน)</option>`).join('')
    : '<option value="">-- ไม่มีห้องที่รับผิดชอบในภาคเรียนนี้ --</option>';
  if(homeroomList.some(h => h.roster_id === old)) sel.value = old;
}

/* ---------- โหลด / แสดงรายชื่อ ---------- */
async function loadAttendancePage(){
  const dateInput = document.getElementById('attDate');
  if(!dateInput.value) dateInput.value = todayStr();
  const date = dateInput.value;
  const box = document.getElementById('attendanceList');

  let target;
  if(attMode === 'homeroom'){
    target = document.getElementById('attHomeroom').value;
    if(!target){
      box.innerHTML = '<div class="empty">ยังไม่มีห้องประจำชั้นที่คุณรับผิดชอบ<br><small>ผู้ดูแลระบบกำหนดได้ที่เมนู "บุคลากร / สิทธิ์"</small></div>';
      document.getElementById('attInfo').textContent = '';
      return;
    }
  } else {
    target = document.getElementById('subjectSelectTop').value;
    if(!target){
      box.innerHTML = '<div class="empty">กรุณาเลือกรายวิชาที่แถบด้านบน</div>';
      document.getElementById('attInfo').textContent = '';
      return;
    }
  }
  const prev = attendanceData;
  try{
    attendanceData = attMode === 'homeroom'
      ? await gas('getHomeroomData', target, date)
      : await gas('getAttendanceData', target, date);
  }catch(e){
    if(prev && prev.subject){
      attendanceData = prev;
      dateInput.value = prev.date;
      toast('ออฟไลน์อยู่ — โหลดข้อมูลใหม่ไม่ได้ ยังเช็คชื่อหน้าเดิมต่อได้', 'error');
    }
    updateAttPendingBar();
    return;
  }
  const restored = applyAttendanceDraft();
  renderAttendanceList();
  updateAttPendingBar();
  if(restored) toast('กู้คืนการเช็คชื่อที่ยังไม่ได้บันทึก ' + restored + ' คน');
}

function statusById(id){ return (attendanceData.statuses || state.attendanceStatuses || []).find(s => String(s.status_id) === String(id)); }
const PRESENT_LIKE = ['PRESENT', 'LATE'];

// ป้ายแสดงผลเช็คชื่อประจำชั้นตอนเช้า (เฉพาะโหมดรายวิชา)
function homeroomBadge(r){
  if(attMode !== 'subject' || !r.homeroom_status) return '';
  const hs = statusById(r.homeroom_status);
  const label = hs ? hs.label : r.homeroom_status;
  if(PRESENT_LIKE.includes(r.homeroom_status) && String(r.status_id) === 'ABSENT'){
    return `<span class="hr-badge alert" title="ประจำชั้นตอนเช้า: ${esc(label)}">⚠️ มาโรงเรียนแต่ไม่เข้าเรียน</span>`;
  }
  const color = hs ? hs.color : '#8A8D91';
  return `<span class="hr-badge" style="--hr-color:${esc(color)}" title="ผลเช็คชื่อประจำชั้นวันนี้">เช้า: ${esc(label)}</span>`;
}

function renderAttendanceList(){
  const box = document.getElementById('attendanceList');
  if(!box) return;
  const statuses = (attendanceData.statuses && attendanceData.statuses.length) ? attendanceData.statuses : (state.attendanceStatuses || []);
  const hrCount = attendanceData.rows.filter(r => r.homeroom_status).length;
  document.getElementById('attInfo').textContent =
    `${attendanceData.subject.subject_name} • วันที่ ${attendanceData.date} • ${attendanceData.rows.length} คน` +
    (attMode === 'subject' && hrCount ? ` • มีผลเช็คชื่อประจำชั้นเช้านี้ ${hrCount} คน` : '');

  if(!attendanceData.rows.length){
    box.innerHTML = '<div class="empty">ไม่พบรายชื่อนักเรียน (ตรวจสอบระดับชั้น/ห้อง และภาคเรียนของนักเรียน)</div>';
    return;
  }
  if(!statuses.length){
    box.innerHTML = '<div class="empty">ยังไม่มีสถานะการเช็คชื่อ</div>';
    return;
  }
  const rooms = attendanceData.subject && !attendanceData.homeroom ? subjRoomsUI(attendanceData.subject) : [];
  if (rooms.length < 2 || (attRoom !== 'ALL' && !rooms.includes(attRoom))) attRoom = 'ALL';
  const bar = rooms.length > 1 ? `<div class="att-roombar"><span>เรียนรวม:</span>${['ALL', ...rooms].map(r => {
      const n = r === 'ALL' ? attendanceData.rows.length : attendanceData.rows.filter(x => String(x.room) === r).length;
      return `<button class="stu-room${attRoom === r ? ' on' : ''}" onclick="attRoom='${esc(r)}';renderAttendanceList()">${r === 'ALL' ? 'ทุกห้อง' : esc(attendanceData.subject.level) + '/' + esc(r)}<small>${n}</small></button>`; }).join('')}</div>` : '';
  box.innerHTML = bar + attVisibleRows().map(r => {
    const rStatus = String(r.status_id || '');
    const btns = statuses.map(s => {
      const active = rStatus !== '' && rStatus === String(s.status_id);
      return `<button type="button" class="att-btn${active?' active':''}" data-student="${esc(r.student_id)}" data-status="${esc(s.status_id)}" style="--att-color:${esc(s.color||'#7F2BE3')}" title="${esc(s.label)}"><span class="lbl-full">${esc(s.label)}</span><span class="lbl-short">${esc(shortStatusLabel(s))}</span></button>`;
    }).join('');
    return `<div class="attendance-row" data-student="${esc(r.student_id)}">
      <div class="attendance-name"><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.student_id)}${roomTag(attendanceData.subject, r)}</small><span class="hr-slot">${homeroomBadge(r)}</span></div>
      <div class="attendance-btns">${btns}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('.att-btn').forEach(btn => btn.addEventListener('click', () => selectAttendanceStatus(btn)));
}

let attRoom = 'ALL';
function attVisibleRows(){ return (attendanceData.rows || []).filter(r => attRoom === 'ALL' || String(r.room) === attRoom); }
function roomTag(subject, r){ return subject && subjRoomsUI(subject).length > 1 && r.room ? ` <span class="room-tag">${esc(subject.level)}/${esc(r.room)}</span>` : ''; }

function shortStatusLabel(s){
  const map = {PRESENT:'มา',ABSENT:'ขาด',LEAVE:'ลา',LATE:'สาย',ACTIVITY:'กิจกรรม'};
  return map[s.status_id] || s.label;
}

function selectAttendanceStatus(btn){
  const sid = String(btn.dataset.student || ''), statusId = String(btn.dataset.status || '');
  if(!attendanceData || !attendanceData.rows) return;
  const row = attendanceData.rows.find(r => String(r.student_id) === sid);
  if(row){ row.status_id = statusId; saveAttendanceDraft(); }
  const rowEl = btn.closest('.attendance-row');
  rowEl.querySelectorAll('.att-btn').forEach(b => b.classList.toggle('active', b === btn));
  const slot = rowEl.querySelector('.hr-slot');
  if(slot && row) slot.innerHTML = homeroomBadge(row);
}

function markAllPresent(){
  if(!attendanceData || !attendanceData.rows || !attendanceData.rows.length) return toast('ไม่มีรายชื่อนักเรียนให้เช็คชื่อ','error');
  const scope = attRoom === 'ALL' ? 'นักเรียนทั้งหมด' : `นักเรียนห้อง ${attendanceData.subject.level}/${attRoom}`;
  if(!confirm(`ต้องการกำหนด${scope}เป็น "มา" หรือไม่?`)) return;
  const present = attendanceData.statuses.find(s => s.status_id === 'PRESENT') || attendanceData.statuses[0] || {};
  if(!present.status_id) return toast('ไม่พบสถานะ "มา"','error');
  attVisibleRows().forEach(r => r.status_id = String(present.status_id));
  saveAttendanceDraft();
  renderAttendanceList();
  toast('กำหนดนักเรียนทั้งหมดเป็น มา แล้ว (กด "บันทึกการเช็คชื่อ" เพื่อยืนยัน)');
}

async function saveAttendanceAll(){
  if(!attendanceData || !attendanceData.rows) return;
  const missing = attendanceData.rows.filter(r => !String(r.status_id || '').trim());
  if(missing.length && !confirm(`มีนักเรียน ${missing.length} คนที่ยังไม่ได้เลือกสถานะ ต้องการบันทึกเฉพาะรายการที่เลือกแล้วหรือไม่?`)) return;
  const rows = attendanceData.rows.filter(r => String(r.status_id || '').trim() !== '')
    .map(r => ({ student_id: String(r.student_id), status_id: String(r.status_id), remark: String(r.remark || '') }));
  const mode = attMode, id = attTargetId(), date = attendanceData.date;
  const sentAt = Date.now();
  try{
    const res = mode === 'homeroom'
      ? await gas('saveHomeroom', { roster_id: id, date, rows })
      : await gas('saveAttendance', { subject_id: id, date, rows });
    clearAttendanceDraft(mode, id, date, sentAt);
    if(attMode === mode && attTargetId() === id){
      attendanceData = res;
      applyAttendanceDraft();
      renderAttendanceList();
    }
    updateAttPendingBar();
    toast(res && res.pending ? 'บันทึกไว้ในเครื่องแล้ว — จะส่งขึ้นระบบเองเมื่อสัญญาณกลับมา' : 'บันทึกการเช็คชื่อเรียบร้อยแล้ว');
  }catch(e){ /* gas() แจ้งข้อผิดพลาดแล้ว ร่างยังอยู่ในเครื่อง */ }
}

/* ---------- จัดการสถานะ (เฉพาะผู้ดูแล) ---------- */
function openAttendanceStatusModal(){
  if(!isAdminUI()) return toast('การแก้สถานะเช็คชื่อทำได้เฉพาะผู้ดูแลระบบ เพราะมีผลกับทุกรายวิชา','error');
  editingAttendanceStatusId = null;
  renderAttendanceStatusModalBody();
  openModal();
}
function renderAttendanceStatusModalBody(){
  const list = state.attendanceStatuses || [];
  const defaults = ['PRESENT','ABSENT','LEAVE','LATE','ACTIVITY'];
  document.getElementById('modalTitle').textContent = 'จัดการสถานะการเช็คชื่อ';
  document.getElementById('modalBody').innerHTML = `
    <div class="att-status-manage-list">
      ${list.map(s => `<div class="att-status-manage-row">
        <span class="att-status-dot" style="background:${esc(s.color)}"></span>
        <span class="att-status-manage-label">${esc(s.label)} <small style="color:var(--ink-soft)">(${Number(s.score_value).toFixed(1)} คะแนน)</small></span>
        <button type="button" class="small-btn" onclick="editAttendanceStatus('${esc(s.status_id)}')">แก้ไข</button>
        ${defaults.includes(s.status_id)?'':`<button type="button" class="danger small-btn" onclick="removeAttendanceStatus('${esc(s.status_id)}')">ลบ</button>`}
      </div>`).join('') || '<p style="color:var(--ink-soft)">ยังไม่มีสถานะ</p>'}
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <p style="margin:0 0 8px;font-weight:500;font-size:13.5px">${editingAttendanceStatusId?'แก้ไขสถานะ':'เพิ่มสถานะใหม่'}</p>
    <div class="form-grid">
      <div class="form-row"><label>ชื่อสถานะ</label><input id="newStatusLabel" placeholder="เช่น กิจกรรมพิเศษ"></div>
      <div class="form-row"><label>สี</label><input id="newStatusColor" type="color" value="#7F2BE3"></div>
      <div class="form-row"><label>คะแนนเข้าเรียน (0-1)</label><input id="newStatusScore" type="number" min="0" max="1" step="0.1" value="1"></div>
    </div>
    <div class="modal-actions">
      ${editingAttendanceStatusId?'<button class="secondary" onclick="cancelEditAttendanceStatus()">ยกเลิกแก้ไข</button>':''}
      <button class="secondary" onclick="closeModal()">ปิด</button>
      <button class="primary" onclick="addAttendanceStatus()">${editingAttendanceStatusId?'บันทึกการแก้ไข':'+ เพิ่มสถานะ'}</button>
    </div>`;
  if(editingAttendanceStatusId){
    const s = list.find(x => String(x.status_id) === String(editingAttendanceStatusId));
    if(s){
      document.getElementById('newStatusLabel').value = s.label;
      document.getElementById('newStatusColor').value = s.color;
      document.getElementById('newStatusScore').value = s.score_value;
    }
  }
}
function editAttendanceStatus(id){ editingAttendanceStatusId = id; renderAttendanceStatusModalBody(); }
function cancelEditAttendanceStatus(){ editingAttendanceStatusId = null; renderAttendanceStatusModalBody(); }
async function addAttendanceStatus(){
  const label = v('newStatusLabel');
  if(!label.trim()) return toast('กรุณากรอกชื่อสถานะ','error');
  const payload = { label, color: v('newStatusColor') || '#7F2BE3', score_value: v('newStatusScore') };
  if(editingAttendanceStatusId) payload.status_id = editingAttendanceStatusId;
  state.attendanceStatuses = await gas('saveAttendanceStatus', payload);
  toast(editingAttendanceStatusId ? 'แก้ไขสถานะแล้ว' : 'เพิ่มสถานะแล้ว');
  editingAttendanceStatusId = null;
  renderAttendanceStatusModalBody();
  if(document.getElementById('page-attendance').classList.contains('active')) loadAttendancePage();
}
async function removeAttendanceStatus(id){
  if(!confirm('ยืนยันการลบสถานะนี้?')) return;
  state.attendanceStatuses = await gas('deleteAttendanceStatus', id);
  renderAttendanceStatusModalBody();
  if(document.getElementById('page-attendance').classList.contains('active')) loadAttendancePage();
}

/* ---------- สรุป ---------- */
async function loadAttendanceSummary(){
  if(attMode === 'homeroom'){
    const id = document.getElementById('attHomeroom').value;
    if(!id) return toast('กรุณาเลือกห้อง','error');
    return renderAttendanceSummary(await gas('getHomeroomSummary', id));
  }
  const subjectId = document.getElementById('subjectSelectTop').value;
  if(!subjectId) return toast('กรุณาเลือกวิชา','error');
  renderAttendanceSummary(await gas('getAttendanceSummary', subjectId));
}
function attendanceScoreClass(score){ return score >= 9 ? 'att-good' : score >= 7 ? 'att-ok' : 'att-low'; }

function renderAttendanceSummary(data){
  const box = document.getElementById('attendanceSummaryBox');
  const statuses = data.statuses || [];
  const hr = attMode === 'homeroom';
  if(!data.totalSessions){ box.innerHTML = `<div class="empty">ยังไม่มีการเช็คชื่อ${hr?'ประจำชั้นของห้องนี้':'สำหรับวิชานี้'}</div>`; return; }
  const avgPct = data.students.length ? data.students.reduce((a,s)=>a+(s.presentPct||0),0)/data.students.length : 0;
  const statCards = `<div class="report-grid">
    <div class="report-stat"><small>${hr?'จำนวนวันที่เช็คชื่อ':'จำนวนครั้งที่เช็คชื่อ'}</small><b>${data.totalSessions}</b></div>
    <div class="report-stat"><small>นักเรียนทั้งหมด</small><b>${data.students.length}</b></div>
    <div class="report-stat"><small>${hr?'ร้อยละเวลามาเรียนเฉลี่ย':'คะแนนเข้าเรียนเฉลี่ย (เต็ม 10)'}</small><b>${hr?avgPct.toFixed(1)+'%':data.avgScore.toFixed(2)}</b></div>
    <div class="report-stat"><small>บันทึกทั้งหมด</small><b>${data.totalRecords}</b></div>
  </div>`;
  const totalForBar = statuses.reduce((sum,s)=>sum+(data.overallCounts[s.status_id]||0),0) || 1;
  const bars = `<div class="grade-bars">${statuses.map(s=>{
    const n = data.overallCounts[s.status_id]||0, pct = Math.round(n*100/totalForBar);
    return `<div class="grade-bar"><b>${esc(s.label)}</b><div class="bar"><i style="width:${pct}%;background:${esc(s.color)}"></i></div><span>${n} (${pct}%)</span></div>`;
  }).join('')}</div>`;
  const studentTable = `<div class="table-wrap" style="margin-top:14px"><table>
    <thead><tr><th>รหัส</th><th>ชื่อ–สกุล</th>${statuses.map(s=>`<th>${esc(s.label)}</th>`).join('')}<th>${hr?'วันที่เช็ค':'ครั้งที่เช็คชื่อ'}</th><th>${hr?'ร้อยละเวลามาเรียน':'คะแนนเข้าเรียน'}</th></tr></thead>
    <tbody>${data.students.map(st=>{
      const cells = statuses.map(s=>`<td>${st.counts[s.status_id]||0}</td>`).join('');
      const last = hr
        ? `<span class="grade ${attendanceScoreClass((st.presentPct||0)/10)}">${(st.presentPct||0).toFixed(1)}%</span>`
        : `<span class="grade ${attendanceScoreClass(st.attendanceScore)}">${st.attendanceScore.toFixed(2)}</span>`;
      return `<tr><td>${esc(st.student_id)}</td><td>${esc(st.first_name)} ${esc(st.last_name)}</td>${cells}<td>${st.totalChecked}</td><td>${last}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  const history = `<div class="table-wrap" style="margin-top:14px"><table>
    <thead><tr><th>วันที่</th>${statuses.map(s=>`<th>${esc(s.label)}</th>`).join('')}<th>รวม</th><th></th></tr></thead>
    <tbody>${data.history.map(h=>{
      const cells = statuses.map(s=>`<td>${h.counts[s.status_id]||0}</td>`).join('');
      return `<tr><td>${esc(h.date)}</td>${cells}<td>${h.total}</td><td><button class="small-btn" onclick="editAttendanceDate('${esc(h.date)}')">✏️ แก้ไข</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  box.innerHTML = statCards + bars +
    `<h4 style="margin:20px 0 4px;font-size:14.5px">${hr?'สรุปการมาเรียนรายบุคคล':'คะแนนเข้าเรียนรายบุคคล'}</h4>` + studentTable +
    `<h4 style="margin:20px 0 4px;font-size:14.5px">ประวัติการเช็คชื่อย้อนหลัง</h4>` +
    `<p style="margin:0 0 4px;color:var(--ink-soft);font-size:12.5px">คลิก "แก้ไข" เพื่อกลับไปแก้สถานะของวันนั้น</p>` + history;
}

function editAttendanceDate(date){
  const clean = String(date).trim().slice(0, 10);
  document.getElementById('attDate').value = clean;
  loadAttendancePage();
  toast(`กำลังแก้ไขการเช็คชื่อวันที่ ${clean}`);
  document.getElementById('attendanceList')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ===================== บุคลากร / สิทธิ์ (ผู้ดูแล) ===================== */
let workloadCatalog = [];
async function loadUsersPage(){
  if(!isAdminUI()) return;
  const w = await gas('getWorkload', state.currentSemester, state.currentYear);
  usersCache = w.users; workloadCatalog = w.catalog; roomListCache = w.rooms;
  renderUsers();
}
function renderUsers(){
  const t = document.getElementById('usersTable');
  if(!usersCache.length){ t.innerHTML = '<tbody><tr><td class="empty">ยังไม่มีบุคลากร</td></tr></tbody>'; return; }
  const nSub = e => workloadCatalog.filter(s => (s.teachers||[]).includes(e)).length;
  t.innerHTML = '<thead><tr><th>ชื่อ</th><th>อีเมล</th><th>บทบาท</th><th>วิชาที่สอน</th><th>ครูประจำชั้น</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
    usersCache.map(u => `<tr>
      <td><b>${esc(u.name || '-')}</b></td><td>${esc(u.email)}</td>
      <td><span class="role-chip ${u.role==='admin'?'admin':''}">${u.role==='admin'?'ผู้ดูแลระบบ':'ครู'}</span></td>
      <td>${nSub(u.email) ? `<b>${nSub(u.email)}</b> วิชา` : '<span style="color:var(--ink-faint)">-</span>'}</td>
      <td>${(u.homerooms||[]).map(h=>`<span class="room-chip">${esc(h.replace('|','/'))}</span>`).join(' ') || '<span style="color:var(--ink-faint)">-</span>'}</td>
      <td>${u.active===false?'<span class="state-chip off">ระงับ</span>':'<span class="state-chip on">ใช้งาน</span>'}</td>
      <td style="white-space:nowrap"><button class="small-btn" onclick="openAssignModal('${esc(u.email)}')">จัดงาน</button> <button class="small-btn" onclick="openUserModal('${esc(u.email)}')">แก้ไข</button></td></tr>`).join('') + '</tbody>';
  renderUnassigned();
}
// เพิ่มครูจากชื่อในตารางสอน: กรอกอีเมลทีละคน แล้วผูกวิชาให้อัตโนมัติ
function plannedTeacherNames(){
  const known = new Set(usersCache.map(u => normName(u.name)));
  const map = {};
  workloadCatalog.forEach(s => { if (s.planned_teacher && !known.has(normName(s.planned_teacher))) (map[s.planned_teacher] = map[s.planned_teacher] || []).push(s); });
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], 'th'));
}
function openPlannedTeachersModal(){
  const list = plannedTeacherNames();
  document.getElementById('modalTitle').textContent = 'เพิ่มครูจากตารางสอน';
  document.getElementById('modalBody').innerHTML = list.length ? `
    <div class="info-box">กรอกอีเมล Google ของครูแต่ละคน (เว้นว่างได้ถ้ายังไม่ทราบ) เมื่อบันทึก ระบบจะเพิ่มครูเข้าระบบและผูกวิชาตามตารางสอนให้อัตโนมัติ</div>
    <div class="pt-list">${list.map(([name, subs], i) => `<div class="pt-row">
      <div><b>${esc(name)}</b><small>${subs.length} วิชา: ${esc(subs.slice(0, 4).map(s => `${s.subject_name} ${subjRoomLabel(s)}`).join(', '))}${subs.length > 4 ? ' …' : ''}</small></div>
      <input id="pt_${i}" type="email" placeholder="name@ppj.ac.th" data-name="${esc(name)}"></div>`).join('')}</div>
    <div class="modal-actions"><button class="secondary" onclick="closeModal()">ยกเลิก</button><button class="primary" onclick="savePlannedTeachers()">บันทึก</button></div>`
    : `<div class="empty">ครูทุกคนในตารางสอนของภาคเรียนนี้มีอีเมลในระบบแล้ว</div><div class="modal-actions"><button class="primary" onclick="closeModal()">ปิด</button></div>`;
  openModal();
}
async function savePlannedTeachers(){
  const rows = [...document.querySelectorAll('.pt-row input')].map(i => ({ email: i.value.trim().toLowerCase(), name: i.dataset.name })).filter(r => r.email);
  if (!rows.length) return toast('ยังไม่ได้กรอกอีเมล', 'error');
  const bad = rows.find(r => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
  if (bad) return toast(`อีเมลไม่ถูกต้อง: ${bad.email}`, 'error');
  for (const r of rows) {
    await gas('saveUser', { email: r.email, name: r.name, role: 'teacher', active: true, homerooms: [] });
  }
  const res = await gas('linkPlannedTeachers', state.currentSemester, state.currentYear);
  closeModal(); await loadUsersPage();
  state.subjects = await API.getSubjects(state.currentSemester, state.currentYear); renderSubjects(); fillSubjectSelects();
  toast(`เพิ่มครู ${rows.length} คน • ผูกวิชาตามตารางสอน ${res.linked} วิชา`);
}

function renderUnassigned(){
  const box = document.getElementById('unassignedBox'); if (!box) return;
  const free = workloadCatalog.filter(s => !(s.teachers||[]).length);
  if (!workloadCatalog.length) { box.innerHTML = ''; return; }
  const teachers = usersCache.filter(u => u.active !== false);
  box.innerHTML = `<div class="panel">
    <div class="mw-head"><div><h3>${free.length ? `⚠️ วิชาที่ยังไม่มีครู ${free.length} วิชา` : '✅ ทุกวิชามีครูผู้สอนแล้ว'}</h3>
      <p>ภาคเรียน ${esc(state.currentSemester)}/${esc(state.currentYear)} • ทั้งหมด ${workloadCatalog.length} วิชา</p></div>
      <div class="mw-tools">${plannedTeacherNames().length ? `<button class="primary" onclick="openPlannedTeachersModal()">👥 เพิ่มครูจากตารางสอน (${plannedTeacherNames().length})</button>` : ''}
      ${free.length ? `<button class="secondary" onclick="this.closest('.panel').classList.toggle('open')">แสดง / ซ่อน</button>` : ''}</div></div>
    ${free.length ? `<div class="unassigned-list">${free.map(s => `<div class="ua-row">
      <span><b>${esc(subjRoomLabel(s))}</b> ${esc(s.subject_code||'')} ${esc(s.subject_name)}${s.planned_teacher ? ` <small style="color:var(--ink-soft)">• ตามตาราง: ${esc(s.planned_teacher)}</small>` : ''}</span>
      <select onchange="quickAssign('${esc(s.subject_id)}', this.value)"><option value="">— เลือกครู —</option>${teachers.map(u => `<option value="${esc(u.email)}">${esc(u.name || u.email)}</option>`).join('')}</select>
    </div>`).join('')}</div>` : ''}
  </div>`;
}
async function quickAssign(subjectId, email){
  if (!email) return;
  workloadCatalog = await gas('assignSubject', subjectId, email, true, teacherName(email));
  renderUsers(); toast('กำหนดครูผู้สอนแล้ว');
  document.querySelector('#unassignedBox .panel')?.classList.add('open');
}
/* ===================== มุมมอง: งานของฉัน | ผู้ดูแลระบบ ===================== */
async function setViewMode(mode){
  if (!isAdminRole() || mode === viewMode) return;
  try { localStorage.setItem('classhub_view', mode); } catch (e) {}
  await loadApp();
  toast(mode === 'admin' ? 'โหมดผู้ดูแลระบบ — เห็นทุกวิชาและทุกห้อง' : 'โหมดงานของฉัน — เห็นเฉพาะวิชาที่คุณสอนและห้องประจำชั้นของคุณ');
}

/* ===================== งานสอน: ครูเลือกเอง / ผู้ดูแลจัดให้ ===================== */
let roomListCache = [];
let asg = null;   // { email, name, self, catalog, rooms, homerooms:Set, box:'mw'|'am' }

async function loadMyWork(){
  const me = state.me || {};
  asg = { email: me.email, name: me.name, self: true, readonly: true, box: 'mw', catalog: [], rooms: [], homerooms: new Set(myHomerooms()) };
  document.getElementById('mwSubjects').innerHTML = '<div class="empty">กำลังโหลด...</div>';
  try {
    const [catalog, rooms] = await Promise.all([gas('getSubjectCatalog', state.currentSemester, state.currentYear), API.getRoomList(state.currentSemester, state.currentYear)]);
    asg.catalog = catalog; asg.rooms = rooms; roomListCache = rooms;
  } catch (e) { return; }
  renderAssign();
  renderMyTimetable();
}

// ตารางสอนรายสัปดาห์ (วัน × คาบ) ของวิชาที่ฉันสอน
function renderMyTimetable(){
  const box = document.getElementById('mwTimetable'); if (!box || !asg) return;
  const mine = asg.catalog.filter(s => s.teachers.includes(asg.email));
  const slots = {}; const times = {};
  mine.forEach(s => (s.schedule || []).forEach(p => {
    const k = `${p.day}-${p.period}`;
    const list = slots[k] = slots[k] || [];
    if (!list.some(x => x.subject_id === s.subject_id)) list.push(s);
    if (p.start && !times[p.period]) times[p.period] = `${p.start}–${p.end}`;
  }));
  const keys = Object.keys(slots);
  if (!keys.length) {
    box.innerHTML = `<div class="empty">${mine.length ? 'ยังไม่มีข้อมูลวันและคาบของวิชาที่สอน — ผู้ดูแลระบบนำเข้าไฟล์ตารางสอน (.json) อีกครั้งเพื่อเพิ่มข้อมูลนี้' : 'ยังไม่มีวิชาที่สอนในภาคเรียนนี้'}</div>`;
    return;
  }
  const maxP = Math.max(8, ...keys.map(k => Number(k.split('-')[1])));
  const days = [1, 2, 3, 4, 5]; if (keys.some(k => k.startsWith('6-'))) days.push(6); if (keys.some(k => k.startsWith('0-'))) days.unshift(0);
  const now = new Date(), dow = now.getDay(), hm = nowHM();
  const total = keys.reduce((t, k) => t + slots[k].length, 0);
  const perDay = d => keys.filter(k => k.startsWith(d + '-')).length;
  document.getElementById('mwTtInfo').textContent = `สอนสัปดาห์ละ ${total} คาบ • ${days.filter(perDay).map(d => `${TH_DAYS[d]} ${perDay(d)}`).join(' • ')} • กดที่วิชาเพื่อเช็คชื่อ`;
  const isNow = (d, p) => { if (d !== dow || !times[p]) return false; const [a, b] = times[p].split('–'); return hm >= a && hm < b; };
  box.innerHTML = `<div class="table-wrap tt-wrap"><table class="tt-table">
    <thead><tr><th class="tt-day">วัน / คาบ</th>${Array.from({ length: maxP }, (_, i) => `<th>คาบ ${i + 1}${times[i + 1] ? `<small>${times[i + 1]}</small>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${days.map(d => `<tr class="${d === dow ? 'tt-today' : ''}"><th class="tt-day">${TH_DAYS[d]}${d === dow ? '<small>วันนี้</small>' : ''}</th>${Array.from({ length: maxP }, (_, i) => {
      const list = slots[`${d}-${i + 1}`] || [];
      if (!list.length) return `<td class="tt-free${isNow(d, i + 1) ? ' tt-now' : ''}"></td>`;
      return `<td class="tt-cell${isNow(d, i + 1) ? ' tt-now' : ''}">${list.map(s => `<button class="tt-sub-btn" onclick="goAttend('${esc(s.subject_id)}')" title="${esc(s.subject_name)}">
        <b>${esc(s.subject_code || s.subject_name)}</b><span>${esc(s.level)}/${esc((s.rooms || [s.room]).join('+'))}</span><small>${esc(s.subject_name)}</small></button>`).join('')}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="tt-legend"><span class="tt-l-today"></span> วันนี้ <span class="tt-l-now"></span> คาบที่กำลังสอนอยู่ตอนนี้</div>`;
}

function tName(s, e){ return (s.teacher_names || {})[e] || (usersCache.find(u => u.email === e) || {}).name || e.split('@')[0]; }

function renderAssign(){
  if (!asg) return;
  const p = asg.box;
  const roomsBox = document.getElementById(p + 'Rooms'), subBox = document.getElementById(p + 'Subjects');
  if (!roomsBox || !subBox) return;
  if (asg.readonly) {
    const mineRooms = asg.rooms.filter(r => asg.homerooms.has(r.key));
    roomsBox.innerHTML = mineRooms.length
      ? mineRooms.map(r => `<div class="room-pick on"><b>${esc(r.level)}/${esc(r.room)}</b><small>${r.count} คน</small><i>✓ ประจำชั้น</i></div>`).join('')
      : '<div class="empty">ยังไม่ได้เป็นครูประจำชั้น</div>';
  } else
  roomsBox.innerHTML = asg.rooms.length ? asg.rooms.map(r => {
    const on = asg.homerooms.has(r.key);
    return `<button class="room-pick${on ? ' on' : ''}" onclick="toggleRoomAssign('${esc(r.key)}')"><b>${esc(r.level)}/${esc(r.room)}</b><small>${r.count} คน</small>${on ? '<i>✓ ประจำชั้น</i>' : ''}</button>`;
  }).join('') : '<div class="empty">ยังไม่มีรายชื่อนักเรียนในภาคเรียนนี้</div>';

  const q = (document.getElementById(p + 'Search')?.value || '').trim().toLowerCase();
  const f = document.getElementById(p + 'Filter')?.value || 'all';
  const list = asg.catalog.filter(s => {
    const mine = s.teachers.includes(asg.email);
    if (asg.readonly && !mine) return false;
    if (f === 'mine' && !mine) return false;
    if (f === 'free' && s.teachers.length) return false;
    return !q || `${s.subject_code} ${s.subject_name} ${subjRoomLabel(s)}`.toLowerCase().includes(q);
  });
  const mineCount = asg.catalog.filter(s => s.teachers.includes(asg.email)).length;
  if (!asg.catalog.length || (asg.readonly && !mineCount)) { subBox.innerHTML = `<div class="empty">${asg.readonly ? 'ยังไม่มีวิชาที่สอนในภาคเรียนนี้ — ผู้ดูแลระบบเป็นผู้กำหนดวิชาให้' : 'ยังไม่มีรายวิชาในภาคเรียนนี้ — นำเข้าได้ที่เมนู "นำเข้า / ส่งออกข้อมูล"'}</div>`; return; }
  const groups = {};
  list.forEach(s => (groups[subjRoomLabel(s)] = groups[subjRoomLabel(s)] || []).push(s));
  subBox.innerHTML = `<p class="mw-count">${asg.self ? 'คุณ' : esc(asg.name || asg.email)} สอนอยู่ <b>${mineCount}</b> วิชา</p>` + (Object.keys(groups).length ? Object.keys(groups).map(k => `
    <div class="mw-group"><div class="mw-group-h">ชั้น ${esc(k)}</div>
    ${groups[k].map(s => {
      const mine = s.teachers.includes(asg.email);
      const others = s.teachers.filter(e => e !== asg.email);
      return `<div class="mw-sub${mine ? ' on' : ''}">
        <div class="mw-sub-main"><b>${esc(s.subject_code || '')} ${esc(s.subject_name)}</b>
          <small>${s.credit ? s.credit + ' นก. • ' : ''}${others.length ? 'ครู: ' + others.map(e => esc(tName(s, e))).join(', ') : (mine ? '' : '<span class="mw-free">ยังไม่มีครู</span>')}</small></div>
        ${asg.readonly ? '' : `<button class="mw-btn${mine ? ' on' : ''}" onclick="toggleSubjectAssign('${esc(s.subject_id)}')">${mine ? '✓ สอนอยู่' : '+ รับสอน'}</button>`}
      </div>`; }).join('')}</div>`).join('') : '<div class="empty">ไม่พบวิชาตามเงื่อนไข</div>');
}

async function toggleSubjectAssign(id){
  const s = asg.catalog.find(x => x.subject_id === id); if (!s) return;
  const on = !s.teachers.includes(asg.email);
  if (!on && !confirm(`เลิกสอน ${s.subject_code || ''} ${s.subject_name} ${subjRoomLabel(s)}?\nคะแนนและการเช็คชื่อที่บันทึกไว้ยังอยู่ครบ`)) return;
  try { asg.catalog = await gas('assignSubject', id, asg.email, on, asg.name); } catch (e) { return; }
  renderAssign();
  await afterAssignChange();
  toast(on ? 'รับสอนวิชานี้แล้ว' : 'เลิกสอนวิชานี้แล้ว');
}
async function toggleRoomAssign(key){
  const on = !asg.homerooms.has(key);
  try { await gas('assignHomeroom', key, asg.email, on); } catch (e) { return; }
  on ? asg.homerooms.add(key) : asg.homerooms.delete(key);
  renderAssign();
  await afterAssignChange();
  toast(on ? `เป็นครูประจำชั้น ${key.replace('|', '/')} แล้ว` : `เลิกเป็นครูประจำชั้น ${key.replace('|', '/')} แล้ว`);
}
async function afterAssignChange(){
  if (asg.self) {
    state.me.homerooms = [...asg.homerooms];
    state.subjects = await API.getSubjects(state.currentSemester, state.currentYear);
    document.body.classList.toggle('has-homeroom', isAdminUI() || myHomerooms().length > 0);
    fillSubjectSelects(); renderSubjects(); fillHomeroomSelect(); fillHomeroomGradeSelect();
  }
  const u = usersCache.find(x => x.email === asg.email);
  if (u) u.homerooms = [...asg.homerooms];
  if (isAdminUI()) { workloadCatalog = asg.catalog; if (document.getElementById('page-users').classList.contains('active')) renderUsers(); }
}

// ผู้ดูแล: จัดงานให้ครูคนหนึ่ง
async function openAssignModal(email){
  const u = usersCache.find(x => x.email === email); if (!u) return;
  asg = { email, name: u.name || email, self: email === (state.me || {}).email, box: 'am', catalog: workloadCatalog, rooms: roomListCache, homerooms: new Set(u.homerooms || []) };
  document.getElementById('modalTitle').textContent = `จัดงาน • ${u.name || email}`;
  document.getElementById('modalBody').innerHTML = `
    <h4 class="am-h">ห้องประจำชั้น</h4><div id="amRooms" class="room-grid"></div>
    <div class="mw-head" style="margin-top:14px"><h4 class="am-h">วิชาที่สอน</h4>
      <div class="mw-tools"><input id="amSearch" placeholder="🔍 ค้นหา" oninput="renderAssign()">
      <select id="amFilter" onchange="renderAssign()"><option value="all">ทุกวิชา</option><option value="mine">เฉพาะที่สอน</option><option value="free">ยังไม่มีครู</option></select></div></div>
    <div id="amSubjects" class="am-list"></div>
    <div class="modal-actions"><button class="primary" onclick="closeModal()">เสร็จ</button></div>`;
  openModal();
  renderAssign();
}

/* ===================== ผลการเรียนห้องประจำชั้น (ดูอย่างเดียว) ===================== */
async function fillHomeroomGradeSelect(){
  const sel = document.getElementById('hrGradeRoom'); if (!sel) return;
  let keys = myHomerooms();
  if (isAdminUI()) {
    if (!roomListCache.length) { try { roomListCache = await API.getRoomList(state.currentSemester, state.currentYear); } catch (e) {} }
    keys = roomListCache.map(r => r.key);
  }
  const old = sel.value;
  sel.innerHTML = keys.length ? keys.map(k => `<option value="${esc(k)}">ชั้น ${esc(k.replace('|', '/'))}</option>`).join('') : '<option value="">-- ไม่มีห้องประจำชั้น --</option>';
  if (keys.includes(old)) sel.value = old;
}
async function loadHomeroomGrades(){
  const key = v('hrGradeRoom'); if (!key) return;
  const box = document.getElementById('hrGradeBox');
  let d; try { d = await gas('getHomeroomGrades', key, state.currentSemester, state.currentYear); } catch (e) { return; }
  if (!d.subjects.length) { box.innerHTML = '<div class="empty">ยังไม่มีรายวิชาของห้องนี้ในภาคเรียนนี้</div>'; return; }
  const cell = g => {
    if (!g) return '<td class="hg-na">·</td>';
    if (g.status && g.status !== 'NORMAL') return `<td class="hg-bad">${esc(STATUS_LABELS[g.status] || g.status)}</td>`;
    const x = g.grade === '' || g.grade == null ? '-' : String(g.grade);
    return `<td class="${x === '0' ? 'hg-bad' : x === '-' ? 'hg-na' : ''}" title="${g.total != null ? 'คะแนนรวม ' + Number(g.total).toFixed(1) : ''}">${esc(x)}</td>`;
  };
  box.innerHTML = `<p class="mw-count">ชั้น ${esc(key.replace('|', '/'))} • ${d.students.length} คน • ${d.subjects.length} วิชา • "-" = ยังไม่มีเกรด</p>
    <div class="table-wrap"><table class="hg-table"><thead><tr><th>เลขประจำตัว</th><th>ชื่อ–สกุล</th>
      ${d.subjects.map(s => `<th title="${esc(s.subject_name)} (${s.credit} นก.)">${esc(s.subject_code || s.subject_name)}<small>${esc(s.subject_name)}</small></th>`).join('')}<th>GPA</th></tr></thead>
    <tbody>${d.students.map(st => `<tr><td>${esc(st.student_id)}</td><td class="hg-name">${esc(st.first_name)} ${esc(st.last_name)}</td>
      ${d.subjects.map(s => cell(st.grades[s.subject_id])).join('')}<td><b>${st.gpa == null ? '-' : st.gpa.toFixed(2)}</b></td></tr>`).join('')}</tbody></table></div>`;
}

function openUserModal(email){
  const u = usersCache.find(x => x.email === email) || { role:'teacher', active:true, homerooms:[] };
  const isNew = !email;
  document.getElementById('modalTitle').textContent = isNew ? 'เพิ่มบุคลากร' : 'แก้ไขบุคลากร';
  document.getElementById('modalBody').innerHTML = `
    <div class="form-grid">
      <div class="form-row"><label>อีเมล (บัญชี Google ที่ใช้เข้าระบบ) *</label><input id="u_email" value="${esc(u.email||'')}" ${isNew?'':'disabled'} placeholder="name@ppj.ac.th"></div>
      <div class="form-row"><label>ชื่อ–สกุล</label><input id="u_name" value="${esc(u.name||'')}"></div>
      <div class="form-row"><label>บทบาท</label><select id="u_role">
        <option value="teacher" ${u.role!=='admin'?'selected':''}>ครู (เห็นเฉพาะวิชาที่สอน)</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>ผู้ดูแลระบบ (เห็นทุกอย่าง)</option></select></div>
      <div class="form-row"><label>สถานะ</label><select id="u_active">
        <option value="1" ${u.active!==false?'selected':''}>ใช้งาน</option><option value="0" ${u.active===false?'selected':''}>ระงับ</option></select></div>
    </div>
    <div class="form-row"><label>เป็นครูประจำชั้นห้อง (คั่นด้วยจุลภาค เช่น ม.4/1, ม.5/2) — 1 ห้องมีครูประจำชั้นได้หลายคน</label>
      <input id="u_homerooms" value="${esc((u.homerooms||[]).map(h=>h.replace('|','/')).join(', '))}" placeholder="ม.4/1"></div>
    <div class="modal-actions">
      ${isNew?'':`<button class="danger small-btn" style="margin-right:auto" onclick="removeUser('${esc(u.email)}')">ลบบุคลากร</button>`}
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" onclick="saveUserForm()">บันทึก</button>
    </div>`;
  openModal();
}
async function saveUserForm(){
  const email = v('u_email').trim();
  if(!email) return toast('กรุณากรอกอีเมล','error');
  usersCache = await gas('saveUser', { email, name: v('u_name'), role: v('u_role'), active: v('u_active') === '1', homerooms: v('u_homerooms') });
  let linked = 0;
  try { linked = (await API.linkPlannedTeachers(state.currentSemester, state.currentYear)).linked; } catch (e) {}
  closeModal(); await loadUsersPage();
  state.subjects = await API.getSubjects(state.currentSemester, state.currentYear); renderSubjects(); fillSubjectSelects(); toast('บันทึกบุคลากรแล้ว' + (linked ? ` • ผูกวิชาตามตารางสอน ${linked} วิชา` : ''));
}
async function removeUser(email){
  if(!confirm(`ยืนยันลบ ${email} ออกจากระบบ? (เข้าระบบไม่ได้อีก)`)) return;
  usersCache = await gas('deleteUser', email);
  closeModal(); renderUsers(); toast('ลบแล้ว');
}

/* ===================== ย้ายข้อมูลจากระบบเดิม (Google Sheets → Firebase) ===================== */
function openLegacyImportModal(){
  if(!isAdminUI()) return;
  document.getElementById('modalTitle').textContent = 'นำเข้าข้อมูลจากระบบเดิม (Google Sheets)';
  document.getElementById('modalBody').innerHTML = `
    <ol style="margin:0 0 12px 18px;padding:0;font-size:13.5px;line-height:1.7">
      <li>เปิดไฟล์ <b>เก็บคะแนนนักเรียน(งานหลัก)</b> ใน Google Sheets</li>
      <li>เมนู <b>ไฟล์ → ดาวน์โหลด → Microsoft Excel (.xlsx)</b></li>
      <li>เลือกไฟล์ที่ดาวน์โหลดด้านล่าง แล้วกด "ตรวจสอบ" ก่อน จากนั้นกด "นำเข้า"</li>
    </ol>
    <div class="form-row"><label>ไฟล์ .xlsx</label><input type="file" id="legacyFile" accept=".xlsx"></div>
    <div class="info-box">ไฟล์ถูกอ่านในเครื่องนี้เท่านั้น แล้วเขียนตรงเข้า Firebase ของโรงเรียน • นำเข้าซ้ำได้ (ข้อมูลเดิมในระบบใหม่จะถูกแทนที่ด้วยข้อมูลจากไฟล์) • รายวิชาทั้งหมดจะตั้งให้คุณเป็นครูผู้สอนก่อน แล้วค่อยมอบให้ครูท่านอื่นที่หน้า "รายวิชา"</div>
    <pre id="legacyLog" class="legacy-log"></pre>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ปิด</button>
      <button class="secondary" onclick="runLegacyImport(true)">🔍 ตรวจสอบ</button>
      <button class="primary" onclick="runLegacyImport(false)">📥 นำเข้า</button>
    </div>`;
  openModal();
}
async function loadXlsxLib(){
  if(window.XLSX) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('โหลดตัวอ่าน Excel ไม่สำเร็จ (ต้องออนไลน์)'));
    document.head.appendChild(s);
  });
}
async function runLegacyImport(dryRun){
  const f = document.getElementById('legacyFile').files[0];
  const logEl = document.getElementById('legacyLog');
  if(!f) return toast('กรุณาเลือกไฟล์ .xlsx','error');
  if(!dryRun && !confirm('ยืนยันนำเข้าข้อมูลจากไฟล์นี้? ข้อมูลรายวิชา/คะแนน/เช็คชื่อที่ซ้ำกันในระบบใหม่จะถูกแทนที่')) return;
  try{
    showLoading(true);
    await loadXlsxLib();
    const wb = XLSX.read(await f.arrayBuffer(), { type:'array' });
    const sheets = {};
    wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, raw:true, defval:'' }); });
    const res = await API.importLegacyWorkbook(sheets, { dryRun });
    logEl.textContent = (dryRun ? 'ผลการตรวจสอบ (ยังไม่ได้เขียนข้อมูล):\n' : 'นำเข้าสำเร็จ:\n') + res.log.map(x => '• ' + x).join('\n');
    if(!dryRun){ toast('นำเข้าข้อมูลเรียบร้อยแล้ว'); await loadApp(); }
  }catch(e){
    logEl.textContent = 'เกิดข้อผิดพลาด: ' + (e.message || e);
    toast(friendlyError(e), 'error');
  }finally{ showLoading(false); }
}

/* ===================== เช็คงาน (Tasks / Submissions) ===================== */

async function loadTaskPage(){
  const subjectId = document.getElementById('subjectSelectTop').value;
  const taskSelect = document.getElementById('taskSelect');
  const selectedTaskId = taskSelect ? taskSelect.value : '';

  if(!subjectId){
    document.getElementById('taskListContainer').innerHTML='<div class="empty">กรุณาเลือกรายวิชาที่แถบด้านบน</div>';
    document.getElementById('taskInfo').textContent='';
    if(taskSelect) taskSelect.innerHTML='<option value="">-- เลือกภาระงาน --</option>';
    return;
  }

  taskData = await gas('getTaskSubmissionData', subjectId, selectedTaskId);
  
  const tasks = taskData.tasks || [];
  taskSelect.innerHTML = tasks.length
    ? tasks.map(t => `<option value="${esc(t.task_id)}" ${taskData.currentTask && String(t.task_id) === String(taskData.currentTask.task_id)?'selected':''}>${esc(t.task_name)} ${t.due_date?`(${esc(t.due_date)})`:''}</option>`).join('')
    : '<option value="">-- ยังไม่มีภาระงาน --</option>';

  renderTaskList();
}

function renderTaskList(){
  const box = document.getElementById('taskListContainer');
  if (!box) return;

  if(!taskData.currentTask){
    box.innerHTML = '<div class="empty">วิชานี้ยังไม่มีรายการภาระงาน/การบ้าน กรุณากดปุ่ม <b>"+ เพิ่มภาระงาน"</b> ด้านบน</div>';
    document.getElementById('taskInfo').textContent = '';
    return;
  }

  const statuses = (taskData.statuses && taskData.statuses.length) ? taskData.statuses : (state.taskStatuses || []);
  const dueInfo = taskData.currentTask.due_date ? ` • กำหนดส่ง ${esc(taskData.currentTask.due_date)}` : '';
  
  document.getElementById('taskInfo').textContent =
    `${esc(taskData.subject.subject_name)} • งาน: ${esc(taskData.currentTask.task_name)}${dueInfo} • ${taskData.rows.length} คน`;

  if(!taskData.rows.length){
    box.innerHTML = '<div class="empty">ไม่พบรายชื่อนักเรียนของวิชานี้</div>';
    return;
  }

  box.innerHTML = taskData.rows.map(r => {
    const rStatus = String(r.status_id || '');
    const btns = statuses.map(s => {
      const sId = String(s.status_id || '');
      const active = (rStatus !== '' && rStatus === sId);
      return `<button type="button" class="att-btn${active?' active':''}" data-student="${esc(r.student_id)}" data-status="${esc(s.status_id)}" style="--att-color:${esc(s.color||'#0EA968')}">${esc(s.label)}</button>`;
    }).join('');
    return `<div class="attendance-row" data-student="${esc(r.student_id)}">
      <div class="attendance-name"><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.student_id)}${roomTag(taskData && taskData.subject, r)}</small></div>
      <div class="attendance-btns">${btns}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.att-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTaskStatus(btn));
  });
}

function selectTaskStatus(btn){
  const sid = String(btn.dataset.student || '');
  const statusId = String(btn.dataset.status || '');
  if (!taskData || !taskData.rows) return;

  const row = taskData.rows.find(r => String(r.student_id) === sid);
  if(row) {
    row.status_id = statusId;
  }
  const parent = btn.closest('.attendance-btns');
  if(parent){
    parent.querySelectorAll('.att-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
    });
  }
}

function markAllTaskSubmitted(){
  if(!taskData || !taskData.rows || !taskData.rows.length) return toast('ไม่มีรายชื่อนักเรียนให้เช็คงาน','error');
  if(!taskData.currentTask) return toast('กรุณาเลือกหรือสร้างภาระงานก่อน','error');
  if(!confirm('ต้องการกำหนดนักเรียนทั้งหมดเป็น "ส่งแล้ว" หรือไม่?')) return;
  
  const submittedId = (taskData.statuses[0]||{}).status_id;
  if(!submittedId) return toast('ไม่พบสถานะ "ส่งแล้ว"','error');
  taskData.rows.forEach(r => r.status_id = String(submittedId));
  renderTaskList();
  toast('กำหนดนักเรียนทั้งหมดเป็น ส่งแล้ว (กด "บันทึกการส่งงาน" เพื่อยืนยัน)');
}

async function saveTaskSubmissionsAll(){
  if(!taskData || !taskData.currentTask) return;
  const missing = taskData.rows.filter(r => !String(r.status_id || '').trim());
  if(missing.length && !confirm(`มีนักเรียน ${missing.length} คนที่ยังไม่ได้เลือกสถานะการส่งงาน ต้องการบันทึกเฉพาะรายการที่เลือกแล้วหรือไม่?`)) return;

  const payload = {
    subject_id: taskData.subject.subject_id,
    task_id: taskData.currentTask.task_id,
    rows: taskData.rows
      .filter(r => String(r.status_id || '').trim() !== '')
      .map(r => ({
        student_id: String(r.student_id),
        status_id: String(r.status_id),
        remark: String(r.remark || '')
      }))
  };
  taskData = await gas('saveTaskSubmissions', payload);
  renderTaskList();
  toast('บันทึกการส่งงานเรียบร้อยแล้ว');
}

function openTaskModal(){
  const subjectId = document.getElementById('subjectSelectTop').value;
  if(!subjectId) return toast('กรุณาเลือกวิชาก่อนเพิ่มภาระงาน','error');
  const subject = state.subjects.find(s => String(s.subject_id) === String(subjectId));

  document.getElementById('modalTitle').textContent = 'เพิ่มภาระงาน / การบ้าน';
  document.getElementById('modalBody').innerHTML = `
    <div class="form-row"><label>รายวิชา</label><input type="text" value="${esc(subject?.subject_name||'')}" disabled style="background:#f3f4f6"></div>
    <div class="form-row"><label>ชื่อภาระงาน / ชิ้นงาน *</label><input id="new_task_name" placeholder="เช่น แบบฝึกหัดที่ 1.1"></div>
    <div class="form-row"><label>กำหนดส่ง</label><input id="new_task_due" type="date" value="${todayStr()}"></div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" onclick="saveNewTask()">บันทึกภาระงาน</button>
    </div>
  `;
  openModal();
}

async function saveNewTask(){
  const subjectId = document.getElementById('subjectSelectTop').value;
  const taskName = v('new_task_name');
  if(!taskName.trim()) return toast('กรุณากรอกชื่อภาระงาน','error');

  await gas('saveTask', {
    subject_id: subjectId,
    task_name: taskName,
    due_date: v('new_task_due')
  });

  closeModal();
  toast('เพิ่มภาระงานเรียบร้อยแล้ว');
  loadTaskPage();
}

function openTaskStatusModal(){
  editingTaskStatusId = null;
  renderTaskStatusModalBody();
  openModal();
}

function renderTaskStatusModalBody(){
  const list = state.taskStatuses || [];
  const defaults = ['SUBMITTED','LATE','REVISE','MISSING','EXCUSED'];
  document.getElementById('modalTitle').textContent = 'จัดการสถานะการส่งงาน';
  document.getElementById('modalBody').innerHTML = `
    <div class="att-status-manage-list">
      ${list.map(s => `<div class="att-status-manage-row">
        <span class="att-status-dot" style="background:${esc(s.color)}"></span>
        <span class="att-status-manage-label">${esc(s.label)} <small style="color:var(--ink-soft)">(${Number(s.score_value).toFixed(1)} คะแนน)</small></span>
        <button type="button" class="small-btn" onclick="editTaskStatus('${esc(s.status_id)}')">แก้ไข</button>
        ${defaults.includes(s.status_id)?'':`<button type="button" class="danger small-btn" onclick="removeTaskStatus('${esc(s.status_id)}')">ลบ</button>`}
      </div>`).join('') || '<p style="color:var(--ink-soft)">ยังไม่มีสถานะ</p>'}
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <p style="margin:0 0 8px;font-weight:500;font-size:13.5px">${editingTaskStatusId?'แก้ไขสถานะการส่งงาน':'เพิ่มสถานะการส่งงานใหม่'}</p>
    <div class="form-grid">
      <div class="form-row"><label>ชื่อสถานะ</label><input id="newTaskStatusLabel" placeholder="เช่น ส่งแบบร่าง"></div>
      <div class="form-row"><label>สี</label><input id="newTaskStatusColor" type="color" value="#0EA968"></div>
      <div class="form-row"><label>ค่าน้ำหนักคะแนน (0-1)</label><input id="newTaskStatusScore" type="number" min="0" max="1" step="0.1" value="1"></div>
    </div>
    <div class="modal-actions">
      ${editingTaskStatusId?'<button class="secondary" onclick="cancelEditTaskStatus()">ยกเลิกแก้ไข</button>':''}
      <button class="secondary" onclick="closeModal()">ปิด</button>
      <button class="primary" onclick="addTaskStatus()">${editingTaskStatusId?'บันทึกการแก้ไข':'+ เพิ่มสถานะ'}</button>
    </div>
  `;
  if(editingTaskStatusId){
    const s = list.find(x => String(x.status_id) === String(editingTaskStatusId));
    if(s){
      document.getElementById('newTaskStatusLabel').value = s.label;
      document.getElementById('newTaskStatusColor').value = s.color;
      document.getElementById('newTaskStatusScore').value = s.score_value;
    }
  }
}

function editTaskStatus(statusId){
  editingTaskStatusId = statusId;
  renderTaskStatusModalBody();
}

function cancelEditTaskStatus(){
  editingTaskStatusId = null;
  renderTaskStatusModalBody();
}

async function addTaskStatus(){
  const label = v('newTaskStatusLabel');
  if(!label.trim()) return toast('กรุณากรอกชื่อสถานะ', 'error');
  const payload = {label, color: v('newTaskStatusColor')||'#0EA968', score_value: v('newTaskStatusScore')};
  if(editingTaskStatusId) payload.status_id = editingTaskStatusId;

  state.taskStatuses = await gas('saveTaskStatus', payload);
  toast(editingTaskStatusId ? 'แก้ไขสถานะแล้ว' : 'เพิ่มสถานะแล้ว');
  editingTaskStatusId = null;
  renderTaskStatusModalBody();
  if(document.getElementById('page-tasks').classList.contains('active')) loadTaskPage();
}

async function removeTaskStatus(statusId){
  if(!confirm('ยืนยันการลบสถานะนี้?')) return;
  state.taskStatuses = await gas('deleteTaskStatus', statusId);
  renderTaskStatusModalBody();
  if(document.getElementById('page-tasks').classList.contains('active')) loadTaskPage();
}

async function loadTaskSummary(customMax){
  const subjectId = document.getElementById('subjectSelectTop').value;
  if(!subjectId) return toast('กรุณาเลือกวิชา', 'error');
  const base = (customMax !== undefined && Number(customMax) > 0) ? Number(customMax) : taskSummaryBaseScore;
  const data = await gas('getTaskSummary', subjectId, base);
  renderTaskSummary(data);
}

function renderTaskSummary(data){
  const box = document.getElementById('taskSummaryBox');
  const statuses = data.statuses || [];

  if(!data.totalTasks){
    box.innerHTML = '<div class="empty">ยังไม่มีภาระงานสำหรับวิชานี้</div>';
    return;
  }

  taskSummaryBaseScore = data.baseMax || 10;

  const statCards = `<div class="report-grid">
    <div class="report-stat"><small>จำนวนภาระงานทั้งหมด</small><b>${data.totalTasks} งาน</b></div>
    <div class="report-stat"><small>นักเรียนทั้งหมด</small><b>${data.students.length} คน</b></div>
    <div class="report-stat"><small>อัตราการส่งงานรวม</small><b>${data.submissionRate}%</b></div>
    <div class="report-stat"><small>บันทึกการส่งงานทั้งหมด</small><b>${data.totalRecords} รายการ</b></div>
  </div>`;

  const totalForBar = statuses.reduce((sum, s) => sum + (data.overallCounts[s.status_id] || 0), 0) || 1;
  const bars = `<div class="grade-bars">${statuses.map(s => {
    const n = data.overallCounts[s.status_id] || 0;
    const pct = Math.round(n * 100 / totalForBar);
    return `<div class="grade-bar"><b>${esc(s.label)}</b><div class="bar"><i style="width:${pct}%;background:${esc(s.color)}"></i></div><span>${n} (${pct}%)</span></div>`;
  }).join('')}</div>`;

  const studentTable = `<div class="table-wrap" style="margin-top:14px"><table>
    <thead><tr>
      <th>รหัส</th>
      <th>ชื่อ–สกุล</th>
      ${statuses.map(s => `<th>${esc(s.label)}</th>`).join('')}
      <th>งานที่ตรวจ</th>
      <th>คะแนนดิบรวม</th>
      <th>คะแนนที่ได้ (เต็ม ${taskSummaryBaseScore})</th>
      <th>ความรับผิดชอบ (%)</th>
    </tr></thead>
    <tbody>${data.students.map(st => {
      const cells = statuses.map(s => `<td>${st.counts[s.status_id]||0}</td>`).join('');
      return `<tr>
        <td>${esc(st.student_id)}</td>
        <td>${esc(st.first_name)} ${esc(st.last_name)}</td>
        ${cells}
        <td>${st.totalChecked} / ${data.totalTasks}</td>
        <td><b>${st.scoreSum.toFixed(2)}</b> / ${st.maxPossibleScore}</td>
        <td><span class="grade att-good" style="font-weight:700;font-size:13.5px;">${st.earnedScore.toFixed(2)}</span></td>
        <td><span class="grade ${attendanceScoreClass(st.taskScore/10)}">${st.taskScore.toFixed(1)}%</span></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;

  const history = `<div class="table-wrap" style="margin-top:14px"><table>
    <thead><tr><th>ภาระงาน / การบ้าน</th><th>กำหนดส่ง</th>${statuses.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>ตรวจแล้ว</th><th></th></tr></thead>
    <tbody>${data.taskList.map(t => {
      const cells = statuses.map(s => `<td>${t.counts[s.status_id]||0}</td>`).join('');
      return `<tr><td><b>${esc(t.task_name)}</b></td><td>${esc(t.due_date||'-')}</td>${cells}<td>${t.total}</td><td><button class="small-btn" onclick="editTaskSubmissionsById('${esc(t.task_id)}')">✏️ แก้ไข</button></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;

  const scoreConfigToolbar = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 8px;flex-wrap:wrap;gap:10px;">
      <h4 style="margin:0;font-size:15px;">สรุปคะแนนส่งงานรายบุคคล</h4>
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-size:12.5px;color:var(--ink-soft);font-weight:500;">คำนวณเทียบฐานคะแนนเต็ม:</label>
        <input type="number" id="inpTaskSummaryBase" value="${taskSummaryBaseScore}" min="1" max="100" style="width:70px;min-height:34px;padding:4px 8px;text-align:center;">
        <button class="secondary small-btn" onclick="updateTaskSummaryBase()">คำนวณใหม่</button>
      </div>
    </div>
  `;

  box.innerHTML = statCards + bars +
    scoreConfigToolbar + studentTable +
    `<h4 style="margin:22px 0 4px;font-size:14.5px">ประวัติภาระงานทั้งหมด</h4>` +
    `<p style="margin:0 0 4px;color:var(--ink-soft);font-size:12.5px">คลิก "แก้ไข" เพื่อสลับไปตรวจงานชิ้นนั้นๆ</p>` + history;
}

function updateTaskSummaryBase() {
  const val = Number(v('inpTaskSummaryBase'));
  if (val > 0) {
    taskSummaryBaseScore = val;
    loadTaskSummary(val);
  }
}

function editTaskSubmissionsById(taskId){
  const taskSelect = document.getElementById('taskSelect');
  if(taskSelect) taskSelect.value = taskId;
  loadTaskPage();
  toast('สลับไปยังภาระงานที่เลือกแล้ว');
  const listEl = document.getElementById('taskListContainer');
  if(listEl) listEl.scrollIntoView({behavior:'smooth', block:'start'});
}

/* ===================== ส่วนบันทึกคะแนนและพิมพ์ตาราง ===================== */

async function loadScorePage(){
  const id=document.getElementById('subjectSelectTop').value;
  if(!id){document.getElementById('scoreTable').innerHTML='<tr><td class="empty">กรุณาเลือกรายวิชาที่แถบด้านบน</td></tr>';return;}
  scoreData=await gas('getScoreEntryData',id);
  renderScoreTable();
}

function renderScoreTable(){
  const t=document.getElementById('scoreTable'), items=scoreData.items, rows=scoreData.rows, cfg=scoreData.config||{};
  const cat=categories();
  const cats=[cat.classwork, cat.attendance, cat.tasks, cat.midterm, cat.final];
  const weights={[cat.classwork]:cfg.classwork_weight, [cat.attendance]:cfg.classwork_weight, [cat.tasks]:cfg.classwork_weight, [cat.midterm]:cfg.midterm_weight, [cat.final]:cfg.final_weight};
  const byCat=cats.map(c=>items.filter(i=>(i.category||cat.classwork)===c));
  const locked=!!cfg.locked;

  document.getElementById('scoreInfo').textContent=
    `${scoreData.subject.subject_name} • ${rows.length} คน • สัดส่วน คะแนนเก็บ ${weights[cat.classwork]||0}% (รวมเข้าเรียน/ส่งงาน) + กลางภาค ${weights[cat.midterm]||0}% + ปลายภาค ${weights[cat.final]||0}%`+
    (locked?' • 🔒 ล็อกคะแนนแล้ว':'');
  const lockBtn=document.getElementById('lockBtn');
  if(lockBtn) lockBtn.textContent = locked ? '🔓 ปลดล็อกคะแนน' : '🔒 ล็อกคะแนน';

  const catHeaderRow = '<tr><th rowspan="2" class="sc-id">รหัส</th><th rowspan="2" class="sc-name">ชื่อ–สกุล</th>' +
    byCat.map((cItems,ci)=> {
      if(!cItems.length) return '';
      const c = cats[ci];
      const label = (c === cat.attendance) 
        ? 'คะแนนเข้าเรียน<br><small style="font-weight:400;font-size:11px;">(ดึงอัตโนมัติ)</small>' 
        : (c === cat.tasks) 
        ? 'ส่งงาน<br><small style="font-weight:400;font-size:11px;">(ดึงอัตโนมัติ)</small>' 
        : `${esc(c)} (${weights[c]||0}%)`;
      return `<th colspan="${cItems.length}">${label}</th>`;
    }).join('') +
    '<th rowspan="2">รวม</th><th rowspan="2">เกรด</th><th rowspan="2">สถานะ</th></tr>';
    
  const itemHeaderRow = '<tr>' + byCat.map(cItems=>
    cItems.map(i=>{
      const isAtt = i.category === cat.attendance;
      const isTask = i.category === cat.tasks;
      const icon = isAtt ? '🗓️ ' : isTask ? '📑 ' : '';
      return `<th>${icon}${esc(i.item_name)}${i.is_retake?' 🔁':''}<br><small>เต็ม ${i.max_score}</small></th>`;
    }).join('')
  ).join('') + '</tr>';

  t.innerHTML = '<thead>'+catHeaderRow+itemHeaderRow+'</thead><tbody>'+
    rows.map((r,ri)=>{
      const special = r.status && r.status!=='NORMAL';
      const disableInputs = locked || special;
      const cells = byCat.map((cItems,ci)=>{
        const c=cats[ci];
        const itemCells = cItems.map(i=>{
          const isAtt = i.category === cat.attendance;
          const isTask = i.category === cat.tasks;
          const isAuto = isAtt || isTask;
          const title = isAtt ? 'คำนวณจากระบบเช็คชื่ออัตโนมัติ' : isTask ? 'คำนวณจากระบบเช็คงานอัตโนมัติ' : '';
          return `<td><input class="score-input" data-item="${esc(i.item_id)}" data-cat="${esc(i.category)}" type="number" min="0" max="${i.max_score}" step="0.01" value="${r.scores[i.item_id]??''}" ${disableInputs || isAuto ? 'disabled' : ''} ${isAuto ? 'style="background:#f3f4f6;font-weight:600;color:var(--fb-blue);"' : ''} title="${title}"></td>`;
        }).join('');
        return itemCells;
      }).join('');
      const gradeDisplay = `<span class="grade${special?' special':''}">${esc(r.grade)}</span>`;
      const statusSelect = `<select class="status-select" data-student="${esc(r.student_id)}" ${locked?'disabled':''}>
        <option value="NORMAL" ${r.status==='NORMAL'?'selected':''}>ปกติ</option>
        <option value="I" ${r.status==='I'?'selected':''}>ร</option>
        <option value="W" ${r.status==='W'?'selected':''}>มส</option>
        <option value="ZERO" ${r.status==='ZERO'?'selected':''}>0 (ทุจริต)</option>
      </select>`;
      return `<tr data-row="${ri}" data-student="${esc(r.student_id)}"><td class="sc-id">${esc(r.student_id)}</td><td class="sc-name"><span class="sc-nm">${esc(r.first_name)} ${esc(r.last_name)}</span><small class="sc-sid">${esc(r.student_id)}${roomTag(scoreData.subject, r)}</small><span class="sc-rt">${roomTag(scoreData.subject, r)}</span></td>${cells}<td class="row-total">${special?'-':Number(r.total).toFixed(2).replace('.00','')}</td><td class="row-grade">${gradeDisplay}</td><td>${statusSelect}</td></tr>`;
    }).join('') + '</tbody>';

  t.querySelectorAll('.score-input:not([disabled])').forEach(inp=>inp.addEventListener('input',()=>updateRowTotal(inp.closest('tr'))));
  t.querySelectorAll('.status-select').forEach(sel=>sel.addEventListener('change',()=>updateStudentStatus(sel)));
}

function updateRowTotal(tr){
  const cfg=scoreData.config||{}, items=scoreData.items, cat=categories();
  const cats=[cat.classwork, cat.attendance, cat.tasks, cat.midterm, cat.final];
  const weights={[cat.classwork]:Number(cfg.classwork_weight||0),[cat.midterm]:Number(cfg.midterm_weight||0),[cat.final]:Number(cfg.final_weight||0)};
  const isRetake = i => i.is_retake === true || i.is_retake === 'TRUE' || i.is_retake === 'true';

  const breakdown = {};
  cats.forEach(c => {
    const catItems = items.filter(i => (i.category || cat.classwork) === c);
    const retake = catItems.filter(isRetake);
    const regular = catItems.filter(i => !isRetake(i));
    let hasRetakeVal = false;
    retake.forEach(i => {
      const inp = tr.querySelector(`.score-input[data-item="${i.item_id}"]`);
      if (inp && inp.value !== '') hasRetakeVal = true;
    });
    const active = hasRetakeVal ? retake : (regular.length ? regular : retake);

    let raw = 0, max = 0;
    active.forEach(i => {
      const inp = tr.querySelector(`.score-input[data-item="${i.item_id}"]`);
      max += Number(i.max_score) || 0;
      if (inp && inp.value !== '') raw += Number(inp.value) || 0;
    });
    const pct = max > 0 ? (raw / max) * 100 : 0;
    breakdown[c] = { raw, max, pct };
  });

  const totalCwRaw = (breakdown[cat.classwork]?.raw || 0) + (breakdown[cat.attendance]?.raw || 0) + (breakdown[cat.tasks]?.raw || 0);
  const totalCwMax = (breakdown[cat.classwork]?.max || 0) + (breakdown[cat.attendance]?.max || 0) + (breakdown[cat.tasks]?.max || 0);
  const effectiveCwPct = totalCwMax > 0 ? (totalCwRaw / totalCwMax) * 100 : (breakdown[cat.classwork]?.pct || 0);

  const weighted =
    effectiveCwPct * (weights[cat.classwork] || 0) / 100 +
    (breakdown[cat.midterm]?.pct || 0) * (weights[cat.midterm] || 0) / 100 +
    (breakdown[cat.final]?.pct || 0) * (weights[cat.final] || 0) / 100;

  const total = Math.round(weighted * 100) / 100;
  tr.querySelector('.row-total').textContent = total.toFixed(2).replace('.00','');
  const rule = state.gradeRules.find(r => total >= Number(r.min_score) && total <= Number(r.max_score));
  tr.querySelector('.row-grade').innerHTML = `<span class="grade">${rule ? esc(rule.grade) : '-'}</span>`;
}

function printScoreTable() {
  if(!scoreData || !scoreData.rows || scoreData.rows.length === 0) {
    return toast('ไม่มีข้อมูลคะแนนสำหรับพิมพ์', 'error');
  }

  const sub = scoreData.subject || {};
  const schoolName = state.settings.SCHOOL_NAME || 'โรงเรียน';
  const term = `${esc(sub.semester || state.currentSemester)}/${esc(sub.academic_year || state.currentYear)}`;
  const title = `แบบบันทึกคะแนน - ${esc(sub.subject_code || '')} ${esc(sub.subject_name || '')} ชั้น ${esc(sub.level || '')}/${esc(sub.room || '')}`;

  const cat = categories();
  const cats = [cat.classwork, cat.attendance, cat.tasks, cat.midterm, cat.final];
  const items = scoreData.items || [];
  const byCat = cats.map(c => items.filter(i => (i.category || cat.classwork) === c));

  let catHeaders = '<tr><th rowspan="2">รหัส</th><th rowspan="2">ชื่อ–สกุล</th>';
  byCat.forEach((cItems, ci) => {
    if(!cItems.length) return;
    const c = cats[ci];
    const label = (c === cat.attendance) ? 'คะแนนเข้าเรียน<br>(ดึงอัตโนมัติ)' : (c === cat.tasks) ? 'ส่งงาน<br>(ดึงอัตโนมัติ)' : esc(c);
    catHeaders += `<th colspan="${cItems.length}">${label}</th>`;
  });
  catHeaders += '<th rowspan="2">รวม</th><th rowspan="2">เกรด</th><th rowspan="2">สถานะ</th></tr>';

  let itemHeaders = '<tr>';
  byCat.forEach(cItems => {
    cItems.forEach(i => {
      itemHeaders += `<th>${esc(i.item_name)}<br><small>(${i.max_score})</small></th>`;
    });
  });
  itemHeaders += '</tr>';

  let rowsHtml = '';
  scoreData.rows.forEach(r => {
    let cells = '';
    byCat.forEach(cItems => {
      cItems.forEach(i => {
        const sc = r.scores[i.item_id] !== undefined && r.scores[i.item_id] !== null && r.scores[i.item_id] !== '' ? r.scores[i.item_id] : '-';
        cells += `<td style="text-align:center;">${sc}</td>`;
      });
    });
    const statusLabel = r.status && r.status !== 'NORMAL' ? (STATUS_LABELS[r.status] || r.status) : 'ปกติ';
    rowsHtml += `<tr>
      <td style="text-align:center;">${esc(r.student_id)}</td>
      <td>${esc(r.first_name)} ${esc(r.last_name)}</td>
      ${cells}
      <td style="text-align:center;font-weight:bold;">${r.status !== 'NORMAL' ? '-' : Number(r.total).toFixed(2).replace('.00','')}</td>
      <td style="text-align:center;font-weight:bold;">${esc(r.grade)}</td>
      <td style="text-align:center;">${esc(statusLabel)}</td>
    </tr>`;
  });

  const printHtml = `
    <html>
    <head>
      <title>${title}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Mitr:wght@300;400;500;600&display=swap" rel="stylesheet">
      <style>
        @page { size: landscape; margin: 10mm; }
        body { font-family: 'TH Sarabun New', 'TH Sarabun PSK', sans-serif; font-size: 14px; color: #111; margin: 0; padding: 10px; }
        h2, h3 { margin: 0 0 4px 0; text-align: center; }
        h2 { font-size: 20px; font-weight: 600; }
        h3 { font-size: 16px; font-weight: 500; }
        .sub-info { font-size: 14px; margin: 6px 0 12px 0; text-align: center; color: #333; }
        table { width: 100%; border-collapse: collapse; margin-top: 5px; }
        th, td { border: 1px solid #333; padding: 6px 4px; font-size: 13px; }
        th { background: #f5f5f5; text-align: center; font-weight: 600; }
      </style>
    </head>
    <body>
      <h2>${esc(schoolName)}</h2>
      <h3>แบบบันทึกคะแนนและผลการเรียน</h3>
      <div class="sub-info">
        รายวิชา: <b>${esc(sub.subject_code || '')} ${esc(sub.subject_name || '')}</b> | 
        ระดับชั้น: <b>${esc(sub.level || '')}/${esc(sub.room || '')}</b> | 
        ภาคเรียนที่: <b>${term}</b> | 
        จำนวนนักเรียน: <b>${scoreData.rows.length} คน</b>
      </div>
      <table>
        <thead>${catHeaders}${itemHeaders}</thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body>
    </html>
  `;

  const w = window.open('', '_blank');
  if(!w) return;
  w.document.write(printHtml);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 500);
}

async function updateStudentStatus(sel){
  const studentId=sel.dataset.student, status=sel.value;
  let remark='';
  if(status!=='NORMAL'){
    remark=prompt('หมายเหตุ (ถ้ามี):','')||'';
  }
  scoreData=await gas('saveStudentStatus',{student_id:studentId,subject_id:scoreData.subject.subject_id,status,remark});
  renderScoreTable();
  toast('อัปเดตสถานะแล้ว');
}

async function toggleScoreLock(){
  const id=document.getElementById('subjectSelectTop').value;
  if(!id)return toast('กรุณาเลือกวิชา','error');
  const newLock = !(scoreData?.config?.locked);
  if(newLock && !confirm('ยืนยันล็อกคะแนนวิชานี้? จะไม่สามารถแก้ไขคะแนนหรือสถานะนักเรียนได้จนกว่าจะปลดล็อก'))return;
  await gas('setScoreLock', id, newLock);
  scoreData=await gas('getScoreEntryData', id);
  renderScoreTable();
  toast(newLock?'ล็อกคะแนนแล้ว':'ปลดล็อกคะแนนแล้ว');
}

async function saveAllScores(){
  if(!scoreData)return toast('กรุณาเลือกรายวิชา','error');
  if(scoreData.config?.locked) return toast('คะแนนถูกล็อกอยู่ ไม่สามารถบันทึกได้ กรุณาปลดล็อกก่อน','error');
  const rows=[...document.querySelectorAll('#scoreTable tbody tr')].map((tr,ri)=>{
    const r=scoreData.rows[ri], scores={};
    tr.querySelectorAll('.score-input').forEach(i=>scores[i.dataset.item]=i.value);
    return {student_id:r.student_id,scores};
  });
  scoreData=await gas('saveScores',{subject_id:scoreData.subject.subject_id,rows});
  state.summary=await gas('getDashboardSummary',scoreData.subject.subject_id, state.currentSemester, state.currentYear);
  renderScoreTable(); renderDashboardStats(); toast('บันทึกคะแนนเรียบร้อย');
}

function renderDashboardStats(){ dashStale = true; if (document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard(); }

let stuRoom = null;   // 'ม.4|1' หรือ 'ALL'
function roomKeyOf(s){ return `${s.class_level}|${s.room}`; }
function roomSort(a, b){ return a.replace('|', '/').localeCompare(b.replace('|', '/'), 'th', { numeric: true }); }
function setStuRoom(k){ stuRoom = k; try { localStorage.setItem('classhub_stu_room', k); } catch (e) {} renderStudents(); }
function renderStudents(){
  const active = state.students.filter(s => s.status !== 'INACTIVE');
  const table = document.getElementById('studentsTable');
  if (!table) return;
  const roomsBox = document.getElementById('stuRooms'), info = document.getElementById('stuInfo');
  const counts = {};
  active.forEach(s => { counts[roomKeyOf(s)] = (counts[roomKeyOf(s)] || 0) + 1; });
  const keys = Object.keys(counts).sort(roomSort);
  if (stuRoom === null) { try { stuRoom = localStorage.getItem('classhub_stu_room'); } catch (e) {} }
  if (!stuRoom || (stuRoom !== 'ALL' && !counts[stuRoom])) stuRoom = keys[0] || null;
  if (stuRoom === 'ALL' && keys.length < 2) stuRoom = keys[0] || null;
  if (roomsBox) roomsBox.innerHTML = keys.map(k => `<button class="stu-room${stuRoom === k ? ' on' : ''}" onclick="setStuRoom('${esc(k)}')">${esc(k.replace('|', '/'))}<small>${counts[k]}</small></button>`).join('')
    + (keys.length > 1 ? `<button class="stu-room${stuRoom === 'ALL' ? ' on' : ''}" onclick="setStuRoom('ALL')">ทั้งหมด<small>${active.length}</small></button>` : '');

  const head = '<thead><tr><th>ที่</th><th>รหัส</th><th>คำนำหน้า</th><th>ชื่อ–สกุล</th><th>ชั้น/ห้อง</th><th></th></tr></thead>';
  if (active.length === 0) {
    if (info) info.textContent = '';
    table.innerHTML = head + '<tbody><tr><td colspan="6" class="empty">ยังไม่มีข้อมูลนักเรียนในภาคเรียนนี้</td></tr></tbody>';
    return;
  }
  const q = (document.getElementById('stuSearch')?.value || '').trim().toLowerCase();
  let list = q ? active : active.filter(s => !stuRoom || stuRoom === 'ALL' || roomKeyOf(s) === stuRoom);
  if (q) list = list.filter(s => `${s.student_id} ${s.prefix || ''}${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
  list = list.slice().sort((a, b) => roomSort(roomKeyOf(a), roomKeyOf(b)) || String(a.student_id).localeCompare(String(b.student_id), 'th', { numeric: true }));
  if (info) info.innerHTML = q ? `ผลการค้นหา "${esc(q)}" ทุกห้อง: <b>${list.length}</b> คน`
    : `${!stuRoom || stuRoom === 'ALL' ? 'ทุกห้อง' : 'ชั้น ' + esc(stuRoom.replace('|', '/'))} • <b>${list.length}</b> คน • ภาคเรียน ${esc(state.currentSemester)}/${esc(state.currentYear)}`;
  let lastRoom = null;
  table.innerHTML = head + '<tbody>' + (list.length ? list.map((s, i) => {
    let sep = '';
    if ((stuRoom === 'ALL' || q) && roomKeyOf(s) !== lastRoom) { lastRoom = roomKeyOf(s); sep = `<tr class="stu-sep"><td colspan="6">ชั้น ${esc(lastRoom.replace('|', '/'))}</td></tr>`; }
    return sep + `<tr><td>${i + 1}</td><td>${esc(s.student_id)}</td><td>${esc(s.prefix||'')}</td><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td>${esc(s.class_level)}/${esc(s.room)}</td><td>${isAdminUI()?`<button class="small-btn" onclick='openStudentModal(${JSON.stringify(s).replace(/'/g,"&#39;")})'>แก้ไข</button> <button class="danger" onclick="removeStudent('${esc(s.student_id)}')">ลบ</button>`:''}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">ไม่พบนักเรียน</td></tr>') + '</tbody>';
}

function renderSubjects(){
  const active = state.subjects.filter(s => 
    s.status !== 'INACTIVE' &&
    (!state.currentSemester || String(s.semester) === String(state.currentSemester)) &&
    (!state.currentYear || String(s.academic_year) === String(state.currentYear))
  );

  if(!active.length){document.getElementById('subjectsTable').innerHTML='<tbody><tr><td class="empty">ยังไม่มีรายวิชาในภาคเรียนนี้ — กด "+ เพิ่มวิชา"</td></tr></tbody>';return;}
  document.getElementById('subjectsTable').innerHTML='<thead><tr><th>รหัสวิชา</th><th>ชื่อวิชา</th><th>ชั้น/ห้อง</th><th>ภาคเรียน</th><th>ปี</th><th>คะแนนเต็ม</th><th>ครูผู้สอน</th><th></th></tr></thead><tbody>'+
    active.map(s=>`<tr><td>${esc(s.subject_code||s.subject_id)}</td><td>${esc(s.subject_name)}</td><td>${esc(subjRoomLabel(s))}${isCombined(s) ? ' <span class="comb-chip">เรียนรวม</span>' : ''}</td><td>${esc(s.semester)}</td><td>${esc(s.academic_year)}</td><td>${s.max_score}</td><td style="white-space:normal;max-width:260px;font-size:12px">${(s.teachers||[]).length ? s.teachers.map(e=>esc(teacherName(e))).join(', ') : (s.planned_teacher ? `<span style="color:var(--ink-soft)">${esc(s.planned_teacher)}</span> <span class="ii-note" style="display:inline">ยังไม่มีอีเมล</span>` : '<span style="color:var(--ink-faint)">-</span>')}</td><td><button class="small-btn" onclick='openSubjectModal(${JSON.stringify(s).replace(/'/g,"&#39;")})'>แก้ไข</button> <button class="danger" onclick="removeSubject('${esc(s.subject_id)}')">ลบ</button></td></tr>`).join('')+'</tbody>';
}

async function renderItems(){
  const subjectId = document.getElementById('subjectSelectTop').value;
  const table = document.getElementById('itemsTable');
  
  if(!subjectId) {
    table.innerHTML = '<tr><td class="empty">กรุณาเลือกรายวิชาที่แถบด้านบนก่อน</td></tr>';
    return;
  }
  
  const items = await gas('getScoreItems', subjectId);
  
  if(items.length === 0) {
    table.innerHTML = '<thead><tr><th>วิชา</th><th>องค์ประกอบ</th><th>หมวด</th><th>คะแนนเต็ม</th><th>ลำดับ</th><th>แก้ตัว</th><th></th></tr></thead><tbody><tr><td colspan="7" class="empty">ยังไม่มีข้อมูลองค์ประกอบคะแนน</td></tr></tbody>';
    return;
  }
  
  table.innerHTML='<thead><tr><th>วิชา</th><th>องค์ประกอบ</th><th>หมวด</th><th>คะแนนเต็ม</th><th>ลำดับ</th><th>แก้ตัว</th><th></th></tr></thead><tbody>'+
    items.map(i=>{const s=state.subjects.find(x=>String(x.subject_id)===String(i.subject_id));return `<tr><td>${esc(s?.subject_name||i.subject_id)}</td><td>${esc(i.item_name)}</td><td>${esc(i.category)}</td><td>${i.max_score}</td><td>${i.sequence}</td><td>${i.is_retake?'🔁 ใช่':'-'}</td><td><button class="danger" onclick="removeItem('${esc(i.item_id)}')">ลบ</button></td></tr>`}).join('')+'</tbody>';
}

function openStudentModal(s={}){
  document.getElementById('modalTitle').textContent=s.student_id?'แก้ไขนักเรียน':'เพิ่มนักเรียน';
  document.getElementById('modalBody').innerHTML=`<div class="form-grid">
  <div class="form-row"><label>รหัสนักเรียน *</label><input id="m_student_id" value="${esc(s.student_id||'')}"></div>
  <div class="form-row"><label>คำนำหน้า</label><input id="m_prefix" list="prefixList" value="${esc(s.prefix||'')}" placeholder="เด็กชาย / เด็กหญิง / นาย / นางสาว"><datalist id="prefixList"><option value="เด็กชาย"><option value="เด็กหญิง"><option value="นาย"><option value="นางสาว"></datalist></div>
  <div class="form-row"><label>ชื่อ *</label><input id="m_first_name" value="${esc(s.first_name||'')}"></div>
  <div class="form-row"><label>นามสกุล *</label><input id="m_last_name" value="${esc(s.last_name||'')}"></div>
  <div class="form-row"><label>ชั้น</label><input id="m_level" value="${esc(s.class_level||'ม.5')}"></div>
  <div class="form-row"><label>ห้อง</label><input id="m_room" value="${esc(s.room||'2')}"></div>
  <div class="form-row"><label>ภาคเรียน</label><input id="m_stu_semester" value="${esc(s.semester||state.currentSemester||'1')}"></div>
  <div class="form-row"><label>ปีการศึกษา</label><input id="m_stu_year" value="${esc(s.academic_year||state.currentYear||'2569')}"></div>
  </div>
  <div class="modal-actions"><button class="secondary" onclick="closeModal()">ยกเลิก</button><button class="primary" onclick="saveStudentForm()">บันทึก</button></div>`;
  openModal();
}
async function saveStudentForm(){
  const sem = v('m_stu_semester') || state.currentSemester || '1';
  const yr = v('m_stu_year') || state.currentYear || '2569';
  state.students = await gas('saveStudent',{
    student_id: v('m_student_id'),
    prefix: v('m_prefix'),
    first_name: v('m_first_name'),
    last_name: v('m_last_name'),
    class_level: v('m_level'),
    room: v('m_room'),
    semester: sem,
    academic_year: yr,
    status: 'ACTIVE'
  });
  renderStudents(); 
  fillReportStudents(); 
  closeModal(); 
  toast('บันทึกนักเรียนแล้ว'); 
  renderDashboardStats();
}
async function removeStudent(id){
  if(!confirm(`ยืนยันการลบนักเรียนรหัส ${id} ในภาคเรียน ${state.currentSemester}/${state.currentYear}? (จะไม่กระทบกับเทอมอื่น)`)) return;
  state.students = await gas('deleteStudent', id, state.currentSemester, state.currentYear);
  renderStudents(); renderDashboardStats(); toast('ลบเรียบร้อยแล้ว');
}

function openSubjectModal(s={}){
  document.getElementById('modalTitle').textContent=s.subject_id?'แก้ไขรายวิชา':'เพิ่มรายวิชา';
  document.getElementById('modalBody').innerHTML=`
  <input type="hidden" id="m_subject_id" value="${esc(s.subject_id||'')}">
  <div class="form-grid">
    <div class="form-row"><label>รหัสวิชา (เช่น ค32101) *</label><input id="m_subject_code" value="${esc(s.subject_code||'')}"></div>
    <div class="form-row"><label>ชื่อวิชา *</label><input id="m_subject_name" value="${esc(s.subject_name||'')}"></div>
    <div class="form-row"><label>ชั้น (เช่น ม.5) *</label><input id="m_sub_level" value="${esc(s.level||'ม.5')}"></div>
    <div class="form-row"><label>ห้อง (เช่น 2) *</label><input id="m_sub_room" value="${esc(s.room||'2')}"></div>
    <div class="form-row"><label>ภาคเรียน</label><input id="m_semester" value="${esc(s.semester||state.currentSemester||'1')}"></div>
    <div class="form-row"><label>ปีการศึกษา</label><input id="m_year" value="${esc(s.academic_year||state.currentYear||'2569')}"></div>
    <div class="form-row"><label>คะแนนเต็ม</label><input id="m_max" type="number" value="${s.max_score||100}"></div>
  </div>
  ${isAdminUI()?`<div class="form-row"><label>ครูผู้สอน (อีเมล คั่นด้วยจุลภาค — ต้องอยู่ในรายชื่อบุคลากร)</label><input id="m_teachers" value="${esc((s.teachers||[]).join(', '))}" placeholder="เช่น teacher@ppj.ac.th"></div>`:''}
  <div class="modal-actions"><button class="secondary" onclick="closeModal()">ยกเลิก</button><button class="primary" onclick="saveSubjectForm()">บันทึก</button></div>`;
  openModal();
}
async function saveSubjectForm(){
  const subCode = v('m_subject_code').trim();
  const subName = v('m_subject_name').trim();
  const level = v('m_sub_level').trim();
  const room = v('m_sub_room').trim();

  if(!subCode) return toast('กรุณากรอกรหัสวิชา', 'error');
  if(!subName) return toast('กรุณากรอกชื่อวิชา', 'error');
  if(!level || !room) return toast('กรุณากรอกระดับชั้นและห้อง', 'error');

  state.subjects = await gas('saveSubject',{
    subject_id: v('m_subject_id'),
    subject_code: subCode,
    subject_name: subName,
    level: level,
    room: room,
    semester: v('m_semester'),
    academic_year: v('m_year'),
    max_score: v('m_max'),
    status: 'ACTIVE',
    teachers: document.getElementById('m_teachers') ? v('m_teachers').split(',').map(x=>x.trim()).filter(Boolean) : undefined
  });
  fillTermSelects(); fillSubjectSelects(); renderSubjects(); closeModal(); toast('บันทึกรายวิชาแล้ว'); renderDashboardStats();
}
/* ===================== นำเข้ารายวิชาจากไฟล์ตารางสอน (.json จากระบบจัดตารางสอน) ===================== */
let tt = null;          // ข้อมูลไฟล์
let ttRows = [];        // [{key, level, room, code, name, credit, teacherIds, teacherNames, emails, selected, exists}]

const NAME_PREFIX = /^(นางสาว|นาง|นาย|น\.ส\.|ว่าที่\s*ร\.?\s*ต\.?\s*(หญิง)?|ว่าที่ร้อยตรี(หญิง)?|ดร\.|ครู|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/i;
function normName(n){ let x = String(n || '').trim(); for (let i = 0; i < 3; i++) x = x.replace(NAME_PREFIX, ''); return x.replace(/\s+/g, ''); }

async function openSubjectImportModal(){
  if (!isAdminUI()) return toast('ทำได้เฉพาะผู้ดูแลระบบ', 'error');
  tt = null; ttRows = []; ttExistingFor = null; ttLoading = null;
  if (!usersCache.length) { try { usersCache = await API.getUsers(); } catch (e) {} }
  document.getElementById('modalTitle').textContent = `นำเข้ารายวิชา • ภาคเรียน ${state.currentSemester}/${state.currentYear}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="info-box">ใช้ไฟล์ <b>.json</b> ที่ส่งออกจากระบบจัดตารางสอน — ระบบจะสร้างรายวิชาแยกตามห้อง (เช่น ม.4/1, ม.4/2)
      และจับคู่ครูผู้สอนกับรายชื่อในเมนู "บุคลากร / สิทธิ์" ด้วยชื่อ-สกุล<br>
      วิชาที่มีอยู่แล้ว (รหัส ชื่อ ชั้น ห้องเดียวกัน) จะไม่ถูกสร้างซ้ำ และคะแนนเดิมไม่ถูกแตะต้อง</div>
    <div class="form-row"><label>เลือกไฟล์ (.json)</label><input type="file" id="ttFile" accept=".json,application/json" onchange="readTimetableFile()"></div>
    <div id="ttTermRow" class="form-grid" style="display:none">
      <div class="form-row"><label>ภาคเรียนในไฟล์</label><select id="ttTerm" onchange="ttSyncTarget();buildTimetableRows()"></select></div>
      <div class="form-row"><label>นำเข้าไปที่ภาคเรียน</label><select id="ttTarget" onchange="buildTimetableRows()"></select></div>
    </div>
    <div id="ttPreview"></div>
    <div class="import-opts">
      <label><input type="checkbox" id="tt_combine" checked onchange="buildTimetableRows()"> วิชาที่ไฟล์ระบุว่า "เรียนรวม" → รวมเป็นวิชาเดียวหลายห้อง (เช็คชื่อ/กรอกคะแนนพร้อมกัน)</label>
      <label><input type="checkbox" id="tt_update" checked> วิชาที่มีอยู่แล้ว: อัปเดตหน่วยกิตและครูผู้สอน และรวมห้องให้ถ้าไฟล์ระบุว่าเรียนรวม</label>
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" id="ttGoBtn" onclick="processSubjectImport()" disabled>นำเข้า</button>
    </div>`;
  openModal();
}

async function readTimetableFile(){
  const f = document.getElementById('ttFile').files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.subjects) || !Array.isArray(d.terms)) throw new Error('ไม่ใช่ไฟล์ที่ส่งออกจากระบบจัดตารางสอน (ไม่พบ subjects/terms)');
    tt = d;
    const cur = `${state.currentYear}-${state.currentSemester}`;
    const terms = d.terms.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const sel = document.getElementById('ttTerm');
    sel.innerHTML = terms.map(t => `<option value="${esc(t.id)}">${esc(t.label || t.id)} (${d.subjects.filter(s => s.termId === t.id).length} วิชา)</option>`).join('');
    sel.value = terms.some(t => t.id === cur) ? cur : terms[terms.length - 1].id;
    document.getElementById('ttTermRow').style.display = '';
    ttSyncTarget();
    buildTimetableRows();
  } catch (e) {
    document.getElementById('ttPreview').innerHTML = `<div class="empty">อ่านไฟล์ไม่สำเร็จ: ${esc(e.message || e)}</div>`;
  }
}

let ttExistingList = [], ttExistingFor = null, ttLoading = null;
function ttTargetTerm(){ const [sem, yr] = (v('ttTarget') || `${state.currentSemester}/${state.currentYear}`).split('/'); return { sem, yr }; }
function ttSyncTarget(){
  const [yr, sem] = v('ttTerm').split('-');
  const fileTerm = `${sem}/${yr}`;
  const terms = Array.from(new Set([...(state.registeredTerms || []), fileTerm, `${state.currentSemester}/${state.currentYear}`])).sort((a, b) => b.localeCompare(a));
  const sel = document.getElementById('ttTarget');
  sel.innerHTML = terms.map(t => `<option value="${t}">ภาคเรียน ${t}${t === fileTerm ? ' (ตามไฟล์)' : ''}${(state.registeredTerms || []).includes(t) ? '' : ' • ใหม่'}</option>`).join('');
  sel.value = fileTerm;
}
async function ttExisting(){
  const t = ttTargetTerm();
  if (t.sem === String(state.currentSemester) && t.yr === String(state.currentYear) && isAdminUI()) return state.subjects;
  try { return await API.getSubjectCatalog(t.sem, t.yr); } catch (e) { return []; }
}
function buildTimetableRows(){
  const termId = v('ttTerm');
  const teachers = {};
  (tt.teachers || []).forEach(t => { teachers[t.id] = t; });
  const byName = {};
  usersCache.filter(u => u.active !== false).forEach(u => { const k = normName(u.name); if (k) byName[k] = u.email; });
  const existing = new Set((ttExistingFor === v('ttTarget') ? ttExistingList : []).filter(s => s.status !== 'INACTIVE')
    .flatMap(s => subjRoomsUI(s).map(r => [s.subject_code, s.subject_name, s.level, r].map(x => String(x || '').trim()).join('|'))));
  const combineOn = document.getElementById('tt_combine') ? document.getElementById('tt_combine').checked : true;
  ttRows = [];
  tt.subjects.filter(s => s.termId === termId).sort((a, b) => (a.level - b.level) || ((a.order || 0) - (b.order || 0))).forEach(s => {
    const level = /^\d+$/.test(String(s.level)) ? `ม.${s.level}` : String(s.level);
    let rooms = [1, 2, 3].filter(r => s['room' + r]);
    if (!rooms.length) rooms = Array.from({ length: Number(s.rooms) || 1 }, (_, i) => i + 1);
    // เรียนรวม (เช่น combine = "1,2") → เป็นวิชาเดียวหลายห้อง
    const comb = String(s.combine || '').split(/[^0-9]+/).filter(Boolean).map(Number).filter(r => rooms.includes(r));
    const sets = (combineOn && comb.length > 1) ? [comb, ...rooms.filter(r => !comb.includes(r)).map(r => [r])] : rooms.map(r => [r]);
    sets.forEach(rs => {
      const ts = [...new Set(rs.map(r => s['room' + r]).filter(Boolean))].map(id => teachers[id]).filter(Boolean);
      const names = ts.map(t => `${t.prefix || ''}${t.firstName || ''} ${t.lastName || ''}`.trim());
      const emailsAll = ts.map(t => byName[normName(`${t.firstName || ''}${t.lastName || ''}`)] || '');
      const emails = emailsAll.filter(Boolean);
      const row = { level, room: String(rs[0]), rooms: rs.map(String), code: String(s.code || '').trim(), name: String(s.name || '').trim(), credit: Number(s.unit) || 0,
        teacherNames: names, teacherName: names.join(', '), emailsAll, emails, email: emails[0] || '',
        note: rs.length > 1 ? 'เรียนรวม' : (s.combine ? `เรียนรวมห้อง ${s.combine} (แยกวิชา)` : (s.note === 'วิทย์' ? 'สายวิทย์' : s.note === 'ศิลป์' ? 'สายศิลป์' : (s.note || ''))) };
      row.label = `${level}/${row.rooms.join('+')}`;
      // คาบสอน (วัน/คาบ/เวลา) จากตารางสอน
      const per = ((tt.schedules || {})[termId] || {}).periods || [];
      const cls = per.filter(p => p.type === 'class');
      const seen = new Set();
      row.schedule = (tt.timetable || []).filter(e => e.termId === termId && e.subjectId === s.id && rs.includes(Number(e.room)))
        .map(e => ({ day: Number(e.day), period: Number(e.period), room: String(e.room), start: (cls[e.period - 1] || {}).start || '', end: (cls[e.period - 1] || {}).end || '' }))
        .filter(e => { const k = e.day + '-' + e.period + '-' + e.room; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((x, y) => x.day - y.day || x.period - y.period);
      row.exists = row.rooms.some(r => existing.has([row.code, row.name, row.level, r].join('|')));
      row.selected = true;
      ttRows.push(row);
    });
  });
  renderTimetablePreview();
  // โหลดวิชาที่มีอยู่แล้วของภาคเรียนปลายทาง แล้วคำนวณใหม่ (ครั้งเดียวต่อการเปลี่ยนภาคเรียน)
  const tk = v('ttTarget');
  if (ttExistingFor !== tk && ttLoading !== tk) {
    ttLoading = tk;
    ttExisting().then(list => { ttExistingList = list; ttExistingFor = tk; ttLoading = null; if (v('ttTarget') === tk) buildTimetableRows(); });
  }
}

function renderTimetablePreview(){
  const box = document.getElementById('ttPreview');
  if (!ttRows.length) { box.innerHTML = '<div class="empty">ไม่พบรายวิชาในภาคเรียนนี้</div>'; document.getElementById('ttGoBtn').disabled = true; return; }
  const groups = {};
  ttRows.forEach((r, i) => { (groups[r.label] = groups[r.label] || []).push(i); });
  const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  const sel = ttRows.filter(r => r.selected);
  const nNew = sel.filter(r => !r.exists).length, nOld = sel.length - nNew;
  const noT = sel.filter(r => !r.email).length;
  const unmatched = [...new Set(ttRows.flatMap(r => r.teacherNames.filter((n, i) => !r.emailsAll[i])))];
  box.innerHTML = `
    <div class="import-head"><b>พบ ${ttRows.length} รายวิชา-ห้อง ใน ${keys.length} ห้อง</b>
      <span><button class="small-btn" onclick="selectTimetable(null,true)">เลือกทั้งหมด</button>
      <button class="small-btn" onclick="selectTimetable(null,false)">ไม่เลือกเลย</button></span></div>
    <div class="import-list">${keys.map(k => {
      const idx = groups[k], on = idx.filter(i => ttRows[i].selected).length;
      return `<details class="tt-group">
        <summary class="import-item">
          <input type="checkbox" ${on === idx.length ? 'checked' : ''} onclick="event.stopPropagation()" onchange="selectTimetable('${esc(k)}',this.checked)">
          <span class="ii-main"><b>ชั้น ${esc(k)}</b> <small>${on}/${idx.length} วิชา • กดเพื่อดูรายวิชา</small></span>
          <span class="ii-count">${idx.length} วิชา</span>
        </summary>
        ${idx.map(i => { const r = ttRows[i]; return `
          <label class="tt-sub">
            <input type="checkbox" ${r.selected ? 'checked' : ''} onchange="ttRows[${i}].selected=this.checked;renderTimetablePreview()">
            <span class="ii-main">${esc(r.code)} ${esc(r.name)} <small>${r.credit} นก.${r.note ? ' • ' + esc(r.note) : ''}</small>
              <small>${r.teacherNames.length ? r.teacherNames.map((n, j) => r.emailsAll[j] ? `<span class="tt-ok">👤 ${esc(teacherName(r.emailsAll[j]))}</span>` : `👤 ${esc(n)} <span class="ii-note" style="display:inline">(ยังไม่มีอีเมล)</span>`).join(' • ') : '<span class="ii-note" style="display:inline">⚠️ ไม่ระบุครู</span>'}</small></span>
            ${r.exists ? '<span class="tt-tag">มีแล้ว</span>' : ''}
          </label>`; }).join('')}
      </details>`; }).join('')}</div>
    <p class="import-sum">จะสร้างวิชาใหม่ <b>${nNew}</b> วิชา${nOld ? ` • มีอยู่แล้ว ${nOld} วิชา` : ''} เข้าภาคเรียน <b>${esc(v('ttTarget'))}</b>

      ${unmatched.length ? `<br><small style="color:var(--ink-soft)">ครูตามตารางสอนที่ยังไม่มีอีเมลในระบบ ${unmatched.length} คน — ระบบจะจำชื่อไว้ เมื่อเพิ่มอีเมลที่ "บุคลากร / ภาระงาน → เพิ่มครูจากตารางสอน" วิชาจะผูกกับครูให้อัตโนมัติ</small>` : ''}</p>`;
  document.getElementById('ttGoBtn').disabled = sel.length === 0;
  // คงสถานะการกางรายการไว้
  (window.__ttOpen || []).forEach(k => { const d = [...box.querySelectorAll('details')].find(x => x.querySelector('b').textContent === 'ชั้น ' + k); if (d) d.open = true; });
  box.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => {
    window.__ttOpen = [...box.querySelectorAll('details[open] summary b')].map(b => b.textContent.replace('ชั้น ', ''));
  }));
}
function selectTimetable(key, on){
  ttRows.forEach(r => { if (!key || r.label === key) r.selected = on; });
  renderTimetablePreview();
}

async function processSubjectImport(){
  const rows = ttRows.filter(r => r.selected);
  if (!rows.length) return toast('กรุณาเลือกอย่างน้อย 1 วิชา', 'error');
  const update = document.getElementById('tt_update').checked;
  const nNew = rows.filter(r => !r.exists).length;
  if (!confirm(`ยืนยันนำเข้ารายวิชา ${rows.length} รายการ (ใหม่ ${nNew}) เข้าภาคเรียน ${v('ttTarget')}?`)) return;
  try {
    const tg = ttTargetTerm();
    const res = await gas('importSubjects', rows.map(r => ({ subject_code: r.code, subject_name: r.name, level: r.level, room: r.room, rooms: r.rooms, schedule: r.schedule, credit: r.credit, planned_teachers: r.teacherNames, teachers: r.emails, teacher_names: Object.fromEntries(r.emails.map(e => [e, teacherName(e)])) })),
      { semester: tg.sem, academicYear: tg.yr, update });
    state.registeredTerms = res.registeredTerms || state.registeredTerms;
    closeModal();
    if (tg.sem !== String(state.currentSemester) || tg.yr !== String(state.currentYear)) {
      fillTermSelects();
      if (confirm(`นำเข้าวิชาไปที่ภาคเรียน ${tg.sem}/${tg.yr} แล้ว\nต้องการสลับไปดูภาคเรียน ${tg.sem}/${tg.yr} เลยไหม?`)) await changeActiveTerm(`${tg.sem}/${tg.yr}`);
    } else {
      state.subjects = res.subjects;
      fillTermSelects(); fillSubjectSelects(); renderSubjects(); renderDashboardStats();
    }
    toast(`สร้างวิชาใหม่ ${res.created} วิชา` + (res.updated ? ` • อัปเดต ${res.updated} วิชา` : '') + (res.merged ? ` • รวมห้อง ${res.merged} วิชา` : '') + (res.skipped ? ` • ข้าม ${res.skipped} วิชา` : ''));
  } catch (e) {}
}

/* ===================== รวม / แยกห้อง (วิชาเรียนรวม) ===================== */
function openCombineModal(){
  if (!isAdminUI()) return;
  const act = state.subjects.filter(s => s.status !== 'INACTIVE' && String(s.semester) === String(state.currentSemester) && String(s.academic_year) === String(state.currentYear));
  const groups = {};
  act.forEach(s => { const k = [s.subject_code, s.subject_name, s.level].join('|'); (groups[k] = groups[k] || []).push(s); });
  const cand = Object.values(groups).filter(g => g.length > 1);
  const combined = act.filter(isCombined);
  const tn = s => (s.teachers || []).map(teacherName).join(', ') || (s.planned_teacher ? s.planned_teacher + ' (ตามตาราง)' : '-');
  document.getElementById('modalTitle').textContent = 'รวม / แยกห้อง (วิชาเรียนรวม)';
  document.getElementById('modalBody').innerHTML = `
    <div class="info-box">รวมวิชารหัสเดียวกันของหลายห้องเป็นวิชาเดียว — เช็คชื่อและกรอกคะแนนนักเรียนทุกห้องในหน้าเดียว
      ข้อมูลเดิม (คะแนน เช็คชื่อ ส่งงาน) ของทุกห้องจะย้ายมารวมกัน องค์ประกอบคะแนนชื่อเดียวกันจะรวมเป็นช่องเดียว</div>
    <h4 class="am-h">วิชาที่รวมได้ (${cand.length})</h4>
    <div class="am-list">${cand.length ? cand.map(g => `<div class="ua-row">
      <span><b>${esc(g[0].subject_code || '')} ${esc(g[0].subject_name)}</b> <small style="color:var(--ink-soft)">${g.map(s => `${esc(subjRoomLabel(s))} — ${esc(tn(s))}`).join(' • ')}</small></span>
      <button class="primary small-btn" onclick='doMerge(${JSON.stringify(g.map(s => s.subject_id))})'>🔗 รวม ${esc(g[0].level)}/${[...new Set(g.flatMap(subjRoomsUI))].sort().join('+')}</button></div>`).join('')
      : '<div class="empty">ไม่มีวิชารหัสเดียวกันที่แยกห้องอยู่</div>'}</div>
    <h4 class="am-h" style="margin-top:14px">วิชาที่เรียนรวมอยู่ (${combined.length})</h4>
    <div class="am-list">${combined.length ? combined.map(s => `<div class="ua-row">
      <span><b>${esc(s.subject_code || '')} ${esc(s.subject_name)}</b> <small style="color:var(--ink-soft)">${esc(subjRoomLabel(s))} — ${esc(tn(s))}</small></span>
      <span>${subjRoomsUI(s).map(r => `<button class="secondary small-btn" onclick="doSplit('${esc(s.subject_id)}','${esc(r)}')">แยก ${esc(s.level)}/${esc(r)} ออก</button>`).join(' ')}</span></div>`).join('')
      : '<div class="empty">ยังไม่มีวิชาเรียนรวม</div>'}</div>
    <div class="modal-actions"><button class="primary" onclick="closeModal()">ปิด</button></div>`;
  openModal();
}
async function doMerge(ids){
  const subs = ids.map(id => state.subjects.find(s => s.subject_id === id)).filter(Boolean);
  if (!confirm(`รวม ${subs[0].subject_name} ห้อง ${subs.map(subjRoomLabel).join(', ')} เป็นวิชาเดียว?\nคะแนน เช็คชื่อ และส่งงานเดิมของทุกห้องจะย้ายมารวมกัน`)) return;
  const res = await gas('mergeSubjects', ids);
  state.subjects = res.subjects; fillSubjectSelects(); renderSubjects(); syncSubject(res.subject_id);
  toast('รวมห้องเรียบร้อย'); openCombineModal();
}
async function doSplit(id, room){
  const s = state.subjects.find(x => x.subject_id === id);
  if (!confirm(`แยกห้อง ${s.level}/${room} ออกจาก ${s.subject_name}?\nคะแนน เช็คชื่อ และส่งงานของนักเรียนห้องนี้จะย้ายไปอยู่วิชาใหม่ของห้อง ${s.level}/${room}`)) return;
  const res = await gas('splitSubject', id, room);
  state.subjects = res.subjects; fillSubjectSelects(); renderSubjects();
  toast(`แยกห้อง ${s.level}/${room} แล้ว`); openCombineModal();
}

async function removeSubject(id){
  if(!confirm('ยืนยันการลบรายวิชา?')) return;
  state.subjects = await gas('deleteSubject', id, state.currentSemester, state.currentYear);
  fillTermSelects(); fillSubjectSelects(); renderSubjects(); toast('ลบแล้ว'); renderDashboardStats();
}

async function openItemModal(){
  const subjectId = document.getElementById('subjectSelectTop').value;
  if(!subjectId) return toast('กรุณาเลือกรายวิชาที่แถบด้านบนก่อนทำการเพิ่มองค์ประกอบ','error');

  const active = state.subjects.filter(s=>s.status!=='INACTIVE');
  const currentSubject = active.find(s=>String(s.subject_id) === String(subjectId));
  
  const cat=categories();
  document.getElementById('modalTitle').textContent='เพิ่มองค์ประกอบคะแนน';

  const existingItems = await gas('getScoreItems', subjectId);
  const usedSeqs = existingItems.map(i => Number(i.sequence));
  
  let seqOptions = '';
  let firstAvail = null;
  for(let i=1; i<=30; i++) {
    const isUsed = usedSeqs.includes(i);
    if (!isUsed && firstAvail === null) firstAvail = i;
    seqOptions += `<option value="${i}" ${isUsed ? 'disabled' : ''}>ลำดับที่ ${i}${isUsed ? ' (มีแล้ว)' : ''}</option>`;
  }
  
  if (firstAvail) {
    seqOptions = seqOptions.replace(`value="${firstAvail}"`, `value="${firstAvail}" selected`);
  }

  document.getElementById('modalBody').innerHTML=`
  <input type="hidden" id="m_item_subject" value="${esc(subjectId)}">
  <div class="form-row" style="margin-bottom: 15px;">
    <label>รายวิชาที่กำลังจัดการ</label>
    <input type="text" value="${esc(currentSubject?.subject_code||'')} ${esc(currentSubject?.subject_name||'')}" disabled style="background:#f3f4f6;">
  </div>
  <div class="form-row" style="margin-bottom: 15px; background: #eef2ff; padding: 10px; border-radius: 8px;">
    <small style="color:var(--primary); font-weight:600;">⚠️ ข้อจำกัด: คะแนนเต็มรวมของรายวิชา (ไม่รวมคะแนนแก้ตัว) ต้องไม่เกิน 100 คะแนน</small>
  </div>
  <div class="form-grid">
    <div class="form-row"><label>ชื่อองค์ประกอบ *</label><input id="m_item_name" placeholder="เช่น ครั้งที่ 1 / คะแนนส่งงาน"></div>
    <div class="form-row"><label>หมวดคะแนน</label><select id="m_item_cat" onchange="onItemCategoryChange(this.value)">
      <option value="${esc(cat.classwork)}">${esc(cat.classwork)}</option>
      <option value="${esc(cat.tasks)}">📑 ${esc(cat.tasks)} (ดึงจากเช็คงานอัตโนมัติ)</option>
      <option value="${esc(cat.attendance)}">🗓️ ${esc(cat.attendance)} (ดึงจากเช็คชื่ออัตโนมัติ)</option>
      <option value="${esc(cat.midterm)}">${esc(cat.midterm)}</option>
      <option value="${esc(cat.final)}">${esc(cat.final)}</option>
    </select></div>
    <div class="form-row"><label>คะแนนเต็ม</label><input id="m_item_max" type="number" value="10"></div>
    <div class="form-row"><label>ลำดับ (ห้ามซ้ำกัน)</label><select id="m_item_seq">${seqOptions}</select></div>
  </div>
  <div class="form-row" id="m_item_retake_wrap"><label><input type="checkbox" id="m_item_retake" style="width:auto"> เป็นคะแนนแก้ตัว (จะแทนที่คะแนนเดิมในหมวดเดียวกัน)</label></div>
  <div class="modal-actions"><button class="secondary" onclick="closeModal()">ยกเลิก</button><button class="primary" onclick="saveItemForm()">บันทึก</button></div>`;
  
  openModal();
}

function onItemCategoryChange(val) {
  const cat = categories();
  const nameInput = document.getElementById('m_item_name');
  const retakeWrap = document.getElementById('m_item_retake_wrap');
  if (val === cat.attendance) {
    if (nameInput && (!nameInput.value || nameInput.value === 'คะแนนส่งงาน')) nameInput.value = 'คะแนนเข้าเรียน';
    if (retakeWrap) retakeWrap.style.display = 'none';
  } else if (val === cat.tasks) {
    if (nameInput && (!nameInput.value || nameInput.value === 'คะแนนเข้าเรียน')) nameInput.value = 'คะแนนส่งงาน';
    if (retakeWrap) retakeWrap.style.display = 'none';
  } else {
    if (retakeWrap) retakeWrap.style.display = 'block';
  }
}

async function saveItemForm(){
  const subjectId = v('m_item_subject');
  const itemName = v('m_item_name');
  if(!itemName) return toast('กรุณากรอกชื่อองค์ประกอบ', 'error');
  
  try {
    await gas('saveScoreItem',{
      subject_id: subjectId,
      item_name: itemName,
      category: v('m_item_cat'),
      max_score: v('m_item_max'),
      sequence: v('m_item_seq'),
      is_retake: document.getElementById('m_item_retake').checked
    });
    
    closeModal();
    await renderItems();
    toast('เพิ่มองค์ประกอบคะแนนเรียบร้อย');
  } catch (err) {}
}

function openCopyItemsModal() {
  const subjectId = document.getElementById('subjectSelectTop').value;
  if(!subjectId) return toast('กรุณาเลือกรายวิชาปลายทางที่แถบด้านบนก่อน', 'error');

  const activeSubjects = state.subjects.filter(s => s.status !== 'INACTIVE');
  const currentSubject = activeSubjects.find(s => String(s.subject_id) === String(subjectId));
  
  let options = '<option value="">-- เลือกวิชาต้นทาง --</option>';
  activeSubjects.forEach(s => {
    if(String(s.subject_id) !== String(subjectId)) {
      const code = esc(s.subject_code || '-');
      const name = esc(s.subject_name);
      const levelRoom = esc(subjRoomLabel(s));
      const term = `${esc(s.semester || state.currentSemester)}/${esc(s.academic_year || state.currentYear)}`;
      options += `<option value="${esc(s.subject_id)}">${code} ${name} (${levelRoom}) [เทอม ${term}]</option>`;
    }
  });

  document.getElementById('modalTitle').textContent = 'คัดลอกองค์ประกอบคะแนน';
  document.getElementById('modalBody').innerHTML = `
    <div class="form-row" style="margin-bottom: 15px;">
      <label>นำเข้าสู่วิชาปัจจุบัน</label>
      <input type="text" value="${esc(currentSubject?.subject_code||'')} ${esc(currentSubject?.subject_name||'')}" disabled style="background:#f3f4f6;">
    </div>
    <div class="form-row">
      <label>เลือกวิชาต้นทางเพื่อคัดลอก (เฉพาะวิชาในปัจจุบัน)</label>
      <select id="m_copy_source">${options}</select>
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" onclick="processCopyItems()">คัดลอก</button>
    </div>
  `;
  openModal();
}

async function processCopyItems() {
  const targetId = document.getElementById('subjectSelectTop').value;
  const sourceId = v('m_copy_source');
  if(!sourceId) return toast('กรุณาเลือกวิชาต้นทาง', 'error');
  
  try {
    await gas('copyScoreItems', sourceId, targetId);
    closeModal();
    renderItems();
    toast('คัดลอกองค์ประกอบคะแนนเรียบร้อย');
  } catch(err) {}
}

async function removeItem(id){
  if(!confirm('ยืนยันลบองค์ประกอบคะแนนนี้?'))return;
  await gas('deleteScoreItem',id, document.getElementById('subjectSelectTop').value);
  await renderItems();
  toast('ลบเรียบร้อยแล้ว');
}

function fillReportStudents(){
  const el=document.getElementById('reportStudent');
  el.innerHTML='<option value="">-- เลือกนักเรียน --</option>'+state.students.filter(s=>s.status!=='INACTIVE').map(s=>`<option value="${esc(s.student_id)}">${esc(s.student_id)} ${esc(s.first_name)} ${esc(s.last_name)}</option>`).join('');
}

function statusLabel_(status){
  return status==='I' ? 'ร' : status==='W' ? 'มส' : status==='ZERO' ? 'ทุจริต' : '';
}

async function loadReport(){
  const id=v('reportStudent');
  const printWrap=document.getElementById('reportPrintWrap');
  if(!id){document.getElementById('reportBox').innerHTML='';if(printWrap)printWrap.style.display='none';return}
  const report=await gas('getStudentFullReport', id, state.currentSemester, state.currentYear);
  const rows=report.rows;
  const s=report.student;
  lastReport={student:s, rows, gpa:report.gpa};

  document.getElementById('reportBox').innerHTML=`<div class="report-grid"><div class="report-stat"><small>นักเรียน</small><b>${esc(s?.first_name||'')} ${esc(s?.last_name||'')}</b></div><div class="report-stat"><small>รายวิชา</small><b>${rows.length}</b></div><div class="report-stat"><small>GPA</small><b>${Number(report.gpa).toFixed(2)}</b></div><div class="report-stat"><small>รหัส</small><b>${esc(id)}</b></div></div>
  <div class="table-wrap"><table><thead><tr><th>รายวิชา</th><th>คะแนนเก็บ</th><th>กลางภาค</th><th>ปลายภาค</th><th>รวม</th><th>เกรด</th><th>สถานะ</th></tr></thead><tbody>${rows.map(r=>{
    const cat=categories(); const b=r.breakdown||{};
    const cw=b[cat.classwork]?.pct??0, mt=b[cat.midterm]?.pct??0, fn=b[cat.final]?.pct??0;
    const normal=r.status==='NORMAL';
    return `<tr><td>${esc(r.subject_name)}</td><td>${cw.toFixed(1)}%</td><td>${mt.toFixed(1)}%</td><td>${fn.toFixed(1)}%</td><td>${normal?Number(r.total).toFixed(2).replace('.00',''):'-'}</td><td><span class="grade${normal?'':' special'}">${esc(r.grade)}</span></td><td>${esc(statusLabel_(r.status))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  if(printWrap) printWrap.style.display='block';
}

function printStudentReport(){
  if(!lastReport)return;
  const box=document.getElementById('reportBox');
  const name=`${lastReport.student?.first_name||''} ${lastReport.student?.last_name||''}`.trim()||'รายงานผล';
  const w=window.open('','_blank'); if(!w)return;
  w.document.write(`<html><head><title>${esc(name)}</title></head><body style="font-family:'TH Sarabun New', 'TH Sarabun PSK', sans-serif;font-size:14px;padding:30px"><h1>รายงานผลการเรียน: ${esc(name)}</h1>${box.innerHTML}</body></html>`);
  w.document.close(); w.print();
}

async function openScoreConfigModal(){
 const subjectId=document.getElementById('subjectSelectTop').value;if(!subjectId)return toast('กรุณาเลือกวิชา','error');
 const cfg=await gas('getScoreConfig',subjectId),s=state.subjects.find(x=>String(x.subject_id)===String(subjectId));
 document.getElementById('modalTitle').textContent='ตั้งค่าสัดส่วนคะแนน';
 document.getElementById('modalBody').innerHTML=`<p style="color:var(--muted)">${esc(s?.subject_name||'')}</p><div class="form-grid"><div class="form-row"><label>หน่วยกิต</label><input id="cfg_credit" type="number" min="0" step="0.5" value="${cfg.credit}"></div><div class="form-row"><label>คะแนนเก็บ (%)</label><input id="cfg_classwork" type="number" value="${cfg.classwork_weight}"></div><div class="form-row"><label>กลางภาค (%)</label><input id="cfg_midterm" type="number" value="${cfg.midterm_weight}"></div><div class="form-row"><label>ปลายภาค (%)</label><input id="cfg_final" type="number" value="${cfg.final_weight}"></div></div><p id="cfg_sum">รวม 100%</p><div class="modal-actions"><button class="secondary" onclick="closeModal()">ยกเลิก</button><button class="primary" onclick="saveScoreConfigForm()">บันทึก</button></div>`;
 ['cfg_classwork','cfg_midterm','cfg_final'].forEach(id=>document.getElementById(id).addEventListener('input',updateCfgSum));openModal();updateCfgSum();
}
function updateCfgSum(){const sum=Number(v('cfg_classwork'))+Number(v('cfg_midterm'))+Number(v('cfg_final'));const e=document.getElementById('cfg_sum');if(e){e.textContent=`รวม ${sum}%`;e.style.color=sum===100?'#059669':'#dc2626'}}
async function saveScoreConfigForm(){
  const subjectId=document.getElementById('subjectSelectTop').value;
  const sum=Number(v('cfg_classwork'))+Number(v('cfg_midterm'))+Number(v('cfg_final'));
  if(sum!==100)return toast('สัดส่วนคะแนนต้องรวม 100%','error');
  await gas('saveScoreConfig',{subject_id:subjectId,credit:v('cfg_credit'),classwork_weight:v('cfg_classwork'),midterm_weight:v('cfg_midterm'),final_weight:v('cfg_final')});
  closeModal();toast('บันทึกสัดส่วนคะแนนแล้ว');
  scoreData=await gas('getScoreEntryData', subjectId); renderScoreTable();
}
async function loadClassReport(){
  const subjectId=document.getElementById('subjectSelectTop').value;if(!subjectId)return toast('กรุณาเลือกวิชา','error');
  const r=await gas('getFullClassReport',subjectId),total=r.students||0;
  const order=['4','3.5','3','2.5','2','1.5','1','0','ร','มส','-'];
  const entries=order.filter(g=>r.gradeCounts[g]!==undefined).map(g=>[g,r.gradeCounts[g]]);
  document.getElementById('classReportBox').innerHTML=`<div class="report-grid"><div class="report-stat"><small>นักเรียน</small><b>${total}</b></div><div class="report-stat"><small>คะแนนเฉลี่ย (เฉพาะสถานะปกติ)</small><b>${Number(r.average).toFixed(2)}</b></div><div class="report-stat"><small>มีเกรด</small><b>${r.graded}</b></div><div class="report-stat"><small>คะแนนเต็ม</small><b>100</b></div></div><div class="grade-bars">${entries.map(([g,n])=>{const pct=total?Math.round(n*100/total):0;return `<div class="grade-bar"><b>${g==='-'?'ไม่มีเกรด':(g==='ร'||g==='มส')?g:'เกรด '+g}</b><div class="bar"><i style="width:${pct}%"></i></div><span>${n} (${pct}%)</span></div>`}).join('')}</div><div class="report-actions"><button class="secondary" onclick="printClassReport()">🖨️ พิมพ์</button></div>`;
}
function printClassReport(){const box=document.getElementById('classReportBox'),title=document.getElementById('subjectSelectTop').selectedOptions[0]?.textContent||'รายงาน';const w=window.open('','_blank');if(!w)return;w.document.write(`<html><head><title>${title}</title></head><body style="font-family:'TH Sarabun New', 'TH Sarabun PSK', sans-serif;font-size:14px;padding:30px"><h1>${title}</h1>${box.innerHTML}</body></html>`);w.document.close();w.print()}

function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
    if(c==='"'&&quoted&&n==='"'){field+='"';i++}
    else if(c==='"'){quoted=!quoted}
    else if(c===','&&!quoted){row.push(field);field=''}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field=''}
    else field+=c;
  }
  if(field!==''||row.length){row.push(field);rows.push(row)}
  return rows;
}

/* ===================== นำเข้ารายชื่อนักเรียน (CSV จาก SchoolMIS / ไฟล์ใบรายชื่อ .xlsx / CSV แบบเดิม) ===================== */
let importGroups = [];   // [{key, level, room, source, students:[...], selected, note}]

function openImportModal() {
  if (!isAdminUI()) return toast('การนำเข้ารายชื่อทำได้เฉพาะผู้ดูแลระบบ', 'error');
  importGroups = [];
  document.getElementById('modalTitle').textContent = `นำเข้ารายชื่อนักเรียน • ภาคเรียน ${state.currentSemester}/${state.currentYear}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="info-box">รองรับ 3 แบบ: <b>CSV รายชื่อจาก SchoolMIS</b> (มีคอลัมน์ ระดับชั้น/ห้อง) •
      <b>ไฟล์ใบรายชื่อ .xlsx</b> (1 แผ่นงานต่อห้อง) • <b>CSV แบบเดิม</b> (รหัสนักเรียน, ชื่อ, นามสกุล — ต้องระบุชั้น/ห้องเอง)<br>
      ระบบอ่านเฉพาะ เลขประจำตัว คำนำหน้า ชื่อ สกุล ชั้น ห้อง — เลขประชาชนและข้อมูลอื่น (วันเกิด ที่อยู่ ฯลฯ) จะไม่ถูกนำเข้า</div>
    <div class="form-row"><label>เลือกไฟล์ (.csv หรือ .xlsx)</label><input type="file" id="stuFile" accept=".csv,.xlsx,text/csv" onchange="readStudentFile()"></div>
    <div id="importFallback" class="form-grid" style="display:none">
      <div class="form-row"><label>ระดับชั้น (เช่น ม.5)</label><input id="import_level" value="ม.5" oninput="readStudentFile()"></div>
      <div class="form-row"><label>ห้อง (เช่น 2)</label><input id="import_room" value="1" oninput="readStudentFile()"></div>
    </div>
    <div id="importPreview"></div>
    <div class="import-opts">
      <label><input type="checkbox" id="imp_replace"> แทนที่รายชื่อเดิมของห้องที่เลือก (นักเรียนที่ไม่มีในไฟล์จะถูกปิดใช้งานในภาคเรียนนี้)</label>
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" id="importGoBtn" onclick="processImportStudents()" disabled>นำเข้า</button>
    </div>`;
  openModal();
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
function thaiToArabic(s){ return String(s ?? '').replace(/[๐-๙]/g, d => String(THAI_DIGITS.indexOf(d))); }
function cleanCell(v){ return thaiToArabic(String(v ?? '')).replace(/\s+/g, ' ').trim(); }

// "มัธยมศึกษาปีที่ 4/1" "ประถมศึกษาปีที่ 1" "อนุบาลปีที่ 2" "ม.4.1" "ม1.2" "ป.6" → {level, room}
function parseClassText(text){
  const t = cleanCell(text);
  let m = t.match(/(มัธยมศึกษาปีที่|ประถมศึกษาปีที่|อนุบาลปีที่)\s*(\d+)\s*(?:\/\s*(\d+))?/);
  if (m) return { level: ({'มัธยมศึกษาปีที่':'ม.','ประถมศึกษาปีที่':'ป.','อนุบาลปีที่':'อ.'})[m[1]] + m[2], room: m[3] || '1' };
  m = t.match(/^(ม|ป|อ)\.?\s*(\d+)(?:\s*[.\/]\s*(\d+))?\s*$/);
  if (m) return { level: `${m[1]}.${m[2]}`, room: m[3] || '1' };
  return null;
}

function findHeader(rows, need){
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = (rows[i] || []).map(cleanCell);
    if (need.every(n => h.some(x => n.test(x)))) return i;
  }
  return -1;
}
function colIdx(h, re){ return h.findIndex(x => re.test(x)); }

function rowsToStudents(rows, hdrIdx){
  const h = rows[hdrIdx].map(cleanCell);
  const c = {
    sid: colIdx(h, /^(เลขประจำตัว(นักเรียน)?|รหัสนักเรียน)$/),
    pre: colIdx(h, /^(คำนำหน้า|คำหน้าชื่อ)/),
    fn:  colIdx(h, /^ชื่อ$/),
    ln:  colIdx(h, /^(สกุล|นามสกุล)$/),
    lv:  colIdx(h, /^ระดับชั้น$/),
    rm:  colIdx(h, /^ห้อง$/)
  };
  const out = [];
  rows.slice(hdrIdx + 1).forEach(r => {
    const sid = cleanCell(r[c.sid]);
    if (!/^\d{1,10}$/.test(sid)) return;
    const fn = cleanCell(r[c.fn]); if (!fn) return;
    out.push({
      student_id: sid, prefix: c.pre >= 0 ? cleanCell(r[c.pre]) : '', first_name: fn, last_name: c.ln >= 0 ? cleanCell(r[c.ln]) : '',
      level: c.lv >= 0 ? cleanCell(r[c.lv]) : '', room: c.rm >= 0 ? cleanCell(r[c.rm]) : ''
    });
  });
  return out;
}

function groupBy(students, source){
  const g = {};
  students.forEach(s => {
    const lv = parseClassText(s.level) || { level: s.level, room: s.room || '1' };
    const level = lv.level, room = s.room || lv.room || '1';
    const key = `${level}|${room}`;
    (g[key] = g[key] || { key, level, room, source, students: [] }).students.push(s);
  });
  return Object.values(g);
}

async function readStudentFile(){
  const f = document.getElementById('stuFile').files[0];
  if (!f) return;
  const fb = document.getElementById('importFallback');
  fb.style.display = 'none';
  importGroups = [];
  try {
    showLoading(true);
    if (/\.xlsx$/i.test(f.name)) {
      await loadXlsxLib();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      wb.SheetNames.forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        const hi = findHeader(rows, [/^(เลขประจำตัว|รหัสนักเรียน)$/, /^ชื่อ$/]);
        if (hi < 0) return;
        const students = rowsToStudents(rows, hi);
        if (!students.length) return;
        if (students.some(s => s.level)) { groupBy(students, `แผ่นงาน ${name}`).forEach(g => importGroups.push(g)); return; }
        // ใบรายชื่อ: ชั้น/ห้องอยู่ในหัวกระดาษ หรือชื่อแผ่นงาน
        let cls = null;
        for (let i = 0; i < hi && !cls; i++) cls = parseClassText((rows[i] || []).join(' '));
        const fromName = parseClassText(name);
        if (!cls) cls = fromName;
        const dup = /\(\d+\)\s*$/.test(name);
        importGroups.push({ key: `${name}`, level: cls ? cls.level : '', room: cls ? cls.room : '', source: `แผ่นงาน ${name}`, students,
          manual: !cls, note: !cls ? 'ไม่พบชั้น/ห้องในแผ่นงานนี้ — ระบุเองได้' : (dup ? 'ชื่อแผ่นงานมี (2) — อาจเป็นฉบับเก่า/สำเนา' : '') });
      });
    } else {
      const text = await f.text();
      const rows = parseCSV(text.replace(/^﻿/, ''));
      const hi = findHeader(rows, [/^(เลขประจำตัว(นักเรียน)?|รหัสนักเรียน)$/, /^ชื่อ$/]);
      if (hi < 0) throw new Error('ไม่พบหัวคอลัมน์ เลขประจำตัว/รหัสนักเรียน และ ชื่อ');
      const students = rowsToStudents(rows, hi);
      if (students.some(s => s.level)) importGroups = groupBy(students, 'CSV');
      else {
        fb.style.display = '';
        const level = cleanCell(v('import_level')), room = cleanCell(v('import_room'));
        importGroups = [{ key: `${level}|${room}`, level, room, source: 'CSV แบบเดิม', students }];
      }
    }
    // เลือกไว้ก่อน: ห้องที่ทราบชั้น และไม่ใช่แผ่นงานสำเนา
    importGroups.sort((a, b) => (a.level + '/' + a.room).localeCompare(b.level + '/' + b.room, 'th', { numeric: true }));
    importGroups.forEach(g => g.selected = !!g.level && !(g.note || '').includes('(2)'));
    renderImportPreview();
  } catch (e) {
    document.getElementById('importPreview').innerHTML = `<div class="empty">อ่านไฟล์ไม่สำเร็จ: ${esc(e.message || e)}</div>`;
  } finally { showLoading(false); }
}

function renderImportPreview(){
  const box = document.getElementById('importPreview');
  if (!importGroups.length) { box.innerHTML = '<div class="empty">ไม่พบรายชื่อนักเรียนในไฟล์</div>'; document.getElementById('importGoBtn').disabled = true; return; }
  const dupIds = {};
  importGroups.filter(g => g.selected).forEach(g => g.students.forEach(s => { dupIds[s.student_id] = (dupIds[s.student_id] || 0) + 1; }));
  const dups = Object.values(dupIds).filter(n => n > 1).length;
  const total = importGroups.filter(g => g.selected).reduce((a, g) => a + g.students.length, 0);
  box.innerHTML = `
    <div class="import-head">
      <b>พบ ${importGroups.length} กลุ่ม</b>
      <span><button class="small-btn" onclick="selectImportGroups(true)">เลือกทั้งหมด</button>
      <button class="small-btn" onclick="selectImportGroups(false)">ไม่เลือกเลย</button></span>
    </div>
    <div class="import-list">${importGroups.map((g, i) => `
      <label class="import-item${g.level ? '' : ' disabled'}">
        <input type="checkbox" ${g.selected ? 'checked' : ''} ${g.level ? '' : 'disabled'} onchange="importGroups[${i}].selected=this.checked;renderImportPreview()">
        <span class="ii-main"><b>${g.level ? `ชั้น ${esc(g.level)}/${esc(g.room)}` : 'ไม่ทราบชั้น'}</b> <small>${esc(g.source)}</small>
        ${g.note ? `<small class="ii-note">⚠️ ${esc(g.note)}</small>` : ''}
        ${g.manual ? `<span class="ii-fix" onclick="event.preventDefault()">ระบุชั้น <input placeholder="ม.1" value="${esc(g.level)}" onchange="setImportClass(${i},this.value,null)"> ห้อง <input placeholder="1" value="${esc(g.room)}" onchange="setImportClass(${i},null,this.value)"></span>` : ''}</span>
        <span class="ii-count">${g.students.length} คน</span>
      </label>`).join('')}</div>
    <p class="import-sum">จะนำเข้า <b>${total}</b> คน เข้าภาคเรียน <b>${esc(state.currentSemester)}/${esc(state.currentYear)}</b>
      ${dups ? `<br><span style="color:var(--red)">⚠️ มีเลขประจำตัวซ้ำกันระหว่างห้องที่เลือก ${dups} คน (คนเดียวจะอยู่ได้ห้องเดียว — ระบบใช้ห้องที่อยู่ท้ายรายการ)</span>` : ''}</p>`;
  document.getElementById('importGoBtn').disabled = total === 0;
}
function setImportClass(i, level, room){
  const g = importGroups[i];
  if (level !== null) { const p = parseClassText(level); g.level = p ? p.level : cleanCell(level); if (p && !g.room) g.room = p.room; }
  if (room !== null) g.room = cleanCell(room) || '1';
  if (g.level && !g.room) g.room = '1';
  g.selected = !!g.level;
  renderImportPreview();
}
function selectImportGroups(on){ importGroups.forEach(g => { if (g.level) g.selected = on; }); renderImportPreview(); }

async function processImportStudents(){
  const groups = importGroups.filter(g => g.selected && g.level);
  if (!groups.length) return toast('กรุณาเลือกอย่างน้อย 1 ห้อง', 'error');
  const replace = document.getElementById('imp_replace').checked;
  const total = groups.reduce((a, g) => a + g.students.length, 0);
  if (!confirm(`ยืนยันนำเข้า ${total} คน (${groups.length} ห้อง) เข้าภาคเรียน ${state.currentSemester}/${state.currentYear}?` + (replace ? '\n\nนักเรียนเดิมในห้องที่เลือกที่ไม่มีในไฟล์จะถูกปิดใช้งาน' : ''))) return;
  try {
    const res = await gas('importStudentGroups', groups.map(g => ({ level: g.level, room: g.room, students: g.students })),
      { semester: state.currentSemester, academicYear: state.currentYear, replace });
    state.students = res.students;
    renderStudents(); fillReportStudents();
    state.summary = await API.getDashboardSummary(null, state.currentSemester, state.currentYear); renderDashboardStats();
    closeModal();
    toast(`นำเข้านักเรียน ${res.count} คน ใน ${res.rooms} ห้องแล้ว` + (res.deactivated ? ` (ปิดใช้งาน ${res.deactivated} คน)` : ''));
  } catch (e) {}
}

/* ===================== ระบบส่งออกรายชื่อนักเรียน CSV ===================== */

function openExportStudentsModal() {
  const activeStudents = state.students.filter(s => s.status !== 'INACTIVE');
  
  const roomSet = new Set();
  activeStudents.forEach(s => {
    if (s.class_level && s.room) {
      roomSet.add(`${s.class_level}/${s.room}`);
    }
  });
  const roomList = Array.from(roomSet).sort();

  let roomOptions = `<option value="ALL">-- ส่งออกทั้งหมดในเทอม ${state.currentSemester}/${state.currentYear} (${activeStudents.length} คน) --</option>`;
  roomList.forEach(r => {
    const count = activeStudents.filter(s => `${s.class_level}/${s.room}` === r).length;
    roomOptions += `<option value="${esc(r)}">เฉพาะชั้น ${esc(r)} (${count} คน)</option>`;
  });

  document.getElementById('modalTitle').textContent = `ส่งออกรายชื่อนักเรียน (CSV) ภาคเรียน ${state.currentSemester}/${state.currentYear}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="form-row">
      <label>เลือกกลุ่มนักเรียนที่ต้องการส่งออก</label>
      <select id="export_target_room">${roomOptions}</select>
    </div>
    <div class="form-row" style="background:#eef2ff; padding:10px; border-radius:8px;">
      <small style="color:var(--fb-blue); font-weight:500;">
        ℹ️ ไฟล์ CSV ที่ได้จะเข้ารหัสแบบ UTF-8 with BOM สามารถเปิดดูใน Microsoft Excel ได้โดยที่ภาษาไทยไม่เพี้ยน
      </small>
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" onclick="processExportStudentsCsv()">📥 ดาวน์โหลด CSV</button>
    </div>
  `;
  openModal();
}

function processExportStudentsCsv() {
  const selectedRoom = v('export_target_room') || 'ALL';
  let targetStudents = state.students.filter(s => s.status !== 'INACTIVE');

  if (selectedRoom !== 'ALL') {
    targetStudents = targetStudents.filter(s => `${s.class_level}/${s.room}` === selectedRoom);
  }

  if (!targetStudents.length) {
    return toast('ไม่พบข้อมูลนักเรียนสำหรับส่งออก', 'error');
  }

  const headers = ['รหัสนักเรียน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชั้น', 'ห้อง', 'ภาคเรียน', 'ปีการศึกษา', 'สถานะ'];
  const csvRows = [headers.join(',')];

  targetStudents.forEach(s => {
    const row = [
      `"${s.student_id || ''}"`,
      `"${s.prefix || ''}"`,
      `"${s.first_name || ''}"`,
      `"${s.last_name || ''}"`,
      `"${s.class_level || ''}"`,
      `"${s.room || ''}"`,
      `"${s.semester || state.currentSemester}"`,
      `"${s.academic_year || state.currentYear}"`,
      `"${s.status || 'ACTIVE'}"`
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = "\uFEFF" + csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  
  const termStr = `${state.currentSemester}_${state.currentYear}`;
  const fileName = selectedRoom === 'ALL'
    ? `รายชื่อนักเรียน_เทอม_${termStr}_${todayStr()}.csv`
    : `รายชื่อนักเรียน_ชั้น_${selectedRoom.replace('/', '_')}_เทอม_${termStr}_${todayStr()}.csv`;

  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  closeModal();
  toast(`ส่งออกรายชื่อนักเรียน ${targetStudents.length} คนเรียบร้อย`);
}

async function deleteAllStudentsPrompt() {
  if(!confirm(`ยืนยันการลบนักเรียนทั้งหมดเฉพาะในภาคเรียน ${state.currentSemester}/${state.currentYear}? (จะไม่กระทบกับเทอมอื่น)`)) return;
  state.students = await gas('deleteAllStudents', state.currentSemester, state.currentYear);
  renderStudents(); renderDashboardStats(); fillReportStudents();
  toast(`ลบนักเรียนในภาคเรียน ${state.currentSemester}/${state.currentYear} เรียบร้อยแล้ว`);
}

async function deleteStudentsByRoomPrompt() {
  const input = prompt('กรุณาระบุ "ชั้น/ห้อง" ที่ต้องการลบ (เช่น ม.5/2):');
  if(!input) return;
  const parts = input.split('/');
  if(parts.length !== 2) return toast('รูปแบบไม่ถูกต้อง กรุณาใช้รูปแบบ ชั้น/ห้อง (เช่น ม.5/2)', 'error');
  
  const lvl = parts[0].trim();
  const rm = parts[1].trim();
  if(!confirm(`ยืนยันการลบนักเรียนชั้น ${lvl} ห้อง ${rm} เฉพาะในภาคเรียน ${state.currentSemester}/${state.currentYear}?`)) return;
  
  state.students = await gas('deleteStudentsByRoom', lvl, rm, state.currentSemester, state.currentYear);
  renderStudents(); renderDashboardStats(); fillReportStudents();
  toast(`ลบนักเรียนชั้น ${lvl}/${rm} ในภาคเรียน ${state.currentSemester}/${state.currentYear} เรียบร้อยแล้ว`);
}

function exportScoresCSV() {
  if(!scoreData || !scoreData.rows || scoreData.rows.length === 0) {
    return toast('ไม่มีข้อมูลคะแนนสำหรับส่งออก', 'error');
  }

  let headers = ['รหัสนักเรียน', 'ชื่อ', 'นามสกุล'];
  scoreData.items.forEach(i => headers.push(i.item_name));
  headers.push('คะแนนรวม', 'เกรด', 'สถานะ');

  const csvRows = [headers.join(',')];
  scoreData.rows.forEach(r => {
    const rowData = [
      `"${r.student_id}"`,
      `"${r.first_name}"`,
      `"${r.last_name}"`
    ];
    scoreData.items.forEach(i => {
      const score = r.scores[i.item_id] !== undefined && r.scores[i.item_id] !== null ? r.scores[i.item_id] : '';
      rowData.push(`"${score}"`);
    });
    rowData.push(`"${r.total}"`, `"${r.grade}"`, `"${r.status}"`);
    csvRows.push(rowData.join(','));
  });

  const csvContent = "\uFEFF" + csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  
  const subjectName = scoreData.subject.subject_name || 'scores';
  link.setAttribute('download', `คะแนนวิชา_${subjectName}_เทอม_${state.currentSemester}_${state.currentYear}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openSchoolSettingsModal() {
  document.getElementById('modalTitle').textContent = 'ตั้งค่าข้อมูลโรงเรียน / สถานศึกษา';
  document.getElementById('modalBody').innerHTML = `
    <div class="form-row">
      <label>ชื่อโรงเรียน / สถานศึกษา *</label>
      <input id="m_school_name" value="${esc(state.settings.SCHOOL_NAME || '')}" placeholder="เช่น โรงเรียนโพนแพงเจียรวนนท์อุทิศ 5">
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="primary" onclick="processSaveSchoolName()">💾 บันทึกการตั้งค่า</button>
    </div>
  `;
  openModal();
}

async function processSaveSchoolName() {
  const name = v('m_school_name').trim();
  if(!name) return toast('กรุณาระบุชื่อโรงเรียน', 'error');

  try {
    state.settings = await gas('saveSchoolNameSetting', name);
    document.getElementById('schoolName').textContent = name;
    closeModal();
    toast('บันทึกชื่อโรงเรียนเรียบร้อยแล้ว');
  } catch(err) {
    toast(err.message || 'เกิดข้อผิดพลาดในการบันทึก', 'error');
  }
}

function openModal(){document.getElementById('modal').classList.remove('hidden')}
function closeModal(){document.getElementById('modal').classList.add('hidden')}
function v(id){return document.getElementById(id)?.value||''}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function maskCitizen(v){v=String(v||'');return v.length===13?v.slice(0,3)+'******'+v.slice(-4):esc(v)}
function toast(msg,type='ok'){const t=document.getElementById('toast');t.textContent=msg;t.style.background=type==='error'?'#b91c1c':'#111827';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
let loadingCount = 0, loadingTimer = null;
function showLoading(x){
  const el = document.getElementById('loading');
  loadingCount = Math.max(0, loadingCount + (x ? 1 : -1));
  if (loadingCount > 0) {
    if (!loadingTimer && el.classList.contains('hidden')) loadingTimer = setTimeout(() => { loadingTimer = null; if (loadingCount > 0) el.classList.remove('hidden'); }, 250);
  } else {
    clearTimeout(loadingTimer); loadingTimer = null; el.classList.add('hidden');
  }
}

/* =====================================================================
   หน้าแรก (Dashboard) — "วันนี้ต้องทำอะไร"
   ===================================================================== */
let dashStale = true, dashBusy = null;
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiDate(d = new Date()){ return `วัน${TH_DAYS[d.getDay()]}ที่ ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`; }
function nowHM(){ const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function subjLabel(x){ return `${x.subject_code ? x.subject_code + ' ' : ''}${x.subject_name}`; }
function roomsLabel(x){ return `${x.level}/${(x.rooms || []).join('+')}`; }

async function loadDashboard(force){
  if (!state.me) return;
  if (!force && !dashStale && document.getElementById('dashBody').dataset.ready) return;
  const token = {}; dashBusy = token; dashStale = false;
  const me = state.me || {};
  document.getElementById('dashGreet').textContent = `สวัสดี ${me.name || me.email || ''}`;
  document.getElementById('dashSub').textContent = thaiDate();
  const body = document.getElementById('dashBody');
  if (!body.dataset.ready) body.innerHTML = '<div class="dash-loading"><span class="auth-spin"></span> กำลังรวบรวมข้อมูล…</div>';
  try {
    if (isAdminUI()) {
      const d = await API.getAdminDashboard();
      if (dashBusy !== token) return;
      renderAdminDash(d);
    } else {
      const [t, h] = await Promise.all([API.getTeacherDashboard(), myHomerooms().length ? API.getHomeroomDashboard() : { rooms: [] }]);
      if (dashBusy !== token) return;
      renderTeacherDash(t, h);
    }
    body.dataset.ready = '1';
  } catch (e) {
    console.error(e);
    body.innerHTML = `<div class="empty">โหลดข้อมูลหน้าแรกไม่สำเร็จ: ${esc(friendlyError(e))}</div>`;
  }
}

// ---------- ไปยังหน้าทำงาน ----------
function goAttend(id){
  const d = document.getElementById('attDate'); if (d) d.value = todayStr();
  if (attMode !== 'subject') { attMode = 'subject'; document.querySelectorAll('.seg-btn[data-attmode]').forEach(b => b.classList.toggle('active', b.dataset.attmode === 'subject'));
    document.getElementById('attSubjectWrap').style.display = ''; document.getElementById('attHomeroomWrap').style.display = 'none'; }
  syncSubject(id); showPage('attendance');
}
async function goHomeroom(rid){
  const d = document.getElementById('attDate'); if (d) d.value = todayStr();
  showPage('attendance');
  await setAttMode('homeroom');
  const sel = document.getElementById('attHomeroom');
  if (sel && [...sel.options].some(o => o.value === rid)) { sel.value = rid; loadAttendancePage(); }
}
function goScores(id){ syncSubject(id); showPage('scores'); }
function goTasks(id){ syncSubject(id); showPage('tasks'); }

function bar(pct, cls = ''){ const p = Math.max(0, Math.min(100, Math.round(pct || 0))); return `<div class="dbar ${cls}"><i style="width:${p}%"></i></div>`; }
const GRADE_ORDER = ['4', '3.5', '3', '2.5', '2', '1.5', '1', '0', 'ร', 'มส'];
const GRADE_COLORS = { '4': '#0EA968', '3.5': '#3BBF7F', '3': '#6CCB5F', '2.5': '#A8C94A', '2': '#E0B13A', '1.5': '#F0A020', '1': '#F07A2A', '0': '#E5484D', 'ร': '#7F2BE3', 'มส': '#B4235A' };
function gradeBar(g){
  if (!g) return '<small class="dmuted">ยังไม่มีคะแนน</small>';
  const total = Object.values(g).reduce((a, b) => a + b, 0) || 1;
  const keys = Object.keys(g).sort((a, b) => (GRADE_ORDER.indexOf(a) + 99) % 99 - (GRADE_ORDER.indexOf(b) + 99) % 99);
  return `<div class="gbar">${keys.map(k => `<i title="เกรด ${esc(k)}: ${g[k]} คน" style="width:${g[k] / total * 100}%;background:${GRADE_COLORS[k] || '#9AA4B2'}"></i>`).join('')}</div>
    <div class="glegend">${keys.map(k => `<span><b style="background:${GRADE_COLORS[k] || '#9AA4B2'}"></b>${esc(k)}: ${g[k]}</span>`).join('')}</div>`;
}

// ---------- ครู / ครูประจำชั้น ----------
function renderTeacherDash(t, h){
  const body = document.getElementById('dashBody');
  const subs = t.subjects.filter(x => !x.error);
  const hasSched = subs.some(x => x.scheduled);
  const today = subs.filter(x => (x.periods || []).length).sort((a, b) => a.periods[0].period - b.periods[0].period);
  const notToday = subs.filter(x => !(x.periods || []).length);
  const pending = today.filter(x => !x.checkedToday);
  const now = nowHM();
  document.getElementById('dashSub').textContent = thaiDate() + (subs.length
    ? (today.length ? ` • วันนี้มี ${today.reduce((a, x) => a + x.periods.length, 0)} คาบ • ยังไม่เช็คชื่อ ${pending.length} วิชา` : ` • สอน ${subs.length} วิชา`)
    : '');

  if (!subs.length && !h.rooms.length) {
    body.innerHTML = `<div class="panel dash-empty"><h3>ยังไม่มีงานสอนในภาคเรียนนี้</h3><p>ผู้ดูแลระบบเป็นผู้กำหนดวิชาที่สอนและห้องประจำชั้น — แจ้งผู้ดูแลระบบได้เลย</p>
      ${isAdminRole() ? '<button class="primary" onclick="setViewMode(\'admin\')">สลับไปโหมดผู้ดูแลระบบ</button>' : ''}</div>`;
    return;
  }
  let html = '';

  // 1) คาบสอนวันนี้
  const card = x => {
    const done = x.checkedToday > 0;
    const p = x.periods || [];
    const started = p.length && p[0].start && p[0].start <= now;
    const cls = done ? 'ok' : (started ? 'bad' : 'warn');
    return `<div class="tcard ${cls}">
      <div class="tcard-top"><span class="tcard-time">${p.length ? p.map(q => `คาบ ${q.period}${q.start ? ` ${q.start}–${q.end}` : ''}`).join(' • ') : 'ไม่มีคาบวันนี้'}</span>
        <span class="tcard-state">${done ? `✅ เช็คแล้ว ${x.checkedToday}/${x.students}` : (started ? '⛔ ยังไม่เช็คชื่อ' : '⏳ ยังไม่ถึงเวลา')}</span></div>
      <b class="tcard-name">${esc(subjLabel(x))}</b>
      <small>ชั้น ${esc(roomsLabel(x))}${x.rooms.length > 1 ? ' (เรียนรวม)' : ''} • ${x.students} คน</small>
      <div class="tcard-actions"><button class="${done ? 'secondary' : 'primary'}" onclick="goAttend('${esc(x.subject_id)}')">${done ? 'แก้ไขการเช็คชื่อ' : '✔ เช็คชื่อ'}</button>
        <button class="secondary" onclick="goScores('${esc(x.subject_id)}')">กรอกคะแนน</button></div>
    </div>`;
  };
  if (subs.length) {
    html += `<div class="dsec"><div class="dsec-h"><h3>📅 คาบสอนวันนี้</h3>${hasSched ? '' : '<small class="dmuted">ยังไม่มีตารางสอนในระบบ — แสดงทุกวิชาที่สอน</small>'}</div>
      <div class="tgrid">${(hasSched ? today : subs).map(card).join('') || '<div class="empty">วันนี้ไม่มีคาบสอน 🎉</div>'}</div>
      ${hasSched && notToday.length ? `<details class="dmore"><summary>วิชาอื่นที่สอน (${notToday.length})</summary><div class="tgrid">${notToday.map(card).join('')}</div></details>` : ''}
    </div>`;
  }

  // 2) ห้องประจำชั้นวันนี้
  if (h.rooms.length) {
    const st = h.statuses || [];
    html += `<div class="dsec"><div class="dsec-h"><h3>🏫 ห้องประจำชั้นวันนี้</h3></div><div class="tgrid">${h.rooms.map(r => {
      const done = r.checked > 0;
      return `<div class="tcard ${done ? 'ok' : 'warn'}">
        <div class="tcard-top"><span class="tcard-time">เช็คชื่อตอนเช้า</span><span class="tcard-state">${done ? `✅ เช็คแล้ว ${r.checked}/${r.students}` : '⏳ ยังไม่เช็ค'}</span></div>
        <b class="tcard-name">ชั้น ${esc(r.level)}/${esc(r.room)}</b><small>${r.students} คน • เช็คไปแล้ว ${r.days} วัน</small>
        ${done ? `<div class="hchips">${st.filter(s => r.counts[s.status_id]).map(s => `<span style="--c:${esc(s.color || '#888')}">${esc(s.label)} ${r.counts[s.status_id]}</span>`).join('')}</div>` : ''}
        <div class="tcard-actions"><button class="${done ? 'secondary' : 'primary'}" onclick="goHomeroom('${esc(r.roster_id)}')">${done ? 'แก้ไข' : '✔ เช็คชื่อประจำชั้น'}</button>
          <button class="secondary" onclick="dashHomeroomGrades('${esc(r.key)}', this)">ผลการเรียนเฉลี่ย</button></div>
        <div class="hr-gpa" data-key="${esc(r.key)}"></div>
        ${r.watch.length ? `<div class="hwatch"><b>ต้องติดตาม (เช็คชื่อเช้า)</b>${r.watch.map(w => `<div>${esc(w.first_name)} ${esc(w.last_name)} <small>${w.abs ? `ขาด ${w.abs} วัน` : ''}${w.abs && w.late ? ' • ' : ''}${w.late ? `สาย ${w.late} วัน` : ''}</small></div>`).join('')}</div>` : ''}
      </div>`; }).join('')}</div></div>`;
  }

  // 3) งานค้าง
  const todo = [];
  pending.forEach(x => todo.push({ pri: 0, html: `<b>ยังไม่เช็คชื่อ</b> ${esc(subjLabel(x))} ${esc(roomsLabel(x))}`, btn: `<button class="small-btn" onclick="goAttend('${esc(x.subject_id)}')">เช็คชื่อ</button>` }));
  subs.forEach(x => (x.items || []).filter(i => i.missing > 0).forEach(i => todo.push({ pri: i.filled > 0 ? 1 : 3,
    html: `<b>${esc(i.item_name)}</b> (${esc(subjLabel(x))} ${esc(roomsLabel(x))}) — ยังไม่มีคะแนน <b>${i.missing}</b> คน`,
    btn: x.locked ? '<small class="dmuted">ล็อกคะแนนแล้ว</small>' : `<button class="small-btn" onclick="goScores('${esc(x.subject_id)}')">กรอกคะแนน</button>` })));
  subs.forEach(x => (x.taskMissing || []).forEach(tk => todo.push({ pri: 2,
    html: `<b>${esc(tk.task_name)}</b> (${esc(subjLabel(x))} ${esc(roomsLabel(x))}) — ยังไม่ส่ง <b>${tk.missing}</b> คน${tk.due_date ? ` • กำหนดส่ง ${esc(tk.due_date)}` : ''}`,
    btn: `<button class="small-btn" onclick="goTasks('${esc(x.subject_id)}')">เช็คงาน</button>` })));
  todo.sort((a, b) => a.pri - b.pri);
  if (subs.length) html += `<div class="dsec"><div class="dsec-h"><h3>📝 งานค้าง ${todo.length ? `<span class="dcount">${todo.length}</span>` : ''}</h3></div>
    ${todo.length ? `<div class="dlist">${todo.map((x, i) => `<div class="drow${i >= 8 ? ' more' : ''}"><span>${x.html}</span>${x.btn}</div>`).join('')}</div>
      ${todo.length > 8 ? `<button class="dlink" onclick="this.previousElementSibling.classList.add('all');this.remove()">แสดงทั้งหมด (${todo.length})</button>` : ''}`
      : '<div class="dok">✅ ไม่มีงานค้าง เยี่ยมมาก!</div>'}</div>`;

  // 4) นักเรียนที่ต้องติดตาม (รวมทุกวิชา)
  const watch = {};
  subs.forEach(x => (x.watch || []).forEach(w => {
    const k = w.student_id; const o = watch[k] = watch[k] || { ...w, items: [] };
    o.items.push(`${x.subject_name}: ${w.reasons.join(', ')}`);
  }));
  const wl = Object.values(watch).sort((a, b) => b.items.length - a.items.length);
  if (subs.length) html += `<div class="dsec"><div class="dsec-h"><h3>🚩 นักเรียนที่ต้องติดตาม ${wl.length ? `<span class="dcount">${wl.length}</span>` : ''}</h3><small class="dmuted">ขาด ≥ 3 ครั้ง • มาเรียน &lt; 80% • สถานะ ร/มส/0 • ค้างงานเกินครึ่ง</small></div>
    ${wl.length ? `<div class="dlist">${wl.map((w, i) => `<div class="drow${i >= 10 ? ' more' : ''}"><span><b>${esc(w.first_name)} ${esc(w.last_name)}</b> <small class="dmuted">${esc(w.student_id)}${w.room ? ` • ห้อง ${esc(w.room)}` : ''}</small><br><small>${w.items.map(esc).join(' • ')}</small></span></div>`).join('')}</div>
      ${wl.length > 10 ? `<button class="dlink" onclick="this.previousElementSibling.classList.add('all');this.remove()">แสดงทั้งหมด (${wl.length})</button>` : ''}`
      : '<div class="dok">✅ ยังไม่มีนักเรียนที่น่าเป็นห่วง</div>'}</div>`;

  // 5) สรุปรายวิชา
  if (subs.length) html += `<div class="dsec"><div class="dsec-h"><h3>📊 สรุปรายวิชา</h3></div><div class="sgrid">${subs.map(x => `
    <div class="scard"><b>${esc(subjLabel(x))}</b><small>ชั้น ${esc(roomsLabel(x))} • ${x.students} คน</small>
      <div class="srow"><span>มาเรียน</span>${bar(x.attendancePct, x.attendancePct != null && x.attendancePct < 80 ? 'red' : 'green')}<em>${x.attendancePct == null ? '-' : x.attendancePct + '%'}</em></div>
      <div class="srow"><span>กรอกคะแนน</span>${bar(x.scoreSlots ? x.scoreFilled / x.scoreSlots * 100 : 0, 'blue')}<em>${x.scoreSlots ? Math.round(x.scoreFilled / x.scoreSlots * 100) + '%' : '-'}</em></div>
      <div class="srow"><span>เช็คชื่อแล้ว</span><em style="margin-left:auto">${x.sessions} ครั้ง</em></div>
      <div class="sgrade">${!x.grades ? '<small class="dmuted">ยังไม่มีคะแนน</small>' : (x.scoreSlots && x.scoreFilled / x.scoreSlots < 0.8 ? `<small class="dmuted">กรอกคะแนนแล้ว ${Math.round(x.scoreFilled / x.scoreSlots * 100)}% — สรุปเกรดเมื่อกรอกครบ 80%</small>` : gradeBar(x.grades))}</div>
    </div>`).join('')}</div></div>`;

  body.innerHTML = html;
}

async function dashHomeroomGrades(key, btn){
  const box = btn.closest('.tcard').querySelector('.hr-gpa');
  box.innerHTML = '<small class="dmuted">กำลังคำนวณ…</small>';
  try {
    const d = await API.getHomeroomGrades(key, state.currentSemester, state.currentYear);
    const g = d.students.filter(s => s.gpa != null);
    if (!g.length) { box.innerHTML = '<small class="dmuted">ยังไม่มีเกรดในภาคเรียนนี้</small>'; return; }
    const avg = g.reduce((a, s) => a + s.gpa, 0) / g.length;
    const low = g.slice().sort((a, b) => a.gpa - b.gpa).slice(0, 5);
    box.innerHTML = `<div class="hgpa"><span>ผลการเรียนเฉลี่ยของห้อง</span><b>${avg.toFixed(2)}</b><small>(${g.length}/${d.students.length} คนที่มีเกรด • ${d.subjects.length} วิชา)</small></div>
      <div class="hwatch"><b>เกรดเฉลี่ยต่ำสุด 5 คน</b>${low.map(s => `<div>${esc(s.first_name)} ${esc(s.last_name)} <small>${s.gpa.toFixed(2)}</small></div>`).join('')}</div>
      <button class="dlink" onclick="showPage('reports');document.getElementById('hrGradeRoom').value='${esc(key)}';loadHomeroomGrades()">ดูตารางผลการเรียนทั้งห้อง →</button>`;
  } catch (e) { box.innerHTML = `<small class="dmuted">${esc(friendlyError(e))}</small>`; }
}

// ---------- ผู้ดูแลระบบ ----------
function renderAdminDash(d){
  const body = document.getElementById('dashBody');
  const c = d.counts, iss = d.issues;
  document.getElementById('dashSub').textContent = `${thaiDate()} • โหมดผู้ดูแลระบบ • ภาคเรียน ${state.currentSemester}/${state.currentYear}`;
  const pct = d.todaySubjects ? Math.round(d.todayDone / d.todaySubjects * 100) : 0;
  const hrDone = d.homeroomToday.filter(r => r.done).length;
  const issues = [
    { n: iss.noTeacher, t: 'วิชาที่ยังไม่มีครูผู้สอน', go: "showPage('users')", b: 'จัดครู' },
    { n: iss.plannedMissing.length, t: 'ครูตามตารางสอนที่ยังไม่มีอีเมล', go: "showPage('users');setTimeout(openPlannedTeachersModal,600)", b: 'เพิ่มอีเมล' },
    { n: iss.roomsNoHomeroom.length, t: `ห้องที่ยังไม่มีครูประจำชั้น${iss.roomsNoHomeroom.length ? ` (${iss.roomsNoHomeroom.slice(0, 6).map(k => k.replace('|', '/')).join(', ')}${iss.roomsNoHomeroom.length > 6 ? ' …' : ''})` : ''}`, go: "showPage('users')", b: 'กำหนด' },
    { n: iss.weightNot100, t: `วิชาที่องค์ประกอบคะแนนรวมยังไม่ครบ 100${iss.noItems ? ` (ยังไม่ได้ตั้งเลย ${iss.noItems} วิชา)` : ''}`, go: "showPage('subjects')", b: 'ดูรายวิชา' }
  ];
  const heatColor = n => n == null ? '' : n === 0 ? 'h0' : n <= 1 ? 'h1' : n <= 3 ? 'h2' : n <= 5 ? 'h3' : 'h4';
  const fmtD = s => { const [y, m, dd] = s.split('-').map(Number); return `${dd} ${TH_MONTHS[m - 1]}`; };
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>นักเรียน</span><b>${c.students}</b><small>คน</small></div>
      <div class="kpi"><span>ห้องเรียน</span><b>${c.rooms}</b><small>ห้อง</small></div>
      <div class="kpi"><span>รายวิชา</span><b>${c.subjects}</b><small>วิชา</small></div>
      <div class="kpi"><span>ครู</span><b>${c.teachers}</b><small>คน</small></div>
    </div>

    <div class="dsec"><div class="dsec-h"><h3>✅ การเช็คชื่อวันนี้</h3><small class="dmuted">${d.hasSchedule ? 'นับเฉพาะวิชาที่มีคาบวันนี้ตามตารางสอน' : 'ยังไม่มีตารางสอน — นับทุกวิชา'}</small></div>
      <div class="dprog">
        <div><span>รายวิชา</span>${bar(pct, 'green')}<em>${d.todayDone}/${d.todaySubjects} (${pct}%)</em></div>
        <div><span>ประจำชั้น</span>${bar(d.homeroomToday.length ? hrDone / d.homeroomToday.length * 100 : 0, 'blue')}<em>${hrDone}/${d.homeroomToday.length} ห้อง</em></div>
      </div>
      <div class="dlist">${d.teachers.map((t, i) => `<div class="drow${i >= 10 ? ' more' : ''}"><span><b>${esc(t.name)}</b> <small class="dmuted">เช็คแล้ว ${t.done.length}/${t.done.length + t.todo.length}</small>
        ${t.todo.length ? `<br>${t.todo.map(x => `<span class="dchip bad">${esc(x.label)}${x.periods.length ? ` • คาบ ${x.periods.join(',')}` : ''}</span>`).join('')}` : ''}</span>
        <span class="dstate ${t.todo.length ? 'bad' : 'ok'}">${t.todo.length ? `ยังไม่เช็ค ${t.todo.length}` : '✅ ครบ'}</span></div>`).join('') || '<div class="empty">วันนี้ไม่มีคาบเรียน</div>'}</div>
      ${d.teachers.length > 10 ? `<button class="dlink" onclick="this.previousElementSibling.classList.add('all');this.remove()">แสดงครูทั้งหมด (${d.teachers.length})</button>` : ''}
    </div>

    <div class="dsec"><div class="dsec-h"><h3>⚠️ ข้อมูลที่ยังไม่ครบ</h3></div>
      <div class="dlist">${issues.map(x => `<div class="drow"><span>${x.n ? `<span class="dcount">${x.n}</span>` : '✅'} ${esc(x.t)}</span>${x.n ? `<button class="small-btn" onclick="${x.go}">${x.b}</button>` : ''}</div>`).join('')}</div>
    </div>

    <div class="dsec"><div class="dsec-h"><h3>🗓️ ขาดเรียนตอนเช้า รายห้อง</h3><small class="dmuted">จำนวนนักเรียนที่ขาด จากการเช็คชื่อประจำชั้น ${d.heat.dates.length} วันล่าสุด</small></div>
      ${d.heat.dates.length ? `<div class="table-wrap heat-wrap"><table class="heat"><thead><tr><th>ห้อง</th>${d.heat.dates.map(x => `<th>${fmtD(x)}</th>`).join('')}</tr></thead>
        <tbody>${d.heat.rows.map(r => `<tr><td><b>${esc(r.key.replace('|', '/'))}</b> <small class="dmuted">${r.count}</small></td>${r.cells.map(n => `<td class="${heatColor(n)}">${n == null ? '·' : n}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="heat-legend"><span class="h0">0</span><span class="h1">1</span><span class="h2">2–3</span><span class="h3">4–5</span><span class="h4">6+</span><span>· = ยังไม่เช็ค</span></div>`
        : '<div class="empty">ยังไม่มีการเช็คชื่อประจำชั้น</div>'}
    </div>

    <div class="dsec"><div class="dsec-h"><h3>⚡ ทางลัด</h3></div>
      <div class="shortcuts">
        <button onclick="showPage('dataio')">📥 นำเข้า / ส่งออกข้อมูล</button>
        <button onclick="showPage('users')">👥 บุคลากร / ภาระงาน</button>
        <button onclick="showPage('subjects')">📚 รายวิชาทั้งหมด</button>
        <button onclick="openTermManageModal()">🔄 จัดการภาคเรียน</button>
        <button onclick="setViewMode('mine')">👩‍🏫 ดูงานสอนของฉัน</button>
      </div>
    </div>`;
}


/* ===================== พิมพ์สรุปการเช็คชื่อ ===================== */
let attPrintSheet = null;
const ATT_SYMBOL = { PRESENT: '/', ABSENT: 'ข', LEAVE: 'ล', LATE: 'ส', ACTIVITY: 'ก' };
function attSym(st){ return ATT_SYMBOL[st.status_id] || String(st.label || st.status_id).trim().charAt(0); }
function attPrintTarget(){
  if (attMode === 'homeroom') { const id = document.getElementById('attHomeroom').value; return id ? { kind: 'homeroom', id } : null; }
  const id = document.getElementById('attSubject')?.value || document.getElementById('subjectSelectTop').value;
  return id ? { kind: 'subject', id } : null;
}
async function openAttPrintModal(){
  const t = attPrintTarget();
  if (!t) return toast(attMode === 'homeroom' ? 'กรุณาเลือกห้อง' : 'กรุณาเลือกวิชา', 'error');
  try { attPrintSheet = await gas('getAttendanceSheet', t.kind, t.id); } catch (e) { return; }
  const d = attPrintSheet;
  const dates = Object.keys(d.days).filter(x => Object.keys(d.days[x] || {}).length).sort();
  if (!dates.length) return toast('ยังไม่มีข้อมูลการเช็คชื่อ', 'error');
  const months = [...new Set(dates.map(x => x.slice(0, 7)))];
  const mLabel = m => { const [y, mm] = m.split('-').map(Number); return `${TH_MONTHS[mm - 1]} ${y + 543}`; };
  document.getElementById('modalTitle').textContent = `พิมพ์สรุปการเช็คชื่อ • ${d.kind === 'homeroom' ? 'ประจำชั้น' : d.title} ${d.level}/${d.rooms.join('+')}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="form-grid">
      <div class="form-row"><label>ช่วงวันที่</label>
        <select id="ap_range" onchange="document.getElementById('ap_custom').style.display=this.value==='custom'?'':'none'">
          <option value="all">ทั้งภาคเรียน (${dates.length} วัน)</option>
          ${months.map(m => `<option value="m:${m}">เดือน ${mLabel(m)} (${dates.filter(x => x.startsWith(m)).length} วัน)</option>`).join('')}
          <option value="custom">กำหนดเอง…</option>
        </select></div>
      <div class="form-row"><label>รูปแบบ</label>
        <select id="ap_style"><option value="full">ตารางรายวัน + สรุป (A4 แนวนอน)</option><option value="summary">สรุปอย่างเดียว (A4 แนวตั้ง)</option></select></div>
    </div>
    <div id="ap_custom" class="form-grid" style="display:none">
      <div class="form-row"><label>ตั้งแต่</label><input type="date" id="ap_from" value="${dates[0]}"></div>
      <div class="form-row"><label>ถึง</label><input type="date" id="ap_to" value="${dates[dates.length - 1]}"></div>
    </div>
    <div class="import-opts">
      ${d.rooms.length > 1 ? '<label><input type="checkbox" id="ap_split" checked> แยกหน้าตามห้อง</label>' : ''}
      <label><input type="checkbox" id="ap_sign" checked> มีช่องลงชื่อท้ายเอกสาร</label>
    </div>
    <div class="info-box" style="margin-top:12px">ร้อยละการมาเรียน = จำนวนครั้งที่มาเรียน (สถานะที่ไม่ใช่ "ขาด") ÷ จำนวนครั้งที่เช็คชื่อ • ต่ำกว่า 80% ขึ้นหมายเหตุ "มส"</div>
    <div class="modal-actions"><button class="secondary" onclick="closeModal()">ยกเลิก</button><button class="primary" onclick="printAttendanceSheet()">🖨️ พิมพ์</button></div>`;
  openModal();
}

function printAttendanceSheet(){
  const d = attPrintSheet; if (!d) return;
  const range = v('ap_range'), style = v('ap_style');
  const split = document.getElementById('ap_split') ? document.getElementById('ap_split').checked : false;
  const sign = document.getElementById('ap_sign').checked;
  let dates = Object.keys(d.days).filter(x => Object.keys(d.days[x] || {}).length).sort();
  let rangeText = 'ทั้งภาคเรียน';
  const fmt = x => { const [y, m, dd] = x.split('-').map(Number); return `${dd} ${TH_MONTHS[m - 1]} ${y + 543}`; };
  if (range.startsWith('m:')) { const m = range.slice(2); dates = dates.filter(x => x.startsWith(m)); const [y, mm] = m.split('-').map(Number); rangeText = `เดือน${['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][mm - 1]} ${y + 543}`; }
  else if (range === 'custom') { const f = v('ap_from'), t = v('ap_to'); dates = dates.filter(x => (!f || x >= f) && (!t || x <= t)); rangeText = `${fmt(f)} – ${fmt(t)}`; }
  if (!dates.length) return toast('ไม่มีการเช็คชื่อในช่วงที่เลือก', 'error');

  const statuses = (d.statuses || []).filter(s => s.status !== 'INACTIVE');
  const stMap = Object.fromEntries(statuses.map(s => [String(s.status_id), s]));
  const isAbsent = id => { const s = stMap[id]; return s ? Number(s.score_value) === 0 : false; };
  const groups = split ? d.rooms.map(r => ({ rooms: [r], students: d.students.filter(s => String(s.room) === r) })) : [{ rooms: d.rooms, students: d.students }];
  const school = state.settings.SCHOOL_NAME || '';
  const term = `ภาคเรียนที่ ${d.semester} ปีการศึกษา ${d.academic_year}`;
  const who = d.kind === 'homeroom' ? 'ครูประจำชั้น' : 'ครูผู้สอน';
  const CHUNK = 24;

  const pageFor = (g, chunk, ci, nChunks) => {
    const rows = g.students.map((s, i) => {
      const counts = {}; let total = 0, present = 0;
      dates.forEach(x => { const r = (d.days[x] || {})[s.student_id]; if (r && r.status_id) { counts[r.status_id] = (counts[r.status_id] || 0) + 1; total++; if (!isAbsent(String(r.status_id))) present++; } });
      const pct = total ? present / total * 100 : null;
      const cells = style === 'full' ? chunk.map(x => { const r = (d.days[x] || {})[s.student_id]; const st = r && stMap[String(r.status_id)];
        return `<td class="c ${r && isAbsent(String(r.status_id)) ? 'ab' : ''}">${r ? esc(st ? attSym(st) : r.status_id) : ''}</td>`; }).join('') : '';
      const last = style === 'summary' || ci === nChunks - 1;
      return `<tr><td class="c">${i + 1}</td><td class="c">${esc(s.student_id)}</td><td class="nm">${esc((s.prefix || '') + s.first_name)} ${esc(s.last_name)}</td>${cells}
        ${last ? statuses.map(st => `<td class="c">${counts[st.status_id] || ''}</td>`).join('') + `<td class="c">${total}</td><td class="c"><b>${pct == null ? '-' : pct.toFixed(1)}</b></td><td class="c ab">${pct != null && pct < 80 ? 'มส' : ''}</td>` : ''}</tr>`;
    }).join('');
    const last = style === 'summary' || ci === nChunks - 1;
    const dayTotals = style === 'full' ? `<tr class="tot"><td colspan="3">มาเรียน / เช็คชื่อ</td>${chunk.map(x => { const recs = Object.entries(d.days[x] || {}).filter(([sid]) => g.students.some(s => s.student_id === sid));
      return `<td class="c">${recs.filter(([, r]) => !isAbsent(String(r.status_id))).length}<br>${recs.length}</td>`; }).join('')}${last ? `<td colspan="${statuses.length + 3}"></td>` : ''}</tr>` : '';
    return `<section class="page">
      <div class="hd"><b>${esc(school)}</b><h1>แบบสรุปการมาเรียน${d.kind === 'homeroom' ? ' (เช็คชื่อประจำชั้น)' : ''}</h1>
        <div>${d.kind === 'homeroom' ? '' : `รายวิชา <b>${esc(d.title)}</b> • `}ชั้น <b>${esc(d.level)}/${esc(g.rooms.join('+'))}</b> • ${esc(term)}</div>
        <div>${esc(who)}: ${esc(d.teachers.join(', ') || '-')} • ช่วงข้อมูล: ${esc(rangeText)} (${dates.length} วัน)${nChunks > 1 ? ` • แผ่นที่ ${ci + 1}/${nChunks}` : ''}</div></div>
      <table><thead><tr><th rowspan="2">ที่</th><th rowspan="2">เลขประจำตัว</th><th rowspan="2" class="nm">ชื่อ–สกุล</th>
        ${style === 'full' ? `<th colspan="${chunk.length}">วันที่</th>` : ''}
        ${last ? `<th colspan="${statuses.length}">สรุป (ครั้ง)</th><th rowspan="2">รวม<br>เช็ค</th><th rowspan="2">ร้อยละ<br>มาเรียน</th><th rowspan="2">หมาย<br>เหตุ</th>` : ''}</tr>
        <tr>${style === 'full' ? chunk.map(x => { const [y, m, dd] = x.split('-').map(Number); return `<th class="dt">${dd}/${m}</th>`; }).join('') : ''}
        ${last ? statuses.map(st => `<th>${esc(st.label)}</th>`).join('') : ''}</tr></thead>
        <tbody>${rows}${dayTotals}</tbody></table>
      <div class="ft">${style === 'full' ? 'สัญลักษณ์: ' + statuses.map(st => `${esc(attSym(st))} = ${esc(st.label)}`).join(' • ') + ' • ' : ''}ร้อยละมาเรียน = ครั้งที่ไม่ขาด ÷ ครั้งที่เช็คชื่อ • มส = มาเรียนไม่ถึง 80%
        • พิมพ์เมื่อ ${esc(thaiDate())}</div>
      ${sign && last ? `<div class="sign"><div>ลงชื่อ ........................................ ${esc(who)}<br>( ${esc(d.teachers[0] || '........................................')} )</div>
        <div>ลงชื่อ ........................................ ผู้ตรวจสอบ<br>( ........................................ )</div></div>` : ''}
    </section>`;
  };
  let pages = '';
  groups.forEach(g => {
    const chunks = style === 'full' ? Array.from({ length: Math.ceil(dates.length / CHUNK) }, (_, i) => dates.slice(i * CHUNK, (i + 1) * CHUNK)) : [[]];
    chunks.forEach((c, i) => { pages += pageFor(g, c, i, chunks.length); });
  });
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>สรุปการมาเรียน ${esc(d.title)} ${esc(d.level)}/${esc(d.rooms.join('+'))}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet">
    <style>
      @page { size: A4 ${style === 'full' ? 'landscape' : 'portrait'}; margin: 10mm; }
      body { font-family: 'Sarabun', 'TH Sarabun New', sans-serif; font-size: 12px; color: #111; margin: 0; }
      .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
      .hd { text-align: center; margin-bottom: 8px; line-height: 1.5; } .hd h1 { font-size: 17px; margin: 2px 0; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #555; padding: 2px 3px; } th { background: #EEF2F7; font-weight: 600; font-size: 11px; }
      ${style === 'summary' ? 'td { line-height: 1.3; padding: 1px 4px; } .hd { margin-bottom: 6px; line-height: 1.4; } .sign { margin-top: 18px; line-height: 1.8; }' : ''}
      .c { text-align: center; } .nm { text-align: left; white-space: nowrap; } .dt { font-size: 10px; padding: 2px 1px; }
      .ab { color: #C00; font-weight: 600; } .tot td { background: #F7F7F7; font-size: 10px; text-align: center; }
      tr { page-break-inside: avoid; }
      .ft { margin-top: 6px; font-size: 10.5px; color: #444; }
      .sign { display: flex; justify-content: space-around; margin-top: 26px; text-align: center; line-height: 2; }
      /* แสดงบนจอเป็นแผ่น A4 จริง (แนวนอน 297×210 / แนวตั้ง 210×297) */
      @media screen { body { background: #888; padding: 10px 0; } .page { box-sizing: border-box; background: #fff; width: ${style === 'full' ? '297mm' : '210mm'}; min-height: ${style === 'full' ? '210mm' : '297mm'}; margin: 0 auto 14px; padding: 10mm; box-shadow: 0 2px 10px rgba(0,0,0,.3); } }
      @media print { .page { width: auto; ${style === 'full' ? '' : 'max-width: 190mm; margin: 0 auto;'} } }
    </style></head><body>${pages}<script>document.fonts.ready.then(()=>setTimeout(()=>print(),300));<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาตป๊อปอัปแล้วลองอีกครั้ง', 'error');
  w.document.write(html); w.document.close(); w.focus();
  closeModal();
}
