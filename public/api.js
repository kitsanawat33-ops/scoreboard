// =====================================================================
// api.js — ชั้นข้อมูลของ ScoreBoard บน Firestore
// พอร์ตตรรกะจาก Code.gs เดิม (ชื่อฟังก์ชันและรูปแบบผลลัพธ์เหมือนเดิม)
// หน้าเว็บเรียกผ่าน gas('ชื่อฟังก์ชัน', ...) เหมือนตอนใช้ Apps Script
// =====================================================================
import * as F from './fb.js';
import { BOOTSTRAP_ADMIN } from './config.js';

const { db, auth } = F;

export const CATEGORIES = {
  CLASSWORK: 'คะแนนเก็บ',
  ATTENDANCE: 'คะแนนเข้าเรียน',
  TASKS: 'ส่งงาน',
  MIDTERM: 'กลางภาค',
  FINAL: 'ปลายภาค'
};
const STATUS_LABELS = { NORMAL: null, I: 'ร', W: 'มส', ZERO: '0' };

const DEFAULT_GRADE_RULES = [
  { min_score: 80, max_score: 100, grade: '4', point: 4 },
  { min_score: 75, max_score: 79.99, grade: '3.5', point: 3.5 },
  { min_score: 70, max_score: 74.99, grade: '3', point: 3 },
  { min_score: 65, max_score: 69.99, grade: '2.5', point: 2.5 },
  { min_score: 60, max_score: 64.99, grade: '2', point: 2 },
  { min_score: 55, max_score: 59.99, grade: '1.5', point: 1.5 },
  { min_score: 50, max_score: 54.99, grade: '1', point: 1 },
  { min_score: 0, max_score: 49.99, grade: '0', point: 0 }
];
const DEFAULT_ATT_STATUSES = [
  { status_id: 'PRESENT', label: 'มา', color: '#0EA968', sequence: 1, status: 'ACTIVE', score_value: 1 },
  { status_id: 'ABSENT', label: 'ขาด', color: '#E5484D', sequence: 2, status: 'ACTIVE', score_value: 0 },
  { status_id: 'LEAVE', label: 'ลา', color: '#2F80ED', sequence: 3, status: 'ACTIVE', score_value: 1 },
  { status_id: 'LATE', label: 'มาสาย', color: '#F0A020', sequence: 4, status: 'ACTIVE', score_value: 0.5 },
  { status_id: 'ACTIVITY', label: 'ทำกิจกรรม', color: '#7F2BE3', sequence: 5, status: 'ACTIVE', score_value: 1 }
];
const DEFAULT_TASK_STATUSES = [
  { status_id: 'SUBMITTED', label: 'ส่งแล้ว', color: '#0EA968', sequence: 1, status: 'ACTIVE', score_value: 1 },
  { status_id: 'LATE', label: 'ส่งช้า', color: '#F0A020', sequence: 2, status: 'ACTIVE', score_value: 0.8 },
  { status_id: 'REVISE', label: 'รอแก้ไข', color: '#7F2BE3', sequence: 3, status: 'ACTIVE', score_value: 0.5 },
  { status_id: 'MISSING', label: 'ยังไม่ส่ง', color: '#E5484D', sequence: 4, status: 'ACTIVE', score_value: 0 },
  { status_id: 'EXCUSED', label: 'ยกเว้น', color: '#2F80ED', sequence: 5, status: 'ACTIVE', score_value: 1 }
];

// ---------------------------------------------------------------------
// สถานะภายใน
// ---------------------------------------------------------------------
const S = {
  me: null,            // { email, name, role, active, homerooms[] }
  settings: null,      // meta/settings
  gradeRules: [],
  attStatuses: [],
  taskStatuses: [],
  term: { sem: '1', yr: '2569' },
  subjectCache: {}     // subject_id -> subject
};

export const isAdmin = () => !!S.me && S.me.role === 'admin';
// มุมมอง: 'admin' = เห็นทั้งโรงเรียน, 'mine' = เห็นเฉพาะงานของตัวเอง (ครูทุกคนเป็น mine เสมอ)
S.view = 'mine';
const seeAll = () => isAdmin() && S.view === 'admin';
export function setView(v) { S.view = (v === 'admin' && isAdmin()) ? 'admin' : 'mine'; return S.view; }
const mySubject = s => (s.teachers || []).includes(S.me && S.me.email);
export const me = () => S.me;

// ---------------------------------------------------------------------
// ตัวช่วย
// ---------------------------------------------------------------------
const uid = (n = 12) => {
  const a = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
};
const str = v => String(v ?? '').trim();
const num = v => Number(v);
const toBool = v => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
const nowIso = () => new Date().toISOString();
const ref = (...p) => F.doc(db, ...p);

