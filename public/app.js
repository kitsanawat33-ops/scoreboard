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

function isAdminUI(){ return !!(state.me && state.me.role === 'admin'); }
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
  API.onAuth(async user => {
    if (!user) return showLogin();
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
  document.body.classList.add('logged-out');
  const box = document.getElementById('loginMsg');
  if (box) box.innerHTML = msg || '';
  const out = document.getElementById('loginSwitch');
  if (out) out.style.display = signedIn ? 'inline-flex' : 'none';
}
function hideLogin(){ document.body.classList.remove('logged-out'); }
async function doLogin(){
  try { await API.login(); } catch (e) {
    if (e && e.code === 'auth/popup-closed-by-user') return;
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
    state = await gas('getInitialData');
    state.currentSemester = String(state.settings.CURRENT_SEMESTER || '1');
    state.currentYear = String(state.settings.CURRENT_YEAR || '2569');
    state.registeredTerms = state.registeredTerms || ['1/2569'];
    if (isAdminUI()) { try { usersCache = await API.getUsers(); } catch (e) { usersCache = []; } }
    renderAll();
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
  document.body.classList.toggle('has-homeroom', isAdminUI() || ((state.me && state.me.homerooms) || []).length > 0);
  document.getElementById('schoolName').textContent = state.settings.SCHOOL_NAME || '';
  document.getElementById('sidebarTermLabel').textContent = `${state.currentSemester}/${state.currentYear}`;
  document.getElementById('dashboardTermEyebrow').textContent = `SEMESTER ${state.currentSemester} / ${state.currentYear}`;
  const me = state.me || {};
  document.getElementById('meName').textContent = me.name || me.email || '';
  document.getElementById('meRole').textContent = isAdminUI() ? 'ผู้ดูแลระบบ' : 'ครู';
  document.getElementById('meAvatar').textContent = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  updateNetBadge();

  document.getElementById('studentCount').textContent = state.summary.studentCount || 0;
  document.getElementById('subjectCount').textContent = state.summary.subjectCount || 0;
  document.getElementById('scoreCount').textContent = state.summary.scoreCount || 0;

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

  const titles={dashboard:'Dashboard',scores:'บันทึกคะแนน',attendance:'เช็คชื่อ',tasks:'เช็คงาน',students:'นักเรียน',subjects:'รายวิชา',items:'องค์ประกอบคะแนน',reports:'รายงานผลการเรียน',users:'บุคลากร / สิทธิ์'};
  document.getElementById('pageTitle').textContent=titles[page]||'Dashboard';
  
  if(page==='scores') loadScorePage();
  if(page==='items') renderItems();
  if(page==='attendance'){
    const d=document.getElementById('attDate');
    if(d && !d.value) d.value = todayStr();
    loadAttendancePage();
  }
  if(page==='tasks') loadTaskPage();
  if(page==='users') loadUsersPage();
  
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
      const levelRoom = `${esc(s.level||'-')}/${esc(s.room||'-')}`;
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
  box.innerHTML = attendanceData.rows.map(r => {
    const rStatus = String(r.status_id || '');
    const btns = statuses.map(s => {
      const active = rStatus !== '' && rStatus === String(s.status_id);
      return `<button type="button" class="att-btn${active?' active':''}" data-student="${esc(r.student_id)}" data-status="${esc(s.status_id)}" style="--att-color:${esc(s.color||'#7F2BE3')}" title="${esc(s.label)}"><span class="lbl-full">${esc(s.label)}</span><span class="lbl-short">${esc(shortStatusLabel(s))}</span></button>`;
    }).join('');
    return `<div class="attendance-row" data-student="${esc(r.student_id)}">
      <div class="attendance-name"><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.student_id)}</small><span class="hr-slot">${homeroomBadge(r)}</span></div>
      <div class="attendance-btns">${btns}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('.att-btn').forEach(btn => btn.addEventListener('click', () => selectAttendanceStatus(btn)));
}

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
  if(!confirm('ต้องการกำหนดนักเรียนทั้งหมดเป็น "มา" หรือไม่?')) return;
  const present = attendanceData.statuses.find(s => s.status_id === 'PRESENT') || attendanceData.statuses[0] || {};
  if(!present.status_id) return toast('ไม่พบสถานะ "มา"','error');
  attendanceData.rows.forEach(r => r.status_id = String(present.status_id));
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
async function loadUsersPage(){
  if(!isAdminUI()) return;
  usersCache = await gas('getUsers');
  renderUsers();
}
function renderUsers(){
  const t = document.getElementById('usersTable');
  if(!usersCache.length){ t.innerHTML = '<tbody><tr><td class="empty">ยังไม่มีบุคลากร</td></tr></tbody>'; return; }
  t.innerHTML = '<thead><tr><th>ชื่อ</th><th>อีเมล</th><th>บทบาท</th><th>ครูประจำชั้น</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
    usersCache.map(u => `<tr>
      <td><b>${esc(u.name || '-')}</b></td><td>${esc(u.email)}</td>
      <td><span class="role-chip ${u.role==='admin'?'admin':''}">${u.role==='admin'?'ผู้ดูแลระบบ':'ครู'}</span></td>
      <td>${(u.homerooms||[]).map(h=>`<span class="room-chip">${esc(h.replace('|','/'))}</span>`).join(' ') || '<span style="color:var(--ink-faint)">-</span>'}</td>
      <td>${u.active===false?'<span class="state-chip off">ระงับ</span>':'<span class="state-chip on">ใช้งาน</span>'}</td>
      <td><button class="small-btn" onclick="openUserModal('${esc(u.email)}')">แก้ไข</button></td></tr>`).join('') + '</tbody>';
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
  closeModal(); renderUsers(); renderSubjects(); toast('บันทึกบุคลากรแล้ว');
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
      <div class="attendance-name"><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.student_id)}</small></div>
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

  const catHeaderRow = '<tr><th rowspan="2">รหัส</th><th rowspan="2">ชื่อ–สกุล</th>' +
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
      return `<tr data-row="${ri}" data-student="${esc(r.student_id)}"><td>${esc(r.student_id)}</td><td>${esc(r.first_name)} ${esc(r.last_name)}</td>${cells}<td class="row-total">${special?'-':Number(r.total).toFixed(2).replace('.00','')}</td><td class="row-grade">${gradeDisplay}</td><td>${statusSelect}</td></tr>`;
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

function renderDashboardStats(){
  document.getElementById('studentCount').textContent=state.summary.studentCount||0;
  document.getElementById('subjectCount').textContent=state.summary.subjectCount||0;
  document.getElementById('scoreCount').textContent=state.summary.scoreCount||0;
}

function renderStudents(){
  const active = state.students.filter(s => s.status !== 'INACTIVE');
  const table = document.getElementById('studentsTable');
  if (!table) return;

  if (active.length === 0) {
    table.innerHTML = '<thead><tr><th>รหัส</th><th>เลขประชาชน</th><th>ชื่อ–สกุล</th><th>ชั้น</th><th>ห้อง</th><th>ภาคเรียน</th><th>ปี</th><th></th></tr></thead><tbody><tr><td colspan="8" class="empty">ยังไม่มีข้อมูลนักเรียนในภาคเรียนนี้</td></tr></tbody>';
    return;
  }

  table.innerHTML='<thead><tr><th>รหัส</th><th>เลขประชาชน</th><th>ชื่อ–สกุล</th><th>ชั้น</th><th>ห้อง</th><th>ภาคเรียน</th><th>ปี</th><th></th></tr></thead><tbody>'+
    active.map(s=>`<tr><td>${esc(s.student_id)}</td><td>${maskCitizen(s.citizen_id)}</td><td>${esc(s.first_name)} ${esc(s.last_name)}</td><td>${esc(s.class_level)}</td><td>${esc(s.room)}</td><td>${esc(s.semester||state.currentSemester)}</td><td>${esc(s.academic_year||state.currentYear)}</td><td>${isAdminUI()?`<button class="small-btn" onclick='openStudentModal(${JSON.stringify(s).replace(/'/g,"&#39;")})'>แก้ไข</button> <button class="danger" onclick="removeStudent('${esc(s.student_id)}')">ลบ</button>`:''}</td></tr>`).join('')+'</tbody>';
}

function renderSubjects(){
  const active = state.subjects.filter(s => 
    s.status !== 'INACTIVE' &&
    (!state.currentSemester || String(s.semester) === String(state.currentSemester)) &&
    (!state.currentYear || String(s.academic_year) === String(state.currentYear))
  );

  if(!active.length){document.getElementById('subjectsTable').innerHTML='<tbody><tr><td class="empty">ยังไม่มีรายวิชาในภาคเรียนนี้ — กด "+ เพิ่มวิชา"</td></tr></tbody>';return;}
  document.getElementById('subjectsTable').innerHTML='<thead><tr><th>รหัสวิชา</th><th>ชื่อวิชา</th><th>ชั้น/ห้อง</th><th>ภาคเรียน</th><th>ปี</th><th>คะแนนเต็ม</th><th>ครูผู้สอน</th><th></th></tr></thead><tbody>'+
    active.map(s=>`<tr><td>${esc(s.subject_code||s.subject_id)}</td><td>${esc(s.subject_name)}</td><td>${esc(s.level)}/${esc(s.room)}</td><td>${esc(s.semester)}</td><td>${esc(s.academic_year)}</td><td>${s.max_score}</td><td style="white-space:normal;max-width:260px;font-size:12px">${(s.teachers||[]).map(e=>esc(teacherName(e))).join(', ')}</td><td><button class="small-btn" onclick='openSubjectModal(${JSON.stringify(s).replace(/'/g,"&#39;")})'>แก้ไข</button> <button class="danger" onclick="removeSubject('${esc(s.subject_id)}')">ลบ</button></td></tr>`).join('')+'</tbody>';
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
  <div class="form-row"><label>เลขประชาชน</label><input id="m_citizen_id" value="${esc(s.citizen_id||'')}"></div>
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
    citizen_id: v('m_citizen_id'),
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
      const levelRoom = `${esc(s.level || '-')}/${esc(s.room || '-')}`;
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
      ระบบอ่านเฉพาะ เลขประจำตัว คำนำหน้า ชื่อ สกุล ชั้น ห้อง ข้อมูลอื่น (วันเกิด ที่อยู่ ฯลฯ) จะไม่ถูกนำเข้า</div>
    <div class="form-row"><label>เลือกไฟล์ (.csv หรือ .xlsx)</label><input type="file" id="stuFile" accept=".csv,.xlsx,text/csv" onchange="readStudentFile()"></div>
    <div id="importFallback" class="form-grid" style="display:none">
      <div class="form-row"><label>ระดับชั้น (เช่น ม.5)</label><input id="import_level" value="ม.5" oninput="readStudentFile()"></div>
      <div class="form-row"><label>ห้อง (เช่น 2)</label><input id="import_room" value="1" oninput="readStudentFile()"></div>
    </div>
    <div id="importPreview"></div>
    <div class="import-opts">
      <label><input type="checkbox" id="imp_replace"> แทนที่รายชื่อเดิมของห้องที่เลือก (นักเรียนที่ไม่มีในไฟล์จะถูกปิดใช้งานในภาคเรียนนี้)</label>
      <label><input type="checkbox" id="imp_citizen"> นำเข้าเลขประจำตัวประชาชนด้วย (เก็บแยก อ่านได้เฉพาะผู้ดูแล — ถ้าไม่จำเป็นแนะนำไม่ต้องติ๊ก)</label>
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
    cid: colIdx(h, /^(เลข\s*ปปช\.?|เลข\s*ปชช\.?|เลขประชาชน|เลขประจำตัวประชาชน)$/),
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
      citizen_id: c.cid >= 0 ? cleanCell(r[c.cid]).replace(/\D/g, '') : '',
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
  const withCid = document.getElementById('imp_citizen').checked;
  const total = groups.reduce((a, g) => a + g.students.length, 0);
  if (!confirm(`ยืนยันนำเข้า ${total} คน (${groups.length} ห้อง) เข้าภาคเรียน ${state.currentSemester}/${state.currentYear}?` + (replace ? '\n\nนักเรียนเดิมในห้องที่เลือกที่ไม่มีในไฟล์จะถูกปิดใช้งาน' : ''))) return;
  try {
    const res = await gas('importStudentGroups', groups.map(g => ({ level: g.level, room: g.room, students: g.students })),
      { semester: state.currentSemester, academicYear: state.currentYear, replace, includeCitizen: withCid });
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

  const headers = ['รหัสนักเรียน', 'เลขประชาชน', 'ชื่อ', 'นามสกุล', 'ชั้น', 'ห้อง', 'ภาคเรียน', 'ปีการศึกษา', 'สถานะ'];
  const csvRows = [headers.join(',')];

  targetStudents.forEach(s => {
    const row = [
      `"${s.student_id || ''}"`,
      `"${s.citizen_id || ''}"`,
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
function showLoading(x){document.getElementById('loading').classList.toggle('hidden',!x)}