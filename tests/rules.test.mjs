// ทดสอบกฎความปลอดภัย Firestore บน emulator (รันใน GitHub Actions ก่อน deploy)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, deleteField, FieldPath } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-classhub',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
});
const A = 'admin@ppj.ac.th', T1 = 't1@ppj.ac.th', T2 = 't2@ppj.ac.th', HR = 'hr@ppj.ac.th';
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'users', A), { role: 'admin', active: true, homerooms: [] });
  await setDoc(doc(db, 'users', T1), { role: 'teacher', active: true, homerooms: [] });
  await setDoc(doc(db, 'users', T2), { role: 'teacher', active: true, homerooms: [] });
  await setDoc(doc(db, 'users', HR), { role: 'teacher', active: true, homerooms: ['ม.4|1'] });
  await setDoc(doc(db, 'subjects', 'S1'), { subject_id: 'S1', level: 'ม.4', room: '1', semester: '2', academic_year: '2569', teachers: [T1], teacher_names: { [T1]: 'ครู 1' }, config: { locked: false } });
  await setDoc(doc(db, 'subjects', 'S2'), { subject_id: 'S2', level: 'ม.5', room: '1', semester: '2', academic_year: '2569', teachers: [], teacher_names: {}, config: { locked: false } });
  await setDoc(doc(db, 'subjects', 'S3'), { subject_id: 'S3', level: 'ม.4', room: '2', rooms: ['2', '1'], room_keys: ['ม.4|2', 'ม.4|1'], semester: '2', academic_year: '2569', teachers: [T2], config: {} });
  await setDoc(doc(db, 'scoreSheets', 'S3'), { scores: {} });
  await setDoc(doc(db, 'scoreSheets', 'S1'), { scores: {} });
  await setDoc(doc(db, 'scoreSheets', 'S2'), { scores: {} });
  await setDoc(doc(db, 'attendanceBook', 'S1'), { days: {} });
});
const as = e => env.authenticatedContext(e.split('@')[0], { email: e, email_verified: true }).firestore();
let fails = 0;
async function t(name, p) { try { await p; console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } }

await t('teacher reads subject catalog', assertSucceeds(getDoc(doc(as(T2), 'subjects', 'S1'))));
await t('stranger cannot read subjects', assertFails(getDoc(doc(as('x@gmail.com'), 'subjects', 'S1'))));
await t('teacher cannot read other teacher scores', assertFails(getDoc(doc(as(T2), 'scoreSheets', 'S1'))));
await t('homeroom teacher reads scores of own room', assertSucceeds(getDoc(doc(as(HR), 'scoreSheets', 'S1'))));
await t('homeroom teacher reads attendance of own room', assertSucceeds(getDoc(doc(as(HR), 'attendanceBook', 'S1'))));
await t('homeroom teacher cannot write scores', assertFails(setDoc(doc(as(HR), 'scoreSheets', 'S1'), { scores: { a: 1 } }, { merge: true })));
await t('homeroom teacher cannot read other room scores', assertFails(getDoc(doc(as(HR), 'scoreSheets', 'S2'))));
await t('teacher cannot claim a subject (admin only)', assertFails(updateDoc(doc(as(T2), 'subjects', 'S2'), new FieldPath('teachers'), arrayUnion(T2), new FieldPath('teacher_names', T2), 'ครู 2')));
await t('teacher cannot add someone else', assertFails(updateDoc(doc(as(T2), 'subjects', 'S2'), new FieldPath('teachers'), arrayUnion(T1))));
await t('teacher cannot remove another teacher', assertFails(updateDoc(doc(as(T2), 'subjects', 'S1'), new FieldPath('teachers'), arrayRemove(T1), new FieldPath('teacher_names', T1), deleteField())));
await t('teacher cannot change level while claiming', assertFails(updateDoc(doc(as(T2), 'subjects', 'S1'), { teachers: arrayUnion(T2), level: 'ม.6' })));
await t('teacher cannot leave subject (admin only)', assertFails(updateDoc(doc(as(T1), 'subjects', 'S1'), new FieldPath('teachers'), arrayRemove(T1), new FieldPath('teacher_names', T1), deleteField())));
await t('subject teacher edits config', assertSucceeds(updateDoc(doc(as(T1), 'subjects', 'S1'), { 'config.credit': 1.5 })));
await t('subject teacher cannot move subject to another room', assertFails(updateDoc(doc(as(T1), 'subjects', 'S1'), { room: '2' })));
await t('teacher cannot create subject', assertFails(setDoc(doc(as(T1), 'subjects', 'S9'), { subject_id: 'S9', teachers: [T1] })));
await t('admin creates subject', assertSucceeds(setDoc(doc(as(A), 'subjects', 'S9'), { subject_id: 'S9', teachers: [] })));
await t('admin assigns any teacher', assertSucceeds(updateDoc(doc(as(A), 'subjects', 'S9'), { teachers: arrayUnion(T1) })));
await t('teacher cannot pick own homeroom (admin only)', assertFails(updateDoc(doc(as(T2), 'users', T2), { homerooms: arrayUnion('ม.5|1') })));
await t('teacher cannot make self admin', assertFails(updateDoc(doc(as(T2), 'users', T2), { role: 'admin' })));
await t('teacher cannot edit another user', assertFails(updateDoc(doc(as(T2), 'users', T1), { homerooms: arrayUnion('ม.5|1') })));
await t('admin edits user homerooms', assertSucceeds(updateDoc(doc(as(A), 'users', T1), { homerooms: arrayUnion('ม.6|1') })));
await t('homeroom teacher reads combined subject that includes own room', assertSucceeds(getDoc(doc(as(HR), 'scoreSheets', 'S3'))));
await t('teacher cannot change rooms of combined subject', assertFails(updateDoc(doc(as(T2), 'subjects', 'S3'), { rooms: ['2'] })));
await t('subject teacher writes scores', assertSucceeds(setDoc(doc(as(T1), 'scoreSheets', 'S1'), { scores: { a: 1 } }, { merge: true })));

await env.cleanup();
console.log(fails ? `${fails} rule test(s) failed` : 'all rule tests passed');
process.exit(fails ? 1 : 0);