export function rosterId(sem, yr, level, room) {
  return `${str(sem)}_${str(yr)}_${str(level)}_${str(room)}`.replace(/\//g, '-');
}
function normalizeDateStr(d) {
  if (!d) return '';
  // เลขวันที่แบบ Excel (เช่น 46328) → yyyy-mm-dd โดยคิดแบบ UTC เพื่อไม่ให้วันเลื่อนตามเขตเวลา
  if (typeof d === 'number' && d > 20000 && d < 80000) {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(d * 86400000));
    const p = n => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
  }
  if (d instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const s = String(d).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

// อ่านเอกสาร: เปิด "ช่องฟังแบบเรียลไทม์" ครั้งแรกที่อ่าน แล้วเก็บไว้ในหน่วยความจำ
// ครั้งต่อไป (สลับแถบ/สลับวิชา) ได้ข้อมูลทันทีโดยไม่ต้องรอเซิร์ฟเวอร์
// และยังเป็นข้อมูลล่าสุดเสมอ เพราะ Firestore ส่งการเปลี่ยนแปลงจากครูคนอื่นมาให้เอง
const LIVE = new Map();
const LIVE_MAX = 120;
function listen(r) {
  const p = r.path;
  let e = LIVE.get(p);
  if (e) { LIVE.delete(p); LIVE.set(p, e); return e; }   // ย้ายไปท้าย (ใช้ล่าสุด)
  e = { data: null };
  e.ready = new Promise((resolve, reject) => {
    let done = false, cached = null, timer = null;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    e.unsub = F.onSnapshot(r, { includeMetadataChanges: false }, snap => {
      e.data = snap.exists() ? snap.data() : null;
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      if (!fromCache || !navigator.onLine) return finish();
      // ได้ข้อมูลจากเครื่องก่อน: รอเซิร์ฟเวอร์อีกนิด ถ้าเน็ตช้าใช้ของในเครื่องไปก่อน
      if (!cached) { cached = true; timer = setTimeout(finish, 2500); }
    }, err => {
      LIVE.delete(p);
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
  LIVE.set(p, e);
  while (LIVE.size > LIVE_MAX) {
    const [k, old] = LIVE.entries().next().value;
    try { old.unsub && old.unsub(); } catch (x) {}
    LIVE.delete(k);
  }
  return e;
}
async function read(r) {
  const e = listen(r);
  await e.ready;
  return e.data == null ? null : structuredClone(e.data);
}
function stopAllListeners() {
  LIVE.forEach(e => { try { e.unsub && e.unsub(); } catch (x) {} });
  LIVE.clear();
}

// โหลดข้อมูลของวิชาล่วงหน้า (เรียกตอนเลือกวิชา) ให้ทุกแถบเปิดได้ทันที
export async function prefetchSubject(subjectId) {
  if (!subjectId || !S.me) return;
  try {
    const s = await read(ref('subjects', String(subjectId)));
    if (!s) return;
    const id = String(subjectId);
    [...subjRooms(s).flatMap(r => [ref('rosters', rosterId(s.semester, s.academic_year, s.level, r)), ref('homeroomBook', rosterId(s.semester, s.academic_year, s.level, r))]),
     ref('scoreSheets', id), ref('attendanceBook', id), ref('taskBook', id)]
      .forEach(r => listen(r).ready.catch(() => {}));
  } catch (e) {}
}

// เขียน: ออนไลน์รอเซิร์ฟเวอร์ยืนยัน (สูงสุด 10 วินาที)
// ออฟไลน์/เน็ตช้า: เขียนลงเครื่องแล้วไปต่อเลย Firestore จะส่งให้เองเมื่อกลับมาออนไลน์
async function commit(promise) {
  if (!navigator.onLine) { promise.catch(e => console.warn('pending write failed', e)); return { pending: true }; }
  let timer;
  const timeout = new Promise(res => { timer = setTimeout(() => res({ pending: true }), 10000); });
  try {
    const r = await Promise.race([promise.then(() => ({ pending: false })), timeout]);
    if (r.pending) promise.catch(e => console.warn('pending write failed', e));
    return r;
  } finally { clearTimeout(timer); }
}

function requireAdmin() { if (!isAdmin()) throw new Error('เฉพาะผู้ดูแลระบบเท่านั้น'); }

// ---------------------------------------------------------------------
// เข้าสู่ระบบ
// ---------------------------------------------------------------------
export async function login() {
  const provider = new F.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await F.signInWithPopup(auth, provider);
  } catch (e) {
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      await F.signInWithRedirect(auth, provider);
    } else throw e;
  }
}
export async function logout() { stopAllListeners(); await F.signOut(auth); S.me = null; }
export function onAuth(cb) { return F.onAuthStateChanged(auth, cb); }

// ตรวจสิทธิ์หลังล็อกอิน คืนค่า { ok, reason }
export async function resolveUser(user) {
  if (!user) return { ok: false, reason: 'signed-out' };
  const email = String(user.email || '').toLowerCase();
  const bootstrap = email === BOOTSTRAP_ADMIN.toLowerCase();
  let u = null;
  try { u = await read(ref('users', email)); } catch (e) { u = null; }
  if (!u && bootstrap) {
    u = { email, name: user.displayName || email, role: 'admin', active: true, homerooms: [], createdAt: nowIso() };
    await F.setDoc(ref('users', email), u);
  }
  if (!u) return { ok: false, reason: 'not-registered', email };
  if (u.active !== true && !bootstrap) return { ok: false, reason: 'suspended', email };
  S.me = { email, name: u.name || user.displayName || email, role: bootstrap ? 'admin' : (u.role || 'teacher'), active: true, homerooms: u.homerooms || [] };
  return { ok: true, me: S.me };
}

// ---------------------------------------------------------------------
// ตั้งค่า / ข้อมูลตั้งต้น
// ---------------------------------------------------------------------
async function loadMeta() {
  let [settings, gr, as, ts] = await Promise.all([
    read(ref('meta', 'settings')), read(ref('meta', 'gradeRules')),
    read(ref('meta', 'attendanceStatuses')), read(ref('meta', 'taskStatuses'))
  ]);
  if (isAdmin()) {
    const writes = [];
    if (!settings) { settings = { SCHOOL_NAME: 'โรงเรียนบ้านโพนแพง เจียรวนนท์อุทิศ 5', CURRENT_SEMESTER: '1', CURRENT_YEAR: '2569', REGISTERED_TERMS: ['1/2569'] }; writes.push(F.setDoc(ref('meta', 'settings'), settings)); }
    if (!gr) { gr = { list: DEFAULT_GRADE_RULES }; writes.push(F.setDoc(ref('meta', 'gradeRules'), gr)); }
    if (!as) { as = { list: DEFAULT_ATT_STATUSES }; writes.push(F.setDoc(ref('meta', 'attendanceStatuses'), as)); }
    if (!ts) { ts = { list: DEFAULT_TASK_STATUSES }; writes.push(F.setDoc(ref('meta', 'taskStatuses'), ts)); }
    if (writes.length) await commit(Promise.all(writes));
  }
  S.settings = settings || { SCHOOL_NAME: '', CURRENT_SEMESTER: '1', CURRENT_YEAR: '2569', REGISTERED_TERMS: ['1/2569'] };
  S.gradeRules = ((gr && gr.list) || DEFAULT_GRADE_RULES).slice().sort((a, b) => num(b.min_score) - num(a.min_score));
  S.attStatuses = sortStatuses((as && as.list) || DEFAULT_ATT_STATUSES);
  S.taskStatuses = sortStatuses((ts && ts.list) || DEFAULT_TASK_STATUSES);
}
const sortStatuses = l => l.filter(s => s.status !== 'INACTIVE').sort((a, b) => num(a.sequence) - num(b.sequence));

function settingsOut() {
  const s = S.settings || {};
  return {
    SCHOOL_NAME: s.SCHOOL_NAME || '',
    CURRENT_SEMESTER: S.term.sem,
    CURRENT_YEAR: S.term.yr,
    REGISTERED_TERMS: JSON.stringify(registeredTerms())
  };
}
function registeredTerms() {
  const t = (S.settings && S.settings.REGISTERED_TERMS) || ['1/2569'];
  return Array.from(new Set(Array.isArray(t) ? t : String(t).split(',').map(x => x.trim()).filter(Boolean)));
}

function pickTerm() {
  let saved = null;
  try { saved = localStorage.getItem('sb_term'); } catch (e) {}
  const terms = registeredTerms();
  const def = `${S.settings.CURRENT_SEMESTER || '1'}/${S.settings.CURRENT_YEAR || '2569'}`;
  const t = (saved && terms.includes(saved)) ? saved : def;
  const [sem, yr] = t.split('/');
  S.term = { sem, yr };
}
function rememberTerm() { try { localStorage.setItem('sb_term', `${S.term.sem}/${S.term.yr}`); } catch (e) {} }

export async function getInitialData() {
  await loadMeta();
  pickTerm();
  const [students, subjects, allSubjects] = await Promise.all([
    getStudents(S.term.sem, S.term.yr), getSubjects(S.term.sem, S.term.yr), getSubjects()
  ]);
  return {
    students, subjects, allSubjects,
    gradeRules: S.gradeRules,
    settings: settingsOut(),
    registeredTerms: registeredTerms(),
    summary: summaryFrom(students, subjects),
    categories: CATEGORIES,
    attendanceStatuses: S.attStatuses,
    taskStatuses: S.taskStatuses,
    me: S.me
  };
}

function summaryFrom(students, subjects) {
  return {
    studentCount: students.filter(s => s.status !== 'INACTIVE').length,
    subjectCount: subjects.filter(s => s.status !== 'INACTIVE').length,
    scoreCount: 0,
    gradeCounts: {}
  };
}

export async function getDashboardSummary(subjectId, semester, academicYear) {
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  const [students, subjects] = await Promise.all([getStudents(sem, yr), getSubjects(sem, yr)]);
  const out = summaryFrom(students, subjects);
  if (subjectId) {
    const sh = await read(ref('scoreSheets', String(subjectId)));
    let c = 0;
    Object.values((sh && sh.scores) || {}).forEach(m => Object.values(m || {}).forEach(v => { if (v !== '' && v != null) c++; }));
    out.scoreCount = c;
  }
  return out;
}

export async function saveSchoolNameSetting(name) {
  requireAdmin();
  const schoolName = str(name);
  if (!schoolName) throw new Error('กรุณาระบุชื่อโรงเรียน/สถานศึกษา');
  S.settings.SCHOOL_NAME = schoolName;
  await commit(F.setDoc(ref('meta', 'settings'), { SCHOOL_NAME: schoolName }, { merge: true }));
  return settingsOut();
}

// ---------------------------------------------------------------------
// ภาคเรียน
// ---------------------------------------------------------------------
async function saveTerms(terms, extra = {}) {
  const clean = Array.from(new Set(terms.filter(Boolean)));
  S.settings.REGISTERED_TERMS = clean;
  Object.assign(S.settings, extra);
  await commit(F.setDoc(ref('meta', 'settings'), Object.assign({ REGISTERED_TERMS: clean }, extra), { merge: true }));
  return clean;
}

export async function switchTerm(semester, year) {
  S.term = { sem: str(semester || '1'), yr: str(year || '2569') };
  rememberTerm();
  const [students, subjects] = await Promise.all([getStudents(S.term.sem, S.term.yr), getSubjects(S.term.sem, S.term.yr)]);
  return { settings: settingsOut(), registeredTerms: registeredTerms(), students, subjects, summary: summaryFrom(students, subjects) };
}

export async function createNewTerm(semester, academicYear) {
  requireAdmin();
  const sem = str(semester), yr = str(academicYear);
  if (!sem || !yr) throw new Error('กรุณาระบุภาคเรียนและปีการศึกษา');
  const termStr = `${sem}/${yr}`;
  const terms = registeredTerms();
  if (!terms.includes(termStr)) terms.push(termStr);
  await saveTerms(terms, { CURRENT_SEMESTER: sem, CURRENT_YEAR: yr });
  S.term = { sem, yr }; rememberTerm();
  return {
    ok: true, createdTerm: termStr, currentSemester: sem, currentYear: yr,
    registeredTerms: registeredTerms(),
    students: await getStudents(sem, yr), subjects: await getSubjects(sem, yr), settings: settingsOut()
  };
}

export async function deleteTermCompletely(semester, academicYear, confirmText) {
  requireAdmin();
  const sem = str(semester), yr = str(academicYear), termStr = `${sem}/${yr}`;
  if (str(confirmText) !== termStr) throw new Error(`กรุณาพิมพ์ ${termStr} เพื่อยืนยันการลบ`);

  // นักเรียน/รายวิชาในเทอมนี้ → INACTIVE (ข้อมูลเดิมยังอยู่ กู้คืนได้)
  const rosters = await F.getDocs(F.query(F.collection(db, 'rosters'), F.where('semester', '==', sem), F.where('academic_year', '==', yr)));
  const subs = await F.getDocs(F.query(F.collection(db, 'subjects'), F.where('semester', '==', sem), F.where('academic_year', '==', yr)));
  const batch = F.writeBatch(db);
  rosters.forEach(d => {
    const st = d.data().students || {};
    Object.keys(st).forEach(k => { st[k].status = 'INACTIVE'; });
    batch.update(d.ref, { students: st });
  });
  subs.forEach(d => batch.update(d.ref, { status: 'INACTIVE' }));
  await commit(batch.commit());

  let terms = registeredTerms().filter(t => t !== termStr);
  if (!terms.length) terms = ['1/2569'];
  const extra = {};
  if (S.settings.CURRENT_SEMESTER === sem && S.settings.CURRENT_YEAR === yr) {
    const [s0, y0] = terms[0].split('/'); extra.CURRENT_SEMESTER = s0; extra.CURRENT_YEAR = y0;
  }
  await saveTerms(terms, extra);
  if (S.term.sem === sem && S.term.yr === yr) { const [s0, y0] = terms[0].split('/'); S.term = { sem: s0, yr: y0 }; rememberTerm(); }
  return {
    ok: true, deletedTerm: termStr, registeredTerms: terms,
    currentSemester: S.term.sem, currentYear: S.term.yr,
    subjects: await getSubjects(S.term.sem, S.term.yr), allSubjects: await getSubjects(),
    students: await getStudents(S.term.sem, S.term.yr), settings: settingsOut()
  };
}

export async function copyTermData(payload) {
  requireAdmin();
  if (!payload || !payload.sourceSemester || !payload.sourceYear || !payload.targetSemester || !payload.targetYear)
    throw new Error('กรุณาระบุภาคเรียนและปีการศึกษาต้นทาง-ปลายทาง');
  const srcSem = str(payload.sourceSemester), srcYr = str(payload.sourceYear);
  const tgtSem = str(payload.targetSemester), tgtYr = str(payload.targetYear);
  let copiedSubjectsCount = 0, copiedStudentsCount = 0;
  const batch = F.writeBatch(db);

  if (payload.copyStudents) {
    const rosters = await F.getDocs(F.query(F.collection(db, 'rosters'), F.where('semester', '==', srcSem), F.where('academic_year', '==', srcYr)));
    const secrets = {};
    for (const d of rosters.docs) {
      const sec = await read(ref('rosterSecrets', d.id));
      secrets[d.id] = (sec && sec.citizen) || {};
    }
    rosters.forEach(d => {
      const r = d.data();
      let lvl = str(r.level);
      if (payload.promoteLevel) {
        const m = lvl.match(/(\d+)/);
        if (m) lvl = lvl.replace(m[1], String(parseInt(m[1], 10) + 1));
      }
      const students = {};
      Object.values(r.students || {}).forEach(s => {
        if (s.status === 'INACTIVE') return;
        students[s.student_id] = { student_id: s.student_id, first_name: s.first_name, last_name: s.last_name, status: 'ACTIVE' };
        copiedStudentsCount++;
      });
      const nid = rosterId(tgtSem, tgtYr, lvl, r.room);
      batch.set(ref('rosters', nid), { semester: tgtSem, academic_year: tgtYr, level: lvl, room: str(r.room), students }, { merge: true });
      const cz = {};
      Object.keys(students).forEach(sid => { if (secrets[d.id][sid]) cz[sid] = secrets[d.id][sid]; });
      if (Object.keys(cz).length) batch.set(ref('rosterSecrets', nid), { citizen: cz }, { merge: true });
    });
  }

  if (payload.copySubjects) {
    const subs = await F.getDocs(F.query(F.collection(db, 'subjects'), F.where('semester', '==', srcSem), F.where('academic_year', '==', srcYr)));
    subs.forEach(d => {
      const s = d.data();
      if (s.status === 'INACTIVE') return;
      const nid = uid(10);
      const items = {};
      if (payload.copyScoreItems) {
        Object.values(s.items || {}).forEach(it => {
          if (it.status === 'INACTIVE') return;
          const iid = uid(12);
          items[iid] = Object.assign({}, it, { item_id: iid, subject_id: nid, status: 'ACTIVE' });
        });
      }
      batch.set(ref('subjects', nid), {
        subject_id: nid, subject_code: s.subject_code || '', subject_name: s.subject_name, level: s.level, room: s.room,
        semester: tgtSem, academic_year: tgtYr, max_score: num(s.max_score || 100), status: 'ACTIVE',
        teachers: s.teachers || [S.me.email], config: Object.assign({}, s.config || {}, { locked: false }),
        items, tasks: {}, updated_at: nowIso()
      });
      copiedSubjectsCount++;
    });
  }
  await commit(batch.commit());
  const terms = registeredTerms();
  if (!terms.includes(`${tgtSem}/${tgtYr}`)) terms.push(`${tgtSem}/${tgtYr}`);
  await saveTerms(terms);
  S.term = { sem: tgtSem, yr: tgtYr }; rememberTerm();
  return {
    ok: true, copiedSubjectsCount, copiedStudentsCount, registeredTerms: registeredTerms(),
    subjects: await getSubjects(tgtSem, tgtYr), students: await getStudents(tgtSem, tgtYr),
    allSubjects: await getSubjects(), settings: settingsOut()
  };
}

// ---------------------------------------------------------------------
// นักเรียน (เก็บเป็นห้อง: rosters/{ภาค_ปี_ชั้น_ห้อง})
// ---------------------------------------------------------------------
async function termRosters(sem, yr) {
  const q = F.query(F.collection(db, 'rosters'), F.where('semester', '==', str(sem)), F.where('academic_year', '==', str(yr)));
  const snap = await F.getDocs(q);
  return snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
}

export async function getStudents(semester, academicYear) {
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  const rosters = await termRosters(sem, yr);
  const out = [];
  rosters.forEach(r => {
    Object.values(r.students || {}).forEach(s => {
      out.push({
        student_id: String(s.student_id), prefix: s.prefix || '',
        first_name: s.first_name, last_name: s.last_name, class_level: r.level, room: r.room,
        semester: sem, academic_year: yr, status: s.status || 'ACTIVE'
      });
    });
  });
  out.sort((a, b) => (a.class_level + a.room).localeCompare(b.class_level + b.room, 'th') || String(a.student_id).localeCompare(String(b.student_id), 'th', { numeric: true }));
  return out;
}

async function rosterStudents(sem, yr, level, room) {
  const r = await read(ref('rosters', rosterId(sem, yr, level, room)));
  return Object.values((r && r.students) || {})
    .filter(s => s.status !== 'INACTIVE')
    .map(s => ({ student_id: String(s.student_id), first_name: s.first_name, last_name: s.last_name, status: s.status || 'ACTIVE' }))
    .sort((a, b) => String(a.student_id).localeCompare(String(b.student_id), 'th', { numeric: true }));
}

// ห้องของวิชา (วิชาเรียนรวมมีหลายห้อง)
export const subjRooms = s => {
  const r = (Array.isArray(s.rooms) && s.rooms.length ? s.rooms : [s.room]).map(str).filter(Boolean);
  return [...new Set(r)].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
};
const roomKeys = (level, rooms) => rooms.map(r => `${str(level)}|${r}`);
// นักเรียนของวิชา (รวมทุกห้อง เรียงตามห้องแล้วตามเลขประจำตัว)
async function subjectStudents(subject) {
  const rooms = subjRooms(subject);
  const lists = await Promise.all(rooms.map(r => rosterStudents(subject.semester, subject.academic_year, subject.level, r)
    .then(l => l.map(s => Object.assign(s, { room: r })))));
  return lists.flat();
}
async function subjectMorning(subject, date) {
  const books = await Promise.all(subjRooms(subject).map(r =>
    read(ref('homeroomBook', rosterId(subject.semester, subject.academic_year, subject.level, r))).catch(() => null)));
  return Object.assign({}, ...books.map(b => ((b && b.days) || {})[date] || {}));
}

async function upsertStudents(records) {
  // records: [{student_id, citizen_id, first_name, last_name, class_level, room, semester, academic_year, status}]
  const groups = {};
  records.forEach(r => {
    const id = rosterId(r.semester, r.academic_year, r.class_level, r.room);
    (groups[id] = groups[id] || { meta: r, students: {}, citizen: {} });
    groups[id].students[r.student_id] = { student_id: r.student_id, prefix: str(r.prefix), first_name: r.first_name, last_name: r.last_name, status: r.status || 'ACTIVE' };
  });
  const batch = F.writeBatch(db);
  Object.entries(groups).forEach(([id, g]) => {
    batch.set(ref('rosters', id), {
      semester: str(g.meta.semester), academic_year: str(g.meta.academic_year), level: str(g.meta.class_level), room: str(g.meta.room),
      students: g.students
    }, { merge: true });
    if (Object.keys(g.citizen).length) batch.set(ref('rosterSecrets', id), { citizen: g.citizen }, { merge: true });
  });
  await commit(batch.commit());
}

// ลบนักเรียนออกจากห้องเดิม (กรณีย้ายห้อง)
async function removeFromOtherRosters(sem, yr, studentId, keepId) {
  const rosters = await termRosters(sem, yr);
  const batch = F.writeBatch(db); let n = 0;
  rosters.forEach(r => {
    if (r._id === keepId) return;
    if (r.students && r.students[studentId]) {
      batch.update(ref('rosters', r._id), new F.FieldPath('students', String(studentId)), F.deleteField()); n++;
    }
  });
  if (n) await commit(batch.commit());
}

export async function importStudents(rows, classLevel, room, semester, academicYear) {
  requireAdmin();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('ไม่พบข้อมูลนักเรียนในไฟล์');
  const sem = str(semester || '1'), yr = str(academicYear || '2569');
  const header = rows[0].map(x => str(x));
  const idx = {}; header.forEach((h, i) => idx[h] = i);
  const aliases = {
    studentId: ['รหัสนักเรียน', 'เลขประจำตัว', 'เลขประจำตัวนักเรียน'],
    citizenId: ['เลข ปชช.', 'เลขประชาชน', 'เลข ปชช', 'เลขประจำตัวประชาชน'],
    firstName: ['ชื่อ'],
    lastName: ['นามสกุล']
  };
  const c = {};
  Object.keys(aliases).forEach(k => { c[k] = -1; for (const n of aliases[k]) if (idx[n] !== undefined) { c[k] = idx[n]; break; } });
  if (c.studentId < 0 || c.firstName < 0 || c.lastName < 0) throw new Error('CSV ต้องมีคอลัมน์ รหัสนักเรียน, ชื่อ และ นามสกุล');
  const records = [];
  rows.slice(1).forEach(r => {
    const sid = str(r[c.studentId]); if (!sid) return;
    records.push({
      student_id: sid,
      first_name: str(r[c.firstName]), last_name: str(r[c.lastName]),
      class_level: str(classLevel || 'ม.5'), room: str(room || '1'), semester: sem, academic_year: yr, status: 'ACTIVE'
    });
  });
  await upsertStudents(records);
  return { ok: true, count: records.length, students: await getStudents(sem, yr) };
}

// นำเข้ารายชื่อเป็นกลุ่มห้อง (จาก CSV SchoolMIS / ใบรายชื่อ .xlsx)
export async function importStudentGroups(groups, opts = {}) {
  requireAdmin();
  const sem = str(opts.semester || S.term.sem), yr = str(opts.academicYear || S.term.yr);
  if (!Array.isArray(groups) || !groups.length) throw new Error('ไม่มีห้องที่เลือก');
  const existing = await termRosters(sem, yr);
  const target = {};   // rosterId -> {meta, students{}, citizen{}}
  const where = {};    // sid -> rosterId (คนเดียวอยู่ได้ห้องเดียวต่อภาคเรียน)
  let count = 0;
  groups.forEach(g => {
    const level = str(g.level), room = str(g.room || '1');
    if (!level) return;
    const id = rosterId(sem, yr, level, room);
    target[id] = target[id] || { level, room, students: {} };
    (g.students || []).forEach(s => {
      const sid = str(s.student_id); if (!sid) return;
      if (where[sid] && where[sid] !== id) delete target[where[sid]].students[sid];
      where[sid] = id;
      target[id].students[sid] = { student_id: sid, prefix: str(s.prefix), first_name: str(s.first_name), last_name: str(s.last_name), status: 'ACTIVE' };
    });
  });
  const ops = [];
  let deactivated = 0;
  Object.entries(target).forEach(([id, t]) => {
    const prev = existing.find(r => r._id === id);
    const students = Object.assign({}, (prev && prev.students) || {});
    if (opts.replace) Object.keys(students).forEach(sid => {
      if (!t.students[sid] && students[sid].status !== 'INACTIVE') { students[sid] = Object.assign({}, students[sid], { status: 'INACTIVE' }); deactivated++; }
    });
    Object.assign(students, t.students);
    count += Object.keys(t.students).length;
    ops.push(['set', ref('rosters', id), { semester: sem, academic_year: yr, level: t.level, room: t.room, students }]);
  });
  // นักเรียนที่ย้ายห้อง: เอาออกจากห้องเดิมในภาคเรียนเดียวกัน
  existing.forEach(r => {
    if (target[r._id]) return;
    const moved = Object.keys(r.students || {}).filter(sid => where[sid]);
    if (moved.length) {
      const args = [];
      moved.forEach(sid => args.push(new F.FieldPath('students', sid), F.deleteField()));
      ops.push(['update', ref('rosters', r._id), args]);
    }
  });
  for (let i = 0; i < ops.length; i += 400) {
    const batch = F.writeBatch(db);
    ops.slice(i, i + 400).forEach(([kind, r, data]) => {
      if (kind === 'set') batch.set(r, data);
      else if (kind === 'merge') batch.set(r, data, { merge: true });
      else batch.update(r, ...data);
    });
    await commit(batch.commit());
  }
  return { ok: true, count, rooms: Object.keys(target).length, deactivated, students: await getStudents(sem, yr) };
}

export async function saveStudent(student) {
  requireAdmin();
  ['student_id', 'first_name', 'last_name'].forEach(k => { if (!str(student[k])) throw new Error(`กรุณากรอก ${k}`); });
  const rec = {
    student_id: str(student.student_id), prefix: str(student.prefix),
    first_name: str(student.first_name), last_name: str(student.last_name),
    class_level: str(student.class_level || 'ม.5'), room: str(student.room || '1'),
    semester: str(student.semester || S.term.sem), academic_year: str(student.academic_year || S.term.yr),
    status: str(student.status || 'ACTIVE')
  };
  await upsertStudents([rec]);
  await removeFromOtherRosters(rec.semester, rec.academic_year, rec.student_id, rosterId(rec.semester, rec.academic_year, rec.class_level, rec.room));
  return getStudents(rec.semester, rec.academic_year);
}

async function setStudentsInactive(sem, yr, match) {
  const rosters = await termRosters(sem, yr);
  const batch = F.writeBatch(db); let n = 0;
  rosters.forEach(r => {
    Object.values(r.students || {}).forEach(s => {
      if (match(s, r)) { batch.update(ref('rosters', r._id), new F.FieldPath('students', String(s.student_id), 'status'), 'INACTIVE'); n++; }
    });
  });
  if (n) await commit(batch.commit());
}
export async function deleteStudent(studentId, semester, academicYear) {
  requireAdmin();
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  await setStudentsInactive(sem, yr, s => String(s.student_id) === String(studentId));
  return getStudents(sem, yr);
}
export async function deleteAllStudents(semester, academicYear) {
  requireAdmin();
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  await setStudentsInactive(sem, yr, () => true);
  return getStudents(sem, yr);
}
export async function deleteStudentsByRoom(level, room, semester, academicYear) {
  requireAdmin();
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  await setStudentsInactive(sem, yr, (s, r) => str(r.level) === str(level) && str(r.room) === str(room));
  return getStudents(sem, yr);
}

// ---------------------------------------------------------------------
// รายวิชา
// ---------------------------------------------------------------------
function subjectOut(d) {
  const s = Object.assign({}, d);
  s.rooms = subjRooms(d);
  S.subjectCache[s.subject_id] = d;
  return s;
}

export async function getSubjects(semester, academicYear) {
  let docs;
  if (seeAll()) {
    const q = (semester || academicYear)
      ? F.query(F.collection(db, 'subjects'), F.where('semester', '==', str(semester)), F.where('academic_year', '==', str(academicYear)))
      : F.collection(db, 'subjects');
    docs = (await F.getDocs(q)).docs.map(d => d.data());
  } else {
    const q = F.query(F.collection(db, 'subjects'), F.where('teachers', 'array-contains', S.me.email));
    docs = (await F.getDocs(q)).docs.map(d => d.data());
    if (semester || academicYear) docs = docs.filter(s => str(s.semester) === str(semester) && str(s.academic_year) === str(academicYear));
  }
  return docs.map(subjectOut).sort(subjectSort);
}
const subjectSort = (a, b) => (a.level + '/' + a.room).localeCompare(b.level + '/' + b.room, 'th', { numeric: true }) || String(a.subject_code).localeCompare(String(b.subject_code), 'th');

// ---------------------------------------------------------------------
// งานสอน: รายวิชาทั้งหมดของภาคเรียน (ให้ครูเลือกรับสอน) / ห้องประจำชั้น
// ---------------------------------------------------------------------
export async function getSubjectCatalog(semester, academicYear) {
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  const q = F.query(F.collection(db, 'subjects'), F.where('semester', '==', sem), F.where('academic_year', '==', yr));
  const docs = (await F.getDocs(q)).docs.map(d => d.data()).filter(s => s.status !== 'INACTIVE');
  return docs.map(s => ({ subject_id: s.subject_id, subject_code: s.subject_code, subject_name: s.subject_name, level: s.level, room: s.room, rooms: subjRooms(s),
    teachers: s.teachers || [], teacher_names: s.teacher_names || {}, planned_teacher: s.planned_teacher || '', planned_teachers: s.planned_teachers || (s.planned_teacher ? [s.planned_teacher] : []), schedule: s.schedule || [], item_total: Object.values(s.items || {}).filter(i => i.status !== 'INACTIVE' && !toBool(i.is_retake)).reduce((t, i) => t + num(i.max_score || 0), 0), item_count: Object.values(s.items || {}).filter(i => i.status !== 'INACTIVE').length, credit: (s.config || {}).credit })).sort(subjectSort);
}
export async function getRoomList(semester, academicYear) {
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  const rosters = await termRosters(sem, yr);
  return rosters.map(r => ({ key: `${r.level}|${r.room}`, level: r.level, room: r.room,
    count: Object.values(r.students || {}).filter(s => s.status !== 'INACTIVE').length }))
    .sort((a, b) => (a.level + '/' + a.room).localeCompare(b.level + '/' + b.room, 'th', { numeric: true }));
}
// กำหนดครูผู้สอน — เฉพาะผู้ดูแลระบบ
export async function assignSubject(subjectId, email, on, name) {
  const e = str(email || S.me.email).toLowerCase();
  requireAdmin();
  const r = ref('subjects', String(subjectId));
  const patch = { teachers: on ? F.arrayUnion(e) : F.arrayRemove(e) };
  const args = [new F.FieldPath('teachers'), patch.teachers, new F.FieldPath('teacher_names', e), on ? str(name || (e === S.me.email ? S.me.name : e)) : F.deleteField()];
  await commit(F.updateDoc(r, ...args));
  return getSubjectCatalog();
}
// กำหนดครูประจำชั้น — เฉพาะผู้ดูแลระบบ
export async function assignHomeroom(key, email, on) {
  const e = str(email || S.me.email).toLowerCase();
  requireAdmin();
  if (!/^[^|]+\|[^|]+$/.test(str(key))) throw new Error('ห้องไม่ถูกต้อง');
  await commit(F.updateDoc(ref('users', e), { homerooms: on ? F.arrayUnion(str(key)) : F.arrayRemove(str(key)) }));
  if (e === S.me.email) {
    const set = new Set(S.me.homerooms || []);
    on ? set.add(str(key)) : set.delete(str(key));
    S.me.homerooms = [...set];
  }
  return { homerooms: e === S.me.email ? S.me.homerooms : null };
}
// ผูกวิชากับครูตามชื่อในตารางสอน (planned_teacher) เมื่อครูคนนั้นมีอีเมลในระบบแล้ว
const PREFIX_RE = /^(นางสาว|นาง|นาย|น\.ส\.|ว่าที่\s*ร\.?\s*ต\.?\s*(หญิง)?|ว่าที่ร้อยตรี(หญิง)?|ดร\.|ครู)\s*/;
function nname(n) { let x = str(n); for (let i = 0; i < 3; i++) x = x.replace(PREFIX_RE, ''); return x.replace(/\s+/g, ''); }
export async function linkPlannedTeachers(semester, academicYear) {
  requireAdmin();
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  const [users, catalog] = await Promise.all([getUsers(), getSubjectCatalog(sem, yr)]);
  const byName = {};
  users.filter(u => u.active !== false).forEach(u => { const k = nname(u.name); if (k) byName[k] = u; });
  const ops = [];
  catalog.forEach(s => {
    (s.planned_teachers || []).forEach(n => {
      const u = byName[nname(n)];
      if (!u || (s.teachers || []).includes(u.email)) return;
      ops.push([ref('subjects', s.subject_id), u]);
      s.teachers = [...(s.teachers || []), u.email];
    });
  });
  for (let i = 0; i < ops.length; i += 400) {
    const batch = F.writeBatch(db);
    ops.slice(i, i + 400).forEach(([r, u]) => batch.update(r, new F.FieldPath('teachers'), F.arrayUnion(u.email), new F.FieldPath('teacher_names', u.email), u.name || u.email));
    await commit(batch.commit());
  }
  return { linked: ops.length };
}

// ภาพรวมภาระงานครู (ผู้ดูแล)
export async function getWorkload(semester, academicYear) {
  requireAdmin();
  const [users, catalog, rooms] = await Promise.all([getUsers(), getSubjectCatalog(semester, academicYear), getRoomList(semester, academicYear)]);
  return { users, catalog, rooms };
}
// ผลการเรียนทั้งห้อง (ครูประจำชั้น: ดูได้ แก้ไม่ได้)
export async function getHomeroomGrades(key, semester, academicYear) {
  const [level, room] = str(key).split('|');
  if (!seeAll() && !isAdmin() && !(S.me.homerooms || []).includes(str(key))) throw new Error('คุณไม่ได้เป็นครูประจำชั้นของห้องนี้');
  const catalog = (await getSubjectCatalog(semester, academicYear)).filter(s => str(s.level) === level && s.rooms.includes(room));
  const subjects = [], students = {};
  const all = await Promise.all(catalog.map(s => getScoreEntryData(s.subject_id).catch(() => null)));
  for (let i = 0; i < catalog.length; i++) {
    const s = catalog[i], data = all[i];
    if (!data) continue;
    const credit = num(data.config.credit || 0);
    subjects.push({ subject_id: s.subject_id, subject_code: s.subject_code, subject_name: s.subject_name, credit, teachers: s.teachers, teacher_names: s.teacher_names });
    // วิชาที่ยังไม่มีคะแนนเลย: ยังไม่นับเกรด
    const manual = data.items.filter(i => i.category !== CATEGORIES.ATTENDANCE && i.category !== CATEGORIES.TASKS);
    const started = data.rows.some(r => manual.some(i => r.scores[i.item_id] !== '' && r.scores[i.item_id] != null));
    data.rows.filter(r => !r.room || str(r.room) === room).forEach(r => {
      const st = students[r.student_id] = students[r.student_id] || { student_id: r.student_id, first_name: r.first_name, last_name: r.last_name, grades: {}, q: 0, c: 0 };
      if (!started && (!r.status || r.status === 'NORMAL')) { st.grades[s.subject_id] = { grade: '', total: null, status: 'NORMAL' }; return; }
      st.grades[s.subject_id] = { grade: r.grade, total: r.total, status: r.status };
      if (credit > 0 && r.status === 'NORMAL' && r.grade !== '' && r.grade != null) { st.q += num(r.point || 0) * credit; st.c += credit; }
      else if (credit > 0 && r.status === 'ZERO') st.c += credit;
    });
  }
  const list = Object.values(students).map(s => ({ ...s, gpa: s.c ? s.q / s.c : null }))
    .sort((a, b) => String(a.student_id).localeCompare(String(b.student_id), 'th', { numeric: true }));
  return { level, room, subjects, students: list };
}

async function getSubject(subjectId, fresh = true) {
  const id = String(subjectId);
  if (!fresh && S.subjectCache[id]) return S.subjectCache[id];
  const d = await read(ref('subjects', id));
  if (!d) throw new Error('ไม่พบรายวิชา');
  S.subjectCache[id] = d;
  return d;
}

export async function saveSubject(subject) {
  if (!str(subject.subject_id)) requireAdmin();
  if (!str(subject.subject_name)) throw new Error('กรุณากรอกชื่อวิชา');
  const sem = str(subject.semester || S.term.sem), yr = str(subject.academic_year || S.term.yr);
  const id = str(subject.subject_id) || uid(10);
  const prev = str(subject.subject_id) ? await read(ref('subjects', id)) : null;
  const teachers = isAdmin() && Array.isArray(subject.teachers) ? subject.teachers.map(e => str(e).toLowerCase()).filter(Boolean)
    : (prev ? prev.teachers : [S.me.email]);
  const rec = Object.assign({}, prev || { config: defaultConfig(), items: {}, tasks: {} }, {
    subject_id: id, subject_code: str(subject.subject_code), subject_name: str(subject.subject_name),
    level: str(subject.level || 'ม.5'), room: str(subject.room || '1'), semester: sem, academic_year: yr,
    max_score: num(subject.max_score || 100), status: str(subject.status || 'ACTIVE'),
    teachers: teachers.length ? teachers : [S.me.email], updated_at: nowIso()
  });
  if (prev && subjRooms(prev).length > 1) { rec.room = subjRooms(prev)[0]; rec.rooms = subjRooms(prev); rec.room_keys = roomKeys(rec.level, rec.rooms); }
  else { rec.rooms = [rec.room]; rec.room_keys = roomKeys(rec.level, rec.rooms); }
  await commit(F.setDoc(ref('subjects', id), rec));
  S.subjectCache[id] = rec;
  return getSubjects(sem, yr);
}

// นำเข้ารายวิชาหลายรายการ (จากไฟล์ตารางสอน) — วิชาที่มีอยู่แล้วไม่สร้างซ้ำ คะแนน/องค์ประกอบเดิมไม่ถูกแตะต้อง
export async function importSubjects(list, opts = {}) {
  requireAdmin();
  const sem = str(opts.semester || S.term.sem), yr = str(opts.academicYear || S.term.yr);
  if (!Array.isArray(list) || !list.length) throw new Error('ไม่มีรายวิชาที่เลือก');
  const q = F.query(F.collection(db, 'subjects'), F.where('semester', '==', sem), F.where('academic_year', '==', yr));
  const current = (await F.getDocs(q)).docs.map(d => d.data()).filter(s => s.status !== 'INACTIVE');
  // จับคู่วิชาเดิมด้วย รหัส+ชื่อ+ชั้น+ห้อง (วิชาเรียนรวม: ทุกห้องที่รวม)
  const key = (s, r) => [s.subject_code, s.subject_name, s.level, r].map(str).join('|');
  const have = new Map();
  current.forEach(s => subjRooms(s).forEach(r => have.set(key(s, r), s)));
  const ops = [], toMerge = [];
  let created = 0, updated = 0, skipped = 0, merged = 0;
  list.forEach(x => {
    const rooms = [...new Set((Array.isArray(x.rooms) && x.rooms.length ? x.rooms : [x.room || '1']).map(str))].sort((p, q2) => p.localeCompare(q2, 'th', { numeric: true }));
    const rec = { subject_code: str(x.subject_code), subject_name: str(x.subject_name), level: str(x.level), room: rooms[0], rooms, room_keys: roomKeys(x.level, rooms) };
    if (!rec.subject_name || !rec.level) { skipped++; return; }
    const teachers = (x.teachers || []).map(e => str(e).toLowerCase()).filter(Boolean);
    const planned = [...new Set((x.planned_teachers || (x.planned_teacher ? [x.planned_teacher] : [])).map(str).filter(Boolean))];
    const credit = Number(x.credit) || 0;
    const prevs = [...new Set(rooms.map(r => have.get(key(rec, r))).filter(Boolean))];
    if (prevs.length) {
      if (!opts.update) { skipped++; return; }
      prevs.forEach(prev => {
        const patch = { updated_at: nowIso() };
        if (planned.length) { patch.planned_teachers = planned; patch.planned_teacher = planned[0]; }
        if (Array.isArray(x.schedule)) patch.schedule = x.schedule;
        if (credit) patch.config = Object.assign({}, prev.config || {}, { credit });
        if (teachers.length) patch.teachers = [...new Set([...(prev.teachers || []), ...teachers])];
        if (teachers.length) patch.teacher_names = Object.assign({}, prev.teacher_names || {}, x.teacher_names || {});
        ops.push([ref('subjects', prev.subject_id), patch, true]);
        Object.assign(prev, patch);
      });
      // ไฟล์บอกว่าเรียนรวม แต่ในระบบยังแยกกัน (หรือยังขาดบางห้อง) → รวมให้
      const covered = new Set(prevs.flatMap(subjRooms));
      if (rooms.length > 1 && (prevs.length > 1 || rooms.some(r => !covered.has(r)))) toMerge.push({ ids: prevs.map(p => p.subject_id), rooms });
      updated++;
      return;
    }
    const id = uid(10);
    const doc = Object.assign({ config: Object.assign(defaultConfig(), credit ? { credit } : {}), items: {}, tasks: {} }, rec, {
      subject_id: id, semester: sem, academic_year: yr, max_score: 100, status: 'ACTIVE',
      teachers, teacher_names: x.teacher_names || {}, planned_teacher: planned[0] || '', planned_teachers: planned, schedule: Array.isArray(x.schedule) ? x.schedule : [], updated_at: nowIso(), source: 'timetable'
    });
    ops.push([ref('subjects', id), doc, false]);
    rooms.forEach(r => have.set(key(rec, r), doc));
    created++;
  });
  for (let i = 0; i < ops.length; i += 400) {
    const batch = F.writeBatch(db);
    ops.slice(i, i + 400).forEach(([r, d, merge]) => merge ? batch.set(r, d, { merge: true }) : batch.set(r, d));
    await commit(batch.commit());
  }
  for (const m of toMerge) {
    try {
      if (m.ids.length > 1) await mergeSubjects(m.ids, { quiet: true });
      const s = await read(ref('subjects', m.ids[0]));
      const want = [...new Set([...subjRooms(s), ...m.rooms])].sort((p, q2) => p.localeCompare(q2, 'th', { numeric: true }));
      if (want.length !== subjRooms(s).length) await commit(F.updateDoc(ref('subjects', s.subject_id), { rooms: want, room: want[0], room_keys: roomKeys(s.level, want) }));
      merged++;
    } catch (e) { console.warn('merge on import failed', e); }
  }
  const terms = registeredTerms();
  if (!terms.includes(`${sem}/${yr}`)) await saveTerms([...terms, `${sem}/${yr}`]);
  try { await linkPlannedTeachers(sem, yr); } catch (e) {}
  return { ok: true, created, updated, skipped, merged, registeredTerms: registeredTerms(), subjects: await getSubjects(sem, yr) };
}

// ---------------------------------------------------------------------
// วิชาเรียนรวม: รวมหลายห้องเป็นวิชาเดียว / แยกห้องออก
// ---------------------------------------------------------------------
const byRoomThenCode = (a, b) => subjRooms(a)[0].localeCompare(subjRooms(b)[0], 'th', { numeric: true });
// รวมวิชา (ชั้นเดียวกัน ภาคเรียนเดียวกัน) — ข้อมูลเดิมทั้งหมดย้ายมารวมที่วิชาแรก
export async function mergeSubjects(ids, opts = {}) {
  requireAdmin();
  const list = (await Promise.all([...new Set(ids.map(String))].map(id => read(ref('subjects', id))))).filter(Boolean);
  if (list.length < 2) throw new Error('ต้องเลือกอย่างน้อย 2 วิชา');
  const L = str(list[0].level), sem = str(list[0].semester), yr = str(list[0].academic_year);
  if (list.some(s => str(s.level) !== L || str(s.semester) !== sem || str(s.academic_year) !== yr)) throw new Error('รวมได้เฉพาะวิชาชั้นเดียวกันในภาคเรียนเดียวกัน');
  list.sort(byRoomThenCode);
  const main = list[0], others = list.slice(1);
  const [sheets, atts, tbs] = await Promise.all(['scoreSheets', 'attendanceBook', 'taskBook'].map(c => Promise.all(list.map(s => read(ref(c, s.subject_id))))));
  const items = Object.assign({}, main.items || {}), tasks = Object.assign({}, main.tasks || {});
  const sheet = Object.assign({ scores: {}, statuses: {} }, sheets[0] || {}), att = Object.assign({ days: {}, log: {} }, atts[0] || {}), tb = Object.assign({ tasks: {} }, tbs[0] || {});
  sheet.scores = Object.assign({}, sheet.scores); sheet.statuses = Object.assign({}, sheet.statuses || {});
  att.days = Object.assign({}, att.days); att.log = Object.assign({}, att.log || {}); tb.tasks = Object.assign({}, tb.tasks);
  const sameItem = (p, q2) => str(p.item_name) === str(q2.item_name) && str(p.category) === str(q2.category) && !!p.is_retake === !!q2.is_retake && p.status !== 'INACTIVE';
  others.forEach((o, k) => {
    const imap = {}, tmap = {};
    Object.values(o.items || {}).forEach(it => {
      const m = Object.values(items).find(x => sameItem(x, it));
      if (m) imap[it.item_id] = m.item_id;
      else { const nid = items[it.item_id] ? uid(12) : it.item_id; items[nid] = Object.assign({}, it, { item_id: nid, subject_id: main.subject_id }); imap[it.item_id] = nid; }
    });
    Object.values(o.tasks || {}).forEach(t => {
      const m = Object.values(tasks).find(x => str(x.task_name) === str(t.task_name) && x.status !== 'INACTIVE');
      if (m) tmap[t.task_id] = m.task_id;
      else { const nid = tasks[t.task_id] ? uid(12) : t.task_id; tasks[nid] = Object.assign({}, t, { task_id: nid, subject_id: main.subject_id }); tmap[t.task_id] = nid; }
    });
    const sh = sheets[k + 1] || {};
    Object.entries(sh.scores || {}).forEach(([sid, m]) => {
      const tgt = sheet.scores[sid] = Object.assign({}, sheet.scores[sid] || {});
      Object.entries(m || {}).forEach(([iid, v]) => { tgt[imap[iid] || iid] = v; });
    });
    Object.assign(sheet.statuses, sh.statuses || {});
    const ab = atts[k + 1] || {};
    Object.entries(ab.days || {}).forEach(([d, m]) => { att.days[d] = Object.assign({}, att.days[d] || {}, m); });
    Object.assign(att.log, ab.log || {});
    const t2 = tbs[k + 1] || {};
    Object.entries(t2.tasks || {}).forEach(([tid, m]) => { const nt = tmap[tid] || tid; tb.tasks[nt] = Object.assign({}, tb.tasks[nt] || {}, m); });
  });
  const rooms = [...new Set(list.flatMap(subjRooms))].sort((p, q2) => p.localeCompare(q2, 'th', { numeric: true }));
  const planned = [...new Set(list.flatMap(s => s.planned_teachers || (s.planned_teacher ? [s.planned_teacher] : [])))];
  const mainDoc = Object.assign({}, main, {
    items, tasks, rooms, room: rooms[0], room_keys: roomKeys(L, rooms),
    teachers: [...new Set(list.flatMap(s => s.teachers || []))],
    teacher_names: Object.assign({}, ...list.map(s => s.teacher_names || {})),
    planned_teachers: planned, planned_teacher: planned[0] || '', updated_at: nowIso(),
    schedule: list.flatMap(s => s.schedule || [])
  });
  const batch = F.writeBatch(db);
  batch.set(ref('subjects', main.subject_id), mainDoc);
  batch.set(ref('scoreSheets', main.subject_id), Object.assign(sheet, { subject_id: main.subject_id }));
  batch.set(ref('attendanceBook', main.subject_id), Object.assign(att, { subject_id: main.subject_id }));
  batch.set(ref('taskBook', main.subject_id), Object.assign(tb, { subject_id: main.subject_id }));
  // วิชาที่ถูกรวม: ปิดใช้งาน (ข้อมูลเดิมยังเก็บไว้เป็นสำรอง)
  others.forEach(o => batch.update(ref('subjects', o.subject_id), { status: 'INACTIVE', merged_into: main.subject_id, updated_at: nowIso() }));
  await commit(batch.commit());
  return opts.quiet ? { ok: true, subject_id: main.subject_id } : { ok: true, subject_id: main.subject_id, subjects: await getSubjects(sem, yr) };
}

// แยกห้องออกจากวิชาเรียนรวม → ได้วิชาใหม่ของห้องนั้น พร้อมย้ายคะแนน/เช็คชื่อ/ส่งงานของนักเรียนห้องนั้นไปด้วย
export async function splitSubject(subjectId, room) {
  requireAdmin();
  const s = await read(ref('subjects', String(subjectId)));
  if (!s) throw new Error('ไม่พบรายวิชา');
  const rooms = subjRooms(s), r = str(room);
  if (rooms.length < 2 || !rooms.includes(r)) throw new Error('วิชานี้ไม่ได้เรียนรวมห้องนี้');
  const sids = new Set((await rosterStudents(s.semester, s.academic_year, s.level, r)).map(x => x.student_id));
  // รวมนักเรียนที่ปิดใช้งานแล้วด้วย เพื่อไม่ให้ข้อมูลตกค้าง
  const ro = await read(ref('rosters', rosterId(s.semester, s.academic_year, s.level, r)));
  Object.keys((ro && ro.students) || {}).forEach(k => sids.add(k));
  const [sh, ab, tb] = await Promise.all(['scoreSheets', 'attendanceBook', 'taskBook'].map(c => read(ref(c, s.subject_id))));
  const pick = (obj, keep) => { const a1 = {}, b1 = {}; Object.entries(obj || {}).forEach(([k, v]) => (keep(k) ? a1 : b1)[k] = v); return [a1, b1]; };
  const nid = uid(10);
  const [scMove, scKeep] = pick((sh || {}).scores, k => sids.has(k));
  const [stMove, stKeep] = pick((sh || {}).statuses, k => sids.has(k));
  const daysMove = {}, daysKeep = {};
  Object.entries((ab || {}).days || {}).forEach(([d, m]) => { const [mv, kp] = pick(m, k => sids.has(k)); if (Object.keys(mv).length) daysMove[d] = mv; daysKeep[d] = kp; });
  const tMove = {}, tKeep = {};
  Object.entries((tb || {}).tasks || {}).forEach(([t, m]) => { const [mv, kp] = pick(m, k => sids.has(k)); tMove[t] = mv; tKeep[t] = kp; });
  const left = rooms.filter(x => x !== r);
  const newSub = Object.assign({}, s, { subject_id: nid, room: r, rooms: [r], room_keys: roomKeys(s.level, [r]), split_from: s.subject_id, updated_at: nowIso(),
    schedule: (s.schedule || []).filter(p => !p.room || String(p.room) === r) });
  Object.values(newSub.items || {}).forEach(it => it.subject_id = nid);
  Object.values(newSub.tasks || {}).forEach(t => t.subject_id = nid);
  delete newSub.merged_into;
  const batch = F.writeBatch(db);
  batch.set(ref('subjects', nid), newSub);
  batch.update(ref('subjects', s.subject_id), { rooms: left, room: left[0], room_keys: roomKeys(s.level, left), updated_at: nowIso(),
    schedule: (s.schedule || []).filter(p => !p.room || String(p.room) !== r) });
  batch.set(ref('scoreSheets', nid), { subject_id: nid, scores: scMove, statuses: stMove });
  batch.set(ref('scoreSheets', s.subject_id), Object.assign({}, sh || {}, { subject_id: s.subject_id, scores: scKeep, statuses: stKeep }));
  batch.set(ref('attendanceBook', nid), { subject_id: nid, days: daysMove, log: (ab || {}).log || {} });
  batch.set(ref('attendanceBook', s.subject_id), Object.assign({}, ab || {}, { subject_id: s.subject_id, days: daysKeep }));
  batch.set(ref('taskBook', nid), { subject_id: nid, tasks: tMove });
  batch.set(ref('taskBook', s.subject_id), Object.assign({}, tb || {}, { subject_id: s.subject_id, tasks: tKeep }));
  await commit(batch.commit());
  return { ok: true, subject_id: nid, subjects: await getSubjects(s.semester, s.academic_year) };
}

export async function deleteSubject(subjectId, semester, academicYear) {
  await commit(F.updateDoc(ref('subjects', String(subjectId)), { status: 'INACTIVE', updated_at: nowIso() }));
  return getSubjects(semester || S.term.sem, academicYear || S.term.yr);
}

export async function setSubjectTeachers(subjectId, emails) {
  requireAdmin();
  const list = Array.from(new Set((emails || []).map(e => str(e).toLowerCase()).filter(Boolean)));
  await commit(F.updateDoc(ref('subjects', String(subjectId)), { teachers: list, updated_at: nowIso() }));
  return getSubjects(S.term.sem, S.term.yr);
}

// ---------------------------------------------------------------------
// องค์ประกอบคะแนน (เก็บใน subjects/{id}.items)
// ---------------------------------------------------------------------
export async function getScoreItems(subjectId) {
  const s = await getSubject(subjectId);
  return Object.values(s.items || {}).filter(i => i.status !== 'INACTIVE').sort((a, b) => num(a.sequence) - num(b.sequence));
}

export async function saveScoreItem(item) {
  if (!item.subject_id || !item.item_name) throw new Error('กรุณาระบุวิชาและชื่อองค์ประกอบคะแนน');
  const newScore = num(item.max_score || 0);
  const isRetake = toBool(item.is_retake);
  const items = await getScoreItems(item.subject_id);
  const currentTotal = items.filter(i => i.item_id !== item.item_id && !toBool(i.is_retake)).reduce((s, i) => s + num(i.max_score || 0), 0);
  if (!isRetake && currentTotal + newScore > 100)
    throw new Error(`ไม่สามารถบันทึกได้ เนื่องจากคะแนนเต็มของรายวิชานี้รวมกันเกิน 100 คะแนน (ปัจจุบันรวม: ${currentTotal}, เพิ่ม/แก้ไข: ${newScore})`);
  const id = str(item.item_id) || uid(12);
  const rec = {
    item_id: id, subject_id: String(item.subject_id), item_name: str(item.item_name),
    category: str(item.category || CATEGORIES.CLASSWORK), max_score: newScore,
    sequence: num(item.sequence || 1), status: str(item.status || 'ACTIVE'), is_retake: isRetake, updated_at: nowIso()
  };
  await commit(F.updateDoc(ref('subjects', String(item.subject_id)), new F.FieldPath('items', id), rec));
  return getScoreItems(item.subject_id);
}

export async function copyScoreItems(sourceSubjectId, targetSubjectId) {
  if (!sourceSubjectId || !targetSubjectId) throw new Error('กรุณาระบุวิชาต้นทางและปลายทาง');
  if (sourceSubjectId === targetSubjectId) throw new Error('วิชาต้นทางและปลายทางเป็นวิชาเดียวกัน');
  const src = await getScoreItems(sourceSubjectId);
  if (!src.length) throw new Error('วิชาต้นทางที่เลือกไม่มีองค์ประกอบคะแนน');
  const tgt = await getScoreItems(targetSubjectId);
  const tTotal = tgt.filter(i => !toBool(i.is_retake)).reduce((s, i) => s + num(i.max_score || 0), 0);
  const sTotal = src.filter(i => !toBool(i.is_retake)).reduce((s, i) => s + num(i.max_score || 0), 0);
  if (tTotal + sTotal > 100) throw new Error(`คัดลอกไม่ได้เนื่องจากคะแนนรวมจะเกิน 100 คะแนน (วิชานี้มีอยู่แล้ว ${tTotal} คะแนน, นำเข้าเพิ่ม ${sTotal} คะแนน)`);
  let maxSeq = tgt.reduce((m, i) => Math.max(m, num(i.sequence) || 0), 0);
  const args = [];
  src.forEach(it => {
    maxSeq++;
    const id = uid(12);
    args.push(new F.FieldPath('items', id), Object.assign({}, it, { item_id: id, subject_id: String(targetSubjectId), sequence: maxSeq, status: 'ACTIVE', updated_at: nowIso() }));
  });
  await commit(F.updateDoc(ref('subjects', String(targetSubjectId)), ...args));
  return getScoreItems(targetSubjectId);
}

export async function deleteScoreItem(itemId, subjectId) {
  const sid = subjectId || Object.keys(S.subjectCache).find(k => (S.subjectCache[k].items || {})[itemId]);
  if (!sid) throw new Error('ไม่พบองค์ประกอบคะแนน');
  await commit(F.updateDoc(ref('subjects', String(sid)), new F.FieldPath('items', String(itemId), 'status'), 'INACTIVE'));
  return true;
}

// ---------------------------------------------------------------------
// สัดส่วนคะแนน / ล็อก (subjects/{id}.config)
// ---------------------------------------------------------------------
const defaultConfig = () => ({ credit: 1, mode: 'WEIGHT', classwork_weight: 40, midterm_weight: 20, final_weight: 40, locked: false });

export async function getScoreConfig(subjectId) {
  const s = await getSubject(subjectId);
  return Object.assign({ subject_id: String(subjectId) }, defaultConfig(), s.config || {}, { locked: toBool((s.config || {}).locked) });
}

export async function saveScoreConfig(config) {
  if (!config || !config.subject_id) throw new Error('กรุณาเลือกวิชา');
  const prev = await getScoreConfig(config.subject_id);
  const rec = {
    credit: num(config.credit || 0), mode: str(config.mode || 'WEIGHT'),
    classwork_weight: num(config.classwork_weight || 40), midterm_weight: num(config.midterm_weight || 20),
    final_weight: num(config.final_weight || 40), locked: !!prev.locked
  };
  await commit(F.updateDoc(ref('subjects', String(config.subject_id)), { config: rec, updated_at: nowIso() }));
  return getScoreConfig(config.subject_id);
}

export async function setScoreLock(subjectId, locked) {
  await commit(F.updateDoc(ref('subjects', String(subjectId)), new F.FieldPath('config', 'locked'), !!locked));
  return getScoreConfig(subjectId);
}

// ---------------------------------------------------------------------
// สถานะ ร / มส / 0 (scoreSheets/{subjectId}.statuses)
// ---------------------------------------------------------------------
export async function saveStudentStatus(payload) {
  if (!payload || !payload.student_id || !payload.subject_id) throw new Error('ข้อมูลไม่ถูกต้อง');
  const cfg = await getScoreConfig(payload.subject_id);
  if (cfg.locked) throw new Error('คะแนนวิชานี้ถูกล็อกแล้ว ไม่สามารถแก้ไขได้ กรุณาปลดล็อกก่อน');
  const rec = { status: str(payload.status || 'NORMAL'), remark: str(payload.remark), updated_at: nowIso() };
  await commit(F.setDoc(ref('scoreSheets', String(payload.subject_id)),
    { subject_id: String(payload.subject_id), statuses: { [String(payload.student_id)]: rec } }, { merge: true }));
  return getScoreEntryData(payload.subject_id);
}

// ---------------------------------------------------------------------
// สถานะเช็คชื่อ / สถานะงาน (meta/attendanceStatuses, meta/taskStatuses)
// ---------------------------------------------------------------------
export function getAttendanceStatuses() { return S.attStatuses; }
export function getTaskStatuses() { return S.taskStatuses; }

async function saveStatusList(docId, list) {
  await commit(F.setDoc(ref('meta', docId), { list }));
}
async function upsertStatus(kind, item) {
  requireAdmin();
  if (!str(item.label)) throw new Error('กรุณากรอกชื่อสถานะ');
  const docId = kind === 'att' ? 'attendanceStatuses' : 'taskStatuses';
  const all = ((await read(ref('meta', docId))) || { list: kind === 'att' ? DEFAULT_ATT_STATUSES : DEFAULT_TASK_STATUSES }).list.slice();
  const existing = item.status_id ? all.find(s => String(s.status_id) === String(item.status_id)) : null;
  const maxSeq = all.reduce((m, s) => Math.max(m, num(s.sequence) || 0), 0);
  const id = str(item.status_id) || ((kind === 'att' ? 'CUSTOM_' : 'TASK_STAT_') + uid(8).toUpperCase());
  const raw = item.score_value;
  let sv = (raw === '' || raw == null) ? (existing ? num(existing.score_value) : 1) : num(raw);
  if (!Number.isFinite(sv)) sv = 1;
  const rec = {
    status_id: id, label: str(item.label),
    color: str(item.color || (existing ? existing.color : (kind === 'att' ? '#7F2BE3' : '#0EA968'))),
    sequence: (item.sequence !== undefined && item.sequence !== '') ? num(item.sequence) : (existing ? num(existing.sequence) : maxSeq + 1),
    status: str(item.status || 'ACTIVE'), score_value: sv
  };
  const list = existing ? all.map(s => String(s.status_id) === id ? rec : s) : all.concat([rec]);
  await saveStatusList(docId, list);
  if (kind === 'att') S.attStatuses = sortStatuses(list); else S.taskStatuses = sortStatuses(list);
  return kind === 'att' ? S.attStatuses : S.taskStatuses;
}
async function removeStatus(kind, statusId) {
  requireAdmin();
  const docId = kind === 'att' ? 'attendanceStatuses' : 'taskStatuses';
  const all = ((await read(ref('meta', docId))) || { list: [] }).list.map(s => String(s.status_id) === String(statusId) ? Object.assign({}, s, { status: 'INACTIVE' }) : s);
  await saveStatusList(docId, all);
  if (kind === 'att') S.attStatuses = sortStatuses(all); else S.taskStatuses = sortStatuses(all);
  return kind === 'att' ? S.attStatuses : S.taskStatuses;
}
export const saveAttendanceStatus = item => upsertStatus('att', item);
export const deleteAttendanceStatus = id => removeStatus('att', id);
export const saveTaskStatus = item => upsertStatus('task', item);
export const deleteTaskStatus = id => removeStatus('task', id);

// ---------------------------------------------------------------------
// เช็คชื่อรายวิชา (attendanceBook/{subjectId}.days[date][sid])
// ---------------------------------------------------------------------
export async function getAttendanceData(subjectId, date) {
  if (!subjectId) throw new Error('กรุณาเลือกวิชา');
  if (!date) throw new Error('กรุณาเลือกวันที่');
  const cleanDate = normalizeDateStr(date);
  const subject = await getSubject(subjectId);
  const [students, book, morning] = await Promise.all([
    subjectStudents(subject),
    read(ref('attendanceBook', String(subjectId))),
    subjectMorning(subject, cleanDate)
  ]);
  const day = ((book && book.days) || {})[cleanDate] || {};
  const rows = students.map(s => {
    const rec = day[s.student_id];
    const m = morning[s.student_id];
    return {
      student_id: s.student_id, first_name: s.first_name, last_name: s.last_name, room: s.room,
      status_id: rec ? String(rec.status_id) : '', remark: rec ? String(rec.remark || '') : '',
      homeroom_status: m ? String(m.status_id) : ''
    };
  });
  return { subject, date: cleanDate, statuses: S.attStatuses, defaultStatus: (S.attStatuses[0] || {}).status_id || 'PRESENT', rows };
}

export async function saveAttendance(payload) {
  if (!payload || !payload.subject_id || !payload.date || !Array.isArray(payload.rows)) throw new Error('ข้อมูลการเช็คชื่อไม่ถูกต้อง');
  const subjectId = String(payload.subject_id);
  const date = normalizeDateStr(payload.date);
  const records = {};
  payload.rows.forEach(r => { if (r.status_id) records[String(r.student_id)] = { status_id: String(r.status_id), remark: str(r.remark) }; });
  const res = await commit(F.setDoc(ref('attendanceBook', subjectId), {
    subject_id: subjectId,
    days: { [date]: records },
    log: { [date]: { by: S.me.email, at: nowIso() } }
  }, { merge: true }));
  logDaily(date, 'subjects', subjectId, { n: Object.keys(records).length, by: S.me.email, at: nowIso() });
  const data = await getAttendanceData(subjectId, date);
  data.pending = res.pending;
  return data;
}
// สรุปรายวันแบบเบา (ให้หน้าแรกของผู้ดูแลอ่านเอกสารเดียวต่อวัน)
function logDaily(date, kind, id, val) {
  try { commit(F.setDoc(ref('dailyLog', date), { date, [kind]: { [id]: val } }, { merge: true })).catch(() => {}); } catch (e) {}
}

export async function getAttendanceSummary(subjectId, preSubject, preBook, preStudents) {
  if (!subjectId) throw new Error('กรุณาเลือกวิชา');
  const subject = preSubject || await getSubject(subjectId);
  const students = preStudents || await subjectStudents(subject);
  const book = preBook !== undefined ? preBook : await read(ref('attendanceBook', String(subjectId)));
  return summarizeBook(subject, students, (book && book.days) || {}, S.attStatuses, true);
}

function summarizeBook(subject, students, days, statuses, withScore) {
  const statusMap = {}; statuses.forEach(s => statusMap[String(s.status_id)] = s);
  const allStatusMap = {};
  const history = Object.keys(days).filter(Boolean).map(date => {
    const counts = {}; let total = 0;
    Object.values(days[date] || {}).forEach(r => { const k = String(r.status_id); counts[k] = (counts[k] || 0) + 1; total++; });
    return { date, counts, total };
  }).sort((a, b) => b.date.localeCompare(a.date));

  const byStudent = {};
  students.forEach(s => byStudent[s.student_id] = { student_id: s.student_id, first_name: s.first_name, last_name: s.last_name, counts: {}, totalChecked: 0, scoreSum: 0 });
  const overallCounts = {}; let totalRecords = 0;
  Object.values(days).forEach(day => Object.entries(day || {}).forEach(([sid, r]) => {
    const k = String(r.status_id);
    overallCounts[k] = (overallCounts[k] || 0) + 1; totalRecords++;
    const st = byStudent[sid]; if (!st) return;
    st.counts[k] = (st.counts[k] || 0) + 1; st.totalChecked++;
    const sv = statusMap[k] ? num(statusMap[k].score_value) : 0;
    st.scoreSum += Number.isFinite(sv) ? sv : 0;
  }));
  const studentRows = students.map(s => {
    const st = byStudent[s.student_id];
    const attendanceScore = st.totalChecked > 0 ? Math.round((st.scoreSum / st.totalChecked) * 10 * 100) / 100 : 0;
    const presentPct = st.totalChecked > 0 ? Math.round((st.scoreSum / st.totalChecked) * 100 * 100) / 100 : 0;
    return { student_id: st.student_id, first_name: st.first_name, last_name: st.last_name, counts: st.counts, totalChecked: st.totalChecked, attendanceScore, presentPct };
  });
  const avgScore = studentRows.length ? Math.round(studentRows.reduce((a, s) => a + s.attendanceScore, 0) / studentRows.length * 100) / 100 : 0;
  return { subject, statuses, totalSessions: history.length, totalRecords, overallCounts, avgScore, history, students: studentRows };
}

// ---------------------------------------------------------------------
// เช็คชื่อประจำชั้น (homeroomBook/{rosterId}.days[date][sid])
// ---------------------------------------------------------------------
export async function getMyHomerooms(semester, academicYear) {
  const sem = str(semester || S.term.sem), yr = str(academicYear || S.term.yr);
  const rosters = await termRosters(sem, yr);
  const mine = seeAll() ? rosters : rosters.filter(r => (S.me.homerooms || []).includes(`${r.level}|${r.room}`));
  return mine.map(r => ({ roster_id: r._id, level: r.level, room: r.room, semester: sem, academic_year: yr,
    count: Object.values(r.students || {}).filter(s => s.status !== 'INACTIVE').length }))
    .sort((a, b) => (a.level + a.room).localeCompare(b.level + b.room, 'th', { numeric: true }));
}

function parseRosterId(id) {
  const [sem, yr, ...rest] = String(id).split('_');
  const room = rest.pop();
  return { sem, yr, level: rest.join('_'), room };
}

export async function getHomeroomData(rosterIdStr, date) {
  if (!rosterIdStr) throw new Error('กรุณาเลือกห้อง');
  const cleanDate = normalizeDateStr(date);
  const r = parseRosterId(rosterIdStr);
  const [students, book] = await Promise.all([rosterStudents(r.sem, r.yr, r.level, r.room), read(ref('homeroomBook', rosterIdStr))]);
  const day = ((book && book.days) || {})[cleanDate] || {};
  const rows = students.map(s => ({
    student_id: s.student_id, first_name: s.first_name, last_name: s.last_name,
    status_id: day[s.student_id] ? String(day[s.student_id].status_id) : '', remark: day[s.student_id] ? str(day[s.student_id].remark) : ''
  }));
  const subject = { subject_id: rosterIdStr, subject_name: `ประจำชั้น ${r.level}/${r.room}`, level: r.level, room: r.room, semester: r.sem, academic_year: r.yr, homeroom: true };
  return { subject, homeroom: true, roster_id: rosterIdStr, date: cleanDate, statuses: S.attStatuses, defaultStatus: (S.attStatuses[0] || {}).status_id || 'PRESENT', rows };
}

export async function saveHomeroom(payload) {
  if (!payload || !payload.roster_id || !payload.date || !Array.isArray(payload.rows)) throw new Error('ข้อมูลการเช็คชื่อไม่ถูกต้อง');
  const r = parseRosterId(payload.roster_id);
  if (!isAdmin() && !(S.me.homerooms || []).includes(`${r.level}|${r.room}`)) throw new Error('คุณไม่ได้เป็นครูประจำชั้นของห้องนี้');
  const date = normalizeDateStr(payload.date);
  const records = {};
  payload.rows.forEach(x => { if (x.status_id) records[String(x.student_id)] = { status_id: String(x.status_id), remark: str(x.remark) }; });
  const res = await commit(F.setDoc(ref('homeroomBook', payload.roster_id), {
    semester: r.sem, academic_year: r.yr, level: r.level, room: r.room,
    days: { [date]: records }, log: { [date]: { by: S.me.email, at: nowIso() } }
  }, { merge: true }));
  const absentIds = new Set(S.attStatuses.filter(s => num(s.score_value) === 0).map(s => String(s.status_id)));
  logDaily(date, 'homerooms', payload.roster_id, { n: Object.keys(records).length, absent: Object.values(records).filter(x => absentIds.has(x.status_id)).length, by: S.me.email, at: nowIso() });
  const data = await getHomeroomData(payload.roster_id, date);
  data.pending = res.pending;
  return data;
}

export async function getHomeroomSummary(rosterIdStr) {
  const r = parseRosterId(rosterIdStr);
  const [students, book] = await Promise.all([rosterStudents(r.sem, r.yr, r.level, r.room), read(ref('homeroomBook', rosterIdStr))]);
  const subject = { subject_id: rosterIdStr, subject_name: `ประจำชั้น ${r.level}/${r.room}`, level: r.level, room: r.room, homeroom: true };
  return summarizeBook(subject, students, (book && book.days) || {}, S.attStatuses, false);
}

// ---------------------------------------------------------------------
// ภาระงาน / การส่งงาน (subjects/{id}.tasks, taskBook/{subjectId}.tasks[taskId][sid])
// ---------------------------------------------------------------------
export async function getTasks(subjectId) {
  const s = await getSubject(subjectId);
  return Object.values(s.tasks || {}).filter(t => t.status !== 'INACTIVE').sort((a, b) => num(a.sequence) - num(b.sequence));
}

export async function saveTask(task) {
  if (!task.subject_id || !task.task_name) throw new Error('กรุณาระบุวิชาและชื่อภาระงาน');
  const id = str(task.task_id) || uid(12);
  const tasks = await getTasks(task.subject_id);
  const maxSeq = tasks.reduce((m, t) => Math.max(m, num(t.sequence) || 0), 0);
  const rec = {
    task_id: id, subject_id: String(task.subject_id), task_name: str(task.task_name),
    due_date: normalizeDateStr(task.due_date || ''), sequence: task.sequence ? num(task.sequence) : maxSeq + 1,
    status: str(task.status || 'ACTIVE'), updated_at: nowIso()
  };
  await commit(F.updateDoc(ref('subjects', String(task.subject_id)), new F.FieldPath('tasks', id), rec));
  return getTasks(task.subject_id);
}

export async function deleteTask(taskId, subjectId) {
  const sid = subjectId || Object.keys(S.subjectCache).find(k => (S.subjectCache[k].tasks || {})[taskId]);
  if (!sid) throw new Error('ไม่พบภาระงาน');
  await commit(F.updateDoc(ref('subjects', String(sid)), new F.FieldPath('tasks', String(taskId), 'status'), 'INACTIVE'));
  return true;
}

export async function getTaskSubmissionData(subjectId, taskId) {
  if (!subjectId) throw new Error('กรุณาเลือกวิชา');
  const subject = await getSubject(subjectId);
  const tasks = Object.values(subject.tasks || {}).filter(t => t.status !== 'INACTIVE').sort((a, b) => num(a.sequence) - num(b.sequence));
  const currentTask = taskId ? tasks.find(t => String(t.task_id) === String(taskId)) : tasks[0];
  const [students, book] = await Promise.all([
    subjectStudents(subject),
    read(ref('taskBook', String(subjectId)))
  ]);
  const map = currentTask ? (((book && book.tasks) || {})[currentTask.task_id] || {}) : {};
  const rows = students.map(s => ({
    student_id: s.student_id, first_name: s.first_name, last_name: s.last_name, room: s.room,
    status_id: map[s.student_id] ? String(map[s.student_id].status_id) : '', remark: map[s.student_id] ? str(map[s.student_id].remark) : ''
  }));
  return { subject, tasks, currentTask: currentTask || null, statuses: S.taskStatuses, defaultStatus: (S.taskStatuses[0] || {}).status_id || 'SUBMITTED', rows };
}

export async function saveTaskSubmissions(payload) {
  if (!payload || !payload.subject_id || !payload.task_id || !Array.isArray(payload.rows)) throw new Error('ข้อมูลการส่งงานไม่ถูกต้อง');
  const records = {};
  payload.rows.forEach(r => { if (r.status_id) records[String(r.student_id)] = { status_id: String(r.status_id), remark: str(r.remark) }; });
  await commit(F.setDoc(ref('taskBook', String(payload.subject_id)), {
    subject_id: String(payload.subject_id), tasks: { [String(payload.task_id)]: records }
  }, { merge: true }));
  return getTaskSubmissionData(payload.subject_id, payload.task_id);
}

export async function getTaskSummary(subjectId, maxBaseScore, preSubject, preBook, preStudents) {
  if (!subjectId) throw new Error('กรุณาเลือกวิชา');
  const subject = preSubject || await getSubject(subjectId);
  const baseMax = (maxBaseScore != null && num(maxBaseScore) > 0) ? num(maxBaseScore) : 10;
  const students = preStudents || await subjectStudents(subject);
  const book = preBook !== undefined ? preBook : await read(ref('taskBook', String(subjectId)));
  const tasks = Object.values(subject.tasks || {}).filter(t => t.status !== 'INACTIVE').sort((a, b) => num(a.sequence) - num(b.sequence));
  const statuses = S.taskStatuses;
  const statusMap = {}; statuses.forEach(s => statusMap[String(s.status_id)] = s);
  const recTasks = (book && book.tasks) || {};
  const taskIds = new Set(tasks.map(t => t.task_id));

  const taskList = tasks.map(t => {
    const counts = {}; let total = 0;
    Object.values(recTasks[t.task_id] || {}).forEach(r => { const k = String(r.status_id); counts[k] = (counts[k] || 0) + 1; total++; });
    return { task_id: t.task_id, task_name: t.task_name, due_date: t.due_date, counts, total };
  });

  const byStudent = {};
  students.forEach(s => byStudent[s.student_id] = { student_id: s.student_id, first_name: s.first_name, last_name: s.last_name, counts: {}, totalChecked: 0, scoreSum: 0 });
  const overallCounts = {}; let totalRecords = 0;
  Object.entries(recTasks).forEach(([tid, recs]) => {
    // นับเฉพาะงานของวิชานี้ (รวมงานที่ถูกลบด้วย เหมือนระบบเดิม)
    Object.entries(recs || {}).forEach(([sid, r]) => {
      const k = String(r.status_id);
      overallCounts[k] = (overallCounts[k] || 0) + 1; totalRecords++;
      const st = byStudent[sid]; if (!st) return;
      st.counts[k] = (st.counts[k] || 0) + 1; st.totalChecked++;
      const sv = statusMap[k] ? num(statusMap[k].score_value) : 0;
      st.scoreSum += Number.isFinite(sv) ? sv : 0;
    });
  });
  void taskIds;
  const totalTasks = tasks.length;
  const maxPossibleScore = totalTasks;
  const studentRows = students.map(s => {
    const st = byStudent[s.student_id];
    return {
      student_id: st.student_id, first_name: st.first_name, last_name: st.last_name, counts: st.counts, totalChecked: st.totalChecked,
      scoreSum: Math.round(st.scoreSum * 100) / 100, maxPossibleScore, baseMax,
      earnedScore: maxPossibleScore > 0 ? Math.round((st.scoreSum / maxPossibleScore) * baseMax * 100) / 100 : 0,
      taskScore: maxPossibleScore > 0 ? Math.round((st.scoreSum / maxPossibleScore) * 100 * 100) / 100 : 0
    };
  });
  const submitted = overallCounts['SUBMITTED'] || 0;
  return {
    subject, statuses, totalTasks, baseMax, totalRecords, overallCounts,
    submissionRate: totalRecords > 0 ? Math.round(submitted / totalRecords * 100) : 0,
    taskList, students: studentRows
  };
}

// ---------------------------------------------------------------------
// คะแนนและการตัดเกรด (scoreSheets/{subjectId}.scores[sid][itemId])
// ---------------------------------------------------------------------
export function getGradeRules() { return S.gradeRules; }

export async function getScoreEntryData(subjectId) {
  if (!subjectId) throw new Error('กรุณาเลือกวิชา');
  const subject = await getSubject(subjectId);
  const items = Object.values(subject.items || {}).filter(i => i.status !== 'INACTIVE').sort((a, b) => num(a.sequence) - num(b.sequence));
  const config = Object.assign({ subject_id: String(subjectId) }, defaultConfig(), subject.config || {}, { locked: toBool((subject.config || {}).locked) });
  const needAtt = items.some(i => i.category === CATEGORIES.ATTENDANCE);
  const needTask = items.some(i => i.category === CATEGORIES.TASKS);
  const [students, sheet, attBook, taskBook] = await Promise.all([
    subjectStudents(subject),
    read(ref('scoreSheets', String(subjectId))),
    needAtt ? read(ref('attendanceBook', String(subjectId))) : null,
    needTask ? read(ref('taskBook', String(subjectId))) : null
  ]);
  const scores = (sheet && sheet.scores) || {};
  const statusMap = (sheet && sheet.statuses) || {};

  const attPct = {};
  if (needAtt) (await getAttendanceSummary(subjectId, subject, attBook, students)).students.forEach(st => {
    attPct[st.student_id] = st.totalChecked > 0 ? st.attendanceScore / 10 : 0;
  });
  const taskPct = {};
  if (needTask) (await getTaskSummary(subjectId, 10, subject, taskBook, students)).students.forEach(st => {
    taskPct[st.student_id] = st.maxPossibleScore > 0 ? st.scoreSum / st.maxPossibleScore : 0;
  });

  const rows = students.map(s => {
    const itemScores = {};
    items.forEach(item => {
      if (item.category === CATEGORIES.ATTENDANCE) {
        itemScores[item.item_id] = Math.round((attPct[s.student_id] || 0) * num(item.max_score || 0) * 100) / 100;
      } else if (item.category === CATEGORIES.TASKS) {
        itemScores[item.item_id] = Math.round((taskPct[s.student_id] || 0) * num(item.max_score || 0) * 100) / 100;
      } else {
        const v = (scores[s.student_id] || {})[item.item_id];
        itemScores[item.item_id] = (v === undefined || v === null) ? '' : v;
      }
    });
    const statusInfo = statusMap[s.student_id];
    const result = calculateStudentResult(items, itemScores, config, statusInfo);
    return {
      student_id: s.student_id, first_name: s.first_name, last_name: s.last_name, room: s.room, scores: itemScores,
      total: result.total, grade: result.grade, point: result.point, status: result.status,
      remark: statusInfo ? statusInfo.remark || '' : '', breakdown: result.breakdown
    };
  });
  return { subject, items, rows, config, categories: CATEGORIES };
}

export async function saveScores(payload) {
  if (!payload || !payload.subject_id || !Array.isArray(payload.rows)) throw new Error('ข้อมูลคะแนนไม่ถูกต้อง');
  const subjectId = String(payload.subject_id);
  const config = await getScoreConfig(subjectId);
  if (config.locked) throw new Error('คะแนนวิชานี้ถูกล็อกแล้ว ไม่สามารถแก้ไขได้ กรุณาปลดล็อกก่อน');
  const items = await getScoreItems(subjectId);
  const update = {};
  payload.rows.forEach(row => {
    const sid = String(row.student_id);
    items.forEach(item => {
      if (item.category === CATEGORIES.ATTENDANCE || item.category === CATEGORIES.TASKS) return;
      const raw = row.scores ? row.scores[item.item_id] : '';
      update[sid] = update[sid] || {};
      if (raw === '' || raw === null || raw === undefined) { update[sid][item.item_id] = F.deleteField(); return; }
      const score = Number(raw);
      if (!Number.isFinite(score)) throw new Error(`คะแนนของ ${sid} ไม่เป็นตัวเลข`);
      if (score < 0 || score > num(item.max_score)) throw new Error(`คะแนน ${sid} ใน ${item.item_name} ต้องอยู่ระหว่าง 0-${item.max_score}`);
      update[sid][item.item_id] = score;
    });
  });
  await commit(F.setDoc(ref('scoreSheets', subjectId), { subject_id: subjectId, scores: update, updated_at: nowIso(), updated_by: S.me.email }, { merge: true }));
  return getScoreEntryData(subjectId);
}

export function calculateStudentResult(items, itemScores, config, statusInfo) {
  const status = statusInfo && statusInfo.status && statusInfo.status !== 'NORMAL' ? statusInfo.status : 'NORMAL';
  const breakdown = {};
  [CATEGORIES.CLASSWORK, CATEGORIES.ATTENDANCE, CATEGORIES.TASKS, CATEGORIES.MIDTERM, CATEGORIES.FINAL].forEach(cat => {
    breakdown[cat] = calculateCategoryScore(items, itemScores, cat);
  });
  if (status !== 'NORMAL') return { total: 0, grade: STATUS_LABELS[status] || status, point: 0, breakdown, status };

  const cfg = config || { classwork_weight: 40, midterm_weight: 20, final_weight: 40 };
  const cw = breakdown[CATEGORIES.CLASSWORK], at = breakdown[CATEGORIES.ATTENDANCE], tk = breakdown[CATEGORIES.TASKS];
  const totalCwRaw = (cw.raw || 0) + (at.raw || 0) + (tk.raw || 0);
  const totalCwMax = (cw.max || 0) + (at.max || 0) + (tk.max || 0);
  const effectiveCwPct = totalCwMax > 0 ? (totalCwRaw / totalCwMax) * 100 : (cw.pct || 0);
  const weighted =
    effectiveCwPct * num(cfg.classwork_weight || 0) / 100 +
    breakdown[CATEGORIES.MIDTERM].pct * num(cfg.midterm_weight || 0) / 100 +
    breakdown[CATEGORIES.FINAL].pct * num(cfg.final_weight || 0) / 100;
  const total = Math.round(weighted * 100) / 100;
  let grade = '-', point = 0;
  for (const rule of S.gradeRules) {
    if (total >= num(rule.min_score) && total <= num(rule.max_score)) { grade = rule.grade; point = num(rule.point); break; }
  }
  return { total, grade, point, breakdown, status: 'NORMAL' };
}

function calculateCategoryScore(items, itemScores, category) {
  const catItems = items.filter(i => (i.category || CATEGORIES.CLASSWORK) === category);
  const retake = catItems.filter(i => toBool(i.is_retake));
  const regular = catItems.filter(i => !toBool(i.is_retake));
  const has = v => v !== '' && v !== null && v !== undefined;
  const hasRetake = retake.some(i => has(itemScores[i.item_id]));
  const active = hasRetake ? retake : (regular.length ? regular : retake);
  let raw = 0, max = 0;
  active.forEach(i => { max += num(i.max_score) || 0; const v = itemScores[i.item_id]; if (has(v)) raw += num(v) || 0; });
  const pct = max > 0 ? (raw / max) * 100 : 0;
  return { raw, max, pct: Math.round(pct * 100) / 100 };
}

// ---------------------------------------------------------------------
// รายงาน
// ---------------------------------------------------------------------
export async function getClassSummary(subjectId) {
  const data = await getScoreEntryData(subjectId);
  const counts = { '4': 0, '3.5': 0, '3': 0, '2.5': 0, '2': 0, '1.5': 0, '1': 0, '0': 0, 'ร': 0, 'มส': 0, '-': 0 };
  let total = 0, graded = 0, normalCount = 0;
  data.rows.forEach(r => {
    const g = r.grade == null || r.grade === '' ? '-' : String(r.grade);
    if (counts[g] === undefined) counts[g] = 0;
    counts[g]++;
    if (r.status === 'NORMAL') { total += num(r.total || 0); normalCount++; if (g !== '-') graded++; }
  });
  return { subject: data.subject, items: data.items, config: data.config, students: data.rows.length, average: normalCount ? total / normalCount : 0, graded, gradeCounts: counts, rows: data.rows };
}
export const getFullClassReport = getClassSummary;

export async function getStudentGpa(studentId, semester, academicYear) {
  const subjects = (await getSubjects(semester || S.term.sem, academicYear || S.term.yr)).filter(s => s.status !== 'INACTIVE');
  const rows = []; let quality = 0, credits = 0;
  for (const subject of subjects) {
    const data = await getScoreEntryData(subject.subject_id);
    const row = data.rows.find(r => String(r.student_id) === String(studentId));
    if (!row) continue;
    const credit = num(data.config.credit || 0);
    rows.push({ subject_id: subject.subject_id, subject_name: subject.subject_name, credit, total: row.total, grade: row.grade, point: row.point, status: row.status, breakdown: row.breakdown });
    if (credit > 0 && row.status === 'NORMAL') { quality += num(row.point || 0) * credit; credits += credit; }
    else if (credit > 0 && row.status === 'ZERO') credits += credit;
  }
  return { rows, credits, gpa: credits ? quality / credits : 0 };
}

export async function getStudentFullReport(studentId, semester, academicYear) {
  const student = (await getStudents(semester, academicYear)).find(s => String(s.student_id) === String(studentId));
  if (!student) throw new Error('ไม่พบนักเรียน');
  const g = await getStudentGpa(studentId, semester, academicYear);
  return { student, rows: g.rows, credits: g.credits, gpa: g.gpa };
}

// ---------------------------------------------------------------------
// บุคลากร / สิทธิ์
// ---------------------------------------------------------------------
export async function getUsers() {
  requireAdmin();
  const snap = await F.getDocs(F.collection(db, 'users'));
  return snap.docs.map(d => Object.assign({ email: d.id }, d.data())).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'th'));
}

export async function saveUser(u) {
  requireAdmin();
  const email = str(u.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('อีเมลไม่ถูกต้อง');
  const homerooms = (Array.isArray(u.homerooms) ? u.homerooms : String(u.homerooms || '').split(','))
    .map(x => str(x)).filter(Boolean)
    .map(x => { const m = x.match(/^(.+?)\s*[\/|]\s*(.+)$/); return m ? `${m[1].trim()}|${m[2].trim()}` : null; })
    .filter(Boolean);
  if (email === S.me.email && u.role !== 'admin' && email !== BOOTSTRAP_ADMIN.toLowerCase()) throw new Error('ไม่สามารถถอดสิทธิ์ผู้ดูแลของตนเองได้');
  const rec = { email, name: str(u.name) || email, role: u.role === 'admin' ? 'admin' : 'teacher', active: u.active !== false, homerooms, updatedAt: nowIso() };
  await commit(F.setDoc(ref('users', email), rec, { merge: true }));
  if (email === S.me.email) S.me.homerooms = homerooms;
  return getUsers();
}

export async function deleteUser(email) {
  requireAdmin();
  const e = str(email).toLowerCase();
  if (e === S.me.email || e === BOOTSTRAP_ADMIN.toLowerCase()) throw new Error('ลบบัญชีของตนเอง/ผู้ดูแลคนแรกไม่ได้');
  await commit(F.deleteDoc(ref('users', e)));
  return getUsers();
}

// ---------------------------------------------------------------------
// ย้ายข้อมูลจาก Google Sheets เดิม (ไฟล์ .xlsx ที่ดาวน์โหลดจากชีต)
// ---------------------------------------------------------------------
export async function importLegacyWorkbook(sheets, opts = {}) {
  requireAdmin();
  const log = [];
  const rowsOf = name => {
    const raw = sheets[name] || [];
    if (raw.length < 2) return [];
    const headers = raw[0].map(h => str(h));
    return raw.slice(1).map(r => { const o = {}; headers.forEach((h, i) => o[h] = r[i] === undefined ? '' : r[i]); return o; })
      .filter(o => Object.values(o).some(v => v !== ''));
  };
  const isTermPart = v => /^\d{1,2}$/.test(str(v));
  const isYear = v => /^\d{4}$/.test(str(v));
  const ACT = new Set(['ACTIVE', 'INACTIVE']);

  // ---- ตั้งค่า / ภาคเรียน ----
  const settingsRows = rowsOf('Settings');
  const st = {}; settingsRows.forEach(r => st[str(r.key)] = r.value);
  let terms = [];
  try { terms = JSON.parse(st.REGISTERED_TERMS || '[]'); } catch (e) { terms = String(st.REGISTERED_TERMS || '').split(',').map(x => x.trim()).filter(Boolean); }
  const curSem = str(st.CURRENT_SEMESTER || '1'), curYr = str(st.CURRENT_YEAR || '2569');
  if (!terms.includes(`${curSem}/${curYr}`)) terms.push(`${curSem}/${curYr}`);

  // ---- นักเรียน (จัดเป็นห้อง) — เลียนแบบการกรองของระบบเดิม ----
  const rosters = {}; const secrets = {}; let stuCount = 0, stuSkipped = 0;
  rowsOf('Students').forEach(r => {
    let status = str(r.status), sem = str(r.semester), yr = str(r.academic_year);
    // แถวที่คอลัมน์เลื่อน (ระบบเดิมมองไม่เห็นแถวเหล่านี้) → ข้าม
    if (!ACT.has(status) && status !== '') { stuSkipped++; return; }
    if (status === 'INACTIVE') return;
    const sid = str(r.student_id); if (!sid) return;
    if ((sem && !isTermPart(sem)) || (yr && !isYear(yr))) { stuSkipped++; return; }
    const targetTerms = (!sem || !yr) ? terms.map(t => t.split('/')).filter(([s, y]) => (!sem || s === sem) && (!yr || y === yr)) : [[sem, yr]];
    targetTerms.forEach(([s, y]) => {
      const id = rosterId(s, y, r.class_level, r.room);
      rosters[id] = rosters[id] || { semester: s, academic_year: y, level: str(r.class_level), room: str(r.room), students: {} };
      if (!rosters[id].students[sid]) stuCount++;
      rosters[id].students[sid] = { student_id: sid, first_name: str(r.first_name), last_name: str(r.last_name), status: 'ACTIVE' };
    });
  });
  log.push(`นักเรียน ${stuCount} รายการ ใน ${Object.keys(rosters).length} ห้อง` + (stuSkipped ? ` (ข้ามแถวที่ข้อมูลไม่สมบูรณ์ ${stuSkipped} แถว)` : ''));

  // ---- รายวิชา + สัดส่วน + องค์ประกอบ + งาน ----
  const subjects = {};
  rowsOf('Subjects').forEach(r => {
    if (str(r.status) === 'INACTIVE') return;
    const id = str(r.subject_id); if (!id) return;
    subjects[id] = {
      subject_id: id, subject_code: str(r.subject_code), subject_name: str(r.subject_name), level: str(r.level), room: str(r.room),
      semester: str(r.semester || '1'), academic_year: str(r.academic_year || '2569'), max_score: num(r.max_score || 100), status: 'ACTIVE',
      teachers: [opts.teacherEmail || S.me.email], config: defaultConfig(), items: {}, tasks: {}, updated_at: nowIso()
    };
  });
  rowsOf('ScoreConfig').forEach(r => {
    const s = subjects[str(r.subject_id)]; if (!s) return;
    s.config = { credit: num(r.credit || 0), mode: str(r.mode || 'WEIGHT'), classwork_weight: num(r.classwork_weight || 40), midterm_weight: num(r.midterm_weight || 20), final_weight: num(r.final_weight || 40), locked: toBool(r.locked) };
  });
  let itemCount = 0;
  rowsOf('ScoreItems').forEach(r => {
    if (str(r.status) === 'INACTIVE') return;
    const s = subjects[str(r.subject_id)]; if (!s) return;
    const id = str(r.item_id) || uid(12);
    s.items[id] = { item_id: id, subject_id: s.subject_id, item_name: str(r.item_name), category: str(r.category || CATEGORIES.CLASSWORK), max_score: num(r.max_score || 0), sequence: num(r.sequence || 1), status: 'ACTIVE', is_retake: toBool(r.is_retake), updated_at: nowIso() };
    itemCount++;
  });
  let taskCount = 0;
  rowsOf('Tasks').forEach(r => {
    if (str(r.status) === 'INACTIVE') return;
    const s = subjects[str(r.subject_id)]; if (!s) return;
    const id = str(r.task_id) || uid(12);
    s.tasks[id] = { task_id: id, subject_id: s.subject_id, task_name: str(r.task_name), due_date: normalizeDateStr(r.due_date), sequence: num(r.sequence || 1), status: 'ACTIVE', updated_at: nowIso() };
    taskCount++;
  });
  log.push(`รายวิชา ${Object.keys(subjects).length} วิชา, องค์ประกอบคะแนน ${itemCount}, ภาระงาน ${taskCount}`);

  // ---- คะแนน / สถานะ ร มส ----
  const sheetsOut = {}; let scoreCount = 0;
  rowsOf('Scores').forEach(r => {
    const s = subjects[str(r.subject_id)]; if (!s) return;
    if (!s.items[str(r.item_id)]) return;
    if (r.score === '' || r.score === null) return;
    const v = Number(r.score); if (!Number.isFinite(v)) return;
    const sh = sheetsOut[s.subject_id] = sheetsOut[s.subject_id] || { subject_id: s.subject_id, scores: {}, statuses: {} };
    (sh.scores[str(r.student_id)] = sh.scores[str(r.student_id)] || {})[str(r.item_id)] = v;
    scoreCount++;
  });
  rowsOf('StudentStatus').forEach(r => {
    const s = subjects[str(r.subject_id)]; if (!s) return;
    const sh = sheetsOut[s.subject_id] = sheetsOut[s.subject_id] || { subject_id: s.subject_id, scores: {}, statuses: {} };
    sh.statuses[str(r.student_id)] = { status: str(r.status || 'NORMAL'), remark: str(r.remark), updated_at: nowIso() };
  });
  log.push(`คะแนน ${scoreCount} รายการ`);

  // ---- เช็คชื่อ / ส่งงาน ----
  const attOut = {}; let attCount = 0;
  rowsOf('Attendance').forEach(r => {
    const s = subjects[str(r.subject_id)]; if (!s) return;
    const d = normalizeDateStr(r.date); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const b = attOut[s.subject_id] = attOut[s.subject_id] || { subject_id: s.subject_id, days: {} };
    (b.days[d] = b.days[d] || {})[str(r.student_id)] = { status_id: str(r.status_id), remark: str(r.remark) };
    attCount++;
  });
  const taskOut = {}; let subCount = 0;
  rowsOf('TaskSubmissions').forEach(r => {
    const s = subjects[str(r.subject_id)]; if (!s) return;
    const b = taskOut[s.subject_id] = taskOut[s.subject_id] || { subject_id: s.subject_id, tasks: {} };
    (b.tasks[str(r.task_id)] = b.tasks[str(r.task_id)] || {})[str(r.student_id)] = { status_id: str(r.status_id), remark: str(r.remark) };
    subCount++;
  });
  log.push(`เช็คชื่อ ${attCount} รายการ, การส่งงาน ${subCount} รายการ`);

  // ---- สถานะ / เกณฑ์เกรด ----
  const statusList = name => rowsOf(name).filter(r => str(r.status_id)).map(r => ({
    status_id: str(r.status_id), label: str(r.label), color: str(r.color || '#7F2BE3'), sequence: num(r.sequence || 1),
    status: str(r.status || 'ACTIVE'), score_value: (r.score_value === '' || r.score_value == null) ? 0 : num(r.score_value)
  }));
  const attStatuses = statusList('AttendanceStatuses');
  const taskStatuses = statusList('TaskStatuses');
  const gradeRules = rowsOf('GradeRules').filter(r => r.min_score !== '').map(r => ({ min_score: num(r.min_score), max_score: num(r.max_score), grade: str(r.grade), point: num(r.point) }));

  if (opts.dryRun) return { ok: true, dryRun: true, log };

  // ---- เขียนลง Firestore เป็นก้อน (ไม่เกิน 400 รายการต่อก้อน) ----
  const ops = [];
  ops.push([ref('meta', 'settings'), { SCHOOL_NAME: str(st.SCHOOL_NAME) || (S.settings && S.settings.SCHOOL_NAME) || '', CURRENT_SEMESTER: curSem, CURRENT_YEAR: curYr, REGISTERED_TERMS: terms }, true]);
  if (gradeRules.length) ops.push([ref('meta', 'gradeRules'), { list: gradeRules }, false]);
  if (attStatuses.length) ops.push([ref('meta', 'attendanceStatuses'), { list: attStatuses }, false]);
  if (taskStatuses.length) ops.push([ref('meta', 'taskStatuses'), { list: taskStatuses }, false]);
  Object.entries(rosters).forEach(([id, r]) => ops.push([ref('rosters', id), r, false]));
  Object.entries(secrets).forEach(([id, c]) => ops.push([ref('rosterSecrets', id), { citizen: c }, false]));
  Object.values(subjects).forEach(s => ops.push([ref('subjects', s.subject_id), s, false]));
  Object.values(sheetsOut).forEach(sh => ops.push([ref('scoreSheets', sh.subject_id), Object.assign(sh, { updated_at: nowIso() }), false]));
  Object.values(attOut).forEach(b => ops.push([ref('attendanceBook', b.subject_id), b, false]));
  Object.values(taskOut).forEach(b => ops.push([ref('taskBook', b.subject_id), b, false]));
  for (let i = 0; i < ops.length; i += 400) {
    const batch = F.writeBatch(db);
    ops.slice(i, i + 400).forEach(([r, data, merge]) => merge ? batch.set(r, data, { merge: true }) : batch.set(r, data));
    await batch.commit();
  }
  log.push(`เขียนข้อมูลแล้ว ${ops.length} เอกสาร`);
  await loadMeta();
  return { ok: true, log };
}

// ให้หน้าเว็บ (สคริปต์ปกติ) เรียกใช้ได้
export const _state = S;


// =====================================================================
// หน้าแรก (Dashboard)
// =====================================================================
export function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const absentStatusIds = () => new Set(S.attStatuses.filter(s => num(s.score_value) === 0).map(s => String(s.status_id)));
const lateStatusIds = () => new Set(S.attStatuses.filter(s => num(s.score_value) > 0 && num(s.score_value) < 1).map(s => String(s.status_id)));

// ครูผู้สอน: คาบวันนี้ งานค้าง นักเรียนที่ต้องติดตาม สรุปรายวิชา
export async function getTeacherDashboard() {
  const today = localDate(), dow = new Date().getDay();
  const subjects = (await getSubjects(S.term.sem, S.term.yr)).filter(s => s.status !== 'INACTIVE' && (seeAll() ? true : mySubject(s)));
  const absent = absentStatusIds();
  const out = await Promise.all(subjects.map(async s => {
    const id = String(s.subject_id);
    try {
      const subject = await getSubject(id);
      const [students, attBook, taskBook, sheet] = await Promise.all([
        subjectStudents(subject), read(ref('attendanceBook', id)), read(ref('taskBook', id)), read(ref('scoreSheets', id))
      ]);
      const days = (attBook && attBook.days) || {};
      const todayRec = days[today] || {};
      const att = summarizeBook(subject, students, days, S.attStatuses, true);
      const items = Object.values(subject.items || {}).filter(i => i.status !== 'INACTIVE' && !toBool(i.is_retake) && i.category !== CATEGORIES.ATTENDANCE && i.category !== CATEGORIES.TASKS)
        .sort((a, b) => num(a.sequence) - num(b.sequence));
      const scores = (sheet && sheet.scores) || {}, sts = (sheet && sheet.statuses) || {};
      const normal = students.filter(st => !sts[st.student_id] || !sts[st.student_id].status || sts[st.student_id].status === 'NORMAL');
      const itemProgress = items.map(i => {
        const filled = normal.filter(st => { const v = (scores[st.student_id] || {})[i.item_id]; return v !== undefined && v !== null && v !== ''; }).length;
        return { item_id: i.item_id, item_name: i.item_name, category: i.category, filled, missing: normal.length - filled };
      });
      const tasks = Object.values(subject.tasks || {}).filter(t => t.status !== 'INACTIVE');
      const recs = (taskBook && taskBook.tasks) || {};
      const taskMissing = tasks.map(t => {
        const r = recs[t.task_id] || {};
        const miss = students.filter(st => !r[st.student_id] || String(r[st.student_id].status_id) === 'MISSING').length;
        return { task_id: t.task_id, task_name: t.task_name, due_date: t.due_date || '', missing: miss };
      }).filter(t => t.missing > 0).sort((a, b) => b.missing - a.missing);
      // เกรด (เฉพาะเมื่อมีคะแนนแล้ว)
      let grades = null, gradeRows = [];
      if (itemProgress.some(p => p.filled > 0)) {
        const data = await getScoreEntryData(id);
        gradeRows = data.rows;
        grades = {};
        data.rows.forEach(r => { const g = r.status && r.status !== 'NORMAL' ? (STATUS_LABELS[r.status] || r.status) : String(r.grade); grades[g] = (grades[g] || 0) + 1; });
      }
      const gradeOf = Object.fromEntries(gradeRows.map(r => [r.student_id, r]));
      const watch = [];
      att.students.forEach(st => {
        const reasons = [];
        const nAbs = Object.entries(st.counts).filter(([k]) => absent.has(k)).reduce((t, [, n]) => t + n, 0);
        if (nAbs >= 3) reasons.push(`ขาด ${nAbs} ครั้ง`);
        if (st.totalChecked >= 5 && st.presentPct < 80) reasons.push(`มาเรียน ${Math.round(st.presentPct)}% (เสี่ยง มส)`);
        const g = gradeOf[st.student_id];
        if (g && g.status && g.status !== 'NORMAL') reasons.push(`สถานะ ${STATUS_LABELS[g.status] || g.status}`);
        else if (g && String(g.grade) === '0' && itemProgress.every(p => p.missing === 0) && items.length) reasons.push('เกรด 0');
        const nMiss = taskMissing.length ? tasks.filter(t => { const r = recs[t.task_id] || {}; return !r[st.student_id] || String(r[st.student_id].status_id) === 'MISSING'; }).length : 0;
        if (tasks.length >= 2 && nMiss >= Math.max(2, Math.ceil(tasks.length / 2))) reasons.push(`ค้างงาน ${nMiss}/${tasks.length}`);
        if (reasons.length) {
          const stu = students.find(x => x.student_id === st.student_id) || {};
          watch.push({ student_id: st.student_id, first_name: st.first_name, last_name: st.last_name, room: stu.room, reasons });
        }
      });
      const periods = (subject.schedule || []).filter(p => Number(p.day) === dow).sort((a, b) => a.period - b.period);
      return {
        subject_id: id, subject_code: s.subject_code, subject_name: s.subject_name, level: s.level, rooms: subjRooms(subject),
        students: students.length, periods, scheduled: (subject.schedule || []).length > 0, checkedToday: Object.keys(todayRec).length,
        sessions: att.totalSessions, attendancePct: att.students.some(x => x.totalChecked) ? Math.round(att.students.reduce((t, x) => t + (x.totalChecked ? x.presentPct : 0), 0) / att.students.filter(x => x.totalChecked).length) : null,
        items: itemProgress, itemsTotal: items.length, taskMissing: taskMissing.slice(0, 3), tasksTotal: tasks.length,
        scoreFilled: itemProgress.reduce((t, p) => t + p.filled, 0), scoreSlots: items.length * normal.length,
        grades, watch, locked: toBool((subject.config || {}).locked)
      };
    } catch (e) { return { subject_id: id, subject_code: s.subject_code, subject_name: s.subject_name, level: s.level, rooms: subjRooms(s), error: String(e.message || e) }; }
  }));
  return { today, dow, subjects: out };
}

// ครูประจำชั้น: สรุปห้องวันนี้ + นักเรียนขาดบ่อย
export async function getHomeroomDashboard() {
  const today = localDate();
  const keys = seeAll() ? [] : (S.me.homerooms || []);
  const absent = absentStatusIds(), late = lateStatusIds();
  const rooms = await Promise.all(keys.map(async key => {
    const [level, room] = key.split('|');
    const rid = rosterId(S.term.sem, S.term.yr, level, room);
    const [students, book] = await Promise.all([rosterStudents(S.term.sem, S.term.yr, level, room), read(ref('homeroomBook', rid)).catch(() => null)]);
    const days = (book && book.days) || {};
    const t = days[today] || {};
    const counts = {};
    Object.values(t).forEach(r => { counts[r.status_id] = (counts[r.status_id] || 0) + 1; });
    const per = {};
    Object.values(days).forEach(d => Object.entries(d || {}).forEach(([sid, r]) => {
      const p = per[sid] = per[sid] || { abs: 0, late: 0 };
      if (absent.has(String(r.status_id))) p.abs++; else if (late.has(String(r.status_id))) p.late++;
    }));
    const watch = students.map(s => ({ ...s, ...(per[s.student_id] || { abs: 0, late: 0 }) }))
      .filter(s => s.abs >= 3 || s.late >= 5).sort((a, b) => b.abs - a.abs || b.late - a.late).slice(0, 10);
    return { key, level, room, roster_id: rid, students: students.length, checked: Object.keys(t).length, counts, days: Object.keys(days).length, watch };
  }));
  return { today, rooms, statuses: S.attStatuses };
}

// ผู้ดูแลระบบ: ภาพรวมทั้งโรงเรียน
export async function getAdminDashboard() {
  requireAdmin();
  const today = localDate(), dow = new Date().getDay();
  const [users, catalog, rosters, daily] = await Promise.all([
    getUsers(), getSubjectCatalog(S.term.sem, S.term.yr), termRosters(S.term.sem, S.term.yr), F.getDoc(ref('dailyLog', today)).then(d => d.exists() ? d.data() : {}).catch(() => ({}))
  ]);
  const active = users.filter(u => u.active !== false);
  const known = new Set(active.map(u => nname(u.name)));
  const roomList = rosters.map(r => ({ key: `${r.level}|${r.room}`, level: r.level, room: r.room, roster_id: r._id, count: Object.values(r.students || {}).filter(s => s.status !== 'INACTIVE').length }))
    .filter(r => r.count > 0).sort((a, b) => (a.level + '/' + a.room).localeCompare(b.level + '/' + b.room, 'th', { numeric: true }));
  const hrKeys = new Set(active.flatMap(u => u.homerooms || []));
  const doneSub = (daily && daily.subjects) || {}, doneHr = (daily && daily.homerooms) || {};
  // วิชาที่มีคาบวันนี้ (ถ้าไม่มีตารางสอน ใช้ทุกวิชา)
  const hasSchedule = catalog.some(s => (s.schedule || []).length);
  const todaySubs = catalog.filter(s => !hasSchedule || (s.schedule || []).some(p => Number(p.day) === dow));
  const byTeacher = {};
  todaySubs.forEach(s => {
    const ts = s.teachers.length ? s.teachers : [''];
    ts.forEach(e => {
      const t = byTeacher[e] = byTeacher[e] || { email: e, name: e ? ((active.find(u => u.email === e) || {}).name || (s.teacher_names || {})[e] || e) : 'ยังไม่มีครู', done: [], todo: [] };
      (doneSub[s.subject_id] ? t.done : t.todo).push({ subject_id: s.subject_id, label: `${s.subject_code || ''} ${s.subject_name} ${s.level}/${s.rooms.join('+')}`, periods: (s.schedule || []).filter(p => Number(p.day) === dow).map(p => p.period) });
    });
  });
  // แผนที่ความร้อน: ขาดเรียนตอนเช้า (ห้อง × วัน) จากการเช็คชื่อประจำชั้น 10 วันล่าสุด
  const absent = absentStatusIds();
  const books = await Promise.all(roomList.map(r => read(ref('homeroomBook', r.roster_id)).catch(() => null)));
  const allDates = [...new Set(books.flatMap(b => Object.keys((b && b.days) || {})))].sort().slice(-10);
  const heat = roomList.map((r, i) => ({ key: r.key, count: r.count, cells: allDates.map(d => {
    const day = ((books[i] && books[i].days) || {})[d];
    return day ? Object.values(day).filter(x => absent.has(String(x.status_id))).length : null;
  }) }));
  const plannedMissing = [...new Set(catalog.flatMap(s => (s.planned_teachers || []).filter(n => !known.has(nname(n)))))];
  return {
    today, dow, hasSchedule,
    counts: { students: roomList.reduce((t, r) => t + r.count, 0), rooms: roomList.length, subjects: catalog.length, teachers: active.length },
    todaySubjects: todaySubs.length, todayDone: todaySubs.filter(s => doneSub[s.subject_id]).length,
    teachers: Object.values(byTeacher).sort((a, b) => b.todo.length - a.todo.length || a.name.localeCompare(b.name, 'th')),
    homeroomToday: roomList.map(r => ({ key: r.key, done: !!doneHr[r.roster_id], absent: doneHr[r.roster_id] ? doneHr[r.roster_id].absent : null, hasTeacher: hrKeys.has(r.key) })),
    issues: {
      noTeacher: catalog.filter(s => !s.teachers.length).length,
      plannedMissing,
      roomsNoHomeroom: roomList.filter(r => !hrKeys.has(r.key)).map(r => r.key),
      weightNot100: catalog.filter(s => Math.round(s.item_total) !== 100).length,
      noItems: catalog.filter(s => !s.item_count).length
    },
    heat: { dates: allDates, rows: heat }
  };
}
