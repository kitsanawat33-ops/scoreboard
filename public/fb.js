// ตัวเชื่อม Firebase SDK (เปลี่ยนเวอร์ชันได้ที่เดียว)
const V = '12.0.0';
// โหลด 3 ส่วนพร้อมกัน (เร็วกว่าโหลดทีละส่วน)
const [appMod, authMod, fsMod] = await Promise.all([
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
]);
import { firebaseConfig, SAME_DOMAIN_AUTH } from './config.js';

// โดเมนสำหรับหน้าล็อกอิน: ถ้าเปิดใช้ ให้ใช้โดเมนเดียวกับที่เปิดแอป (Firebase Hosting มี /__/auth/ ให้ทุกโดเมน)
const HOSTS = ['ppj-scoreboard.web.app', 'ppj-scoreboard.firebaseapp.com'];
// วิธีสำรอง: ผู้ใช้กด "ลองวิธีสำรอง" ที่หน้าล็อกอิน → กลับไปใช้โดเมน firebaseapp.com แบบเดิม
let legacy = false; try { legacy = localStorage.getItem('classhub_auth_legacy') === '1'; } catch (e) {}
export const authDomain = (SAME_DOMAIN_AUTH && !legacy && HOSTS.includes(location.hostname)) ? location.hostname : firebaseConfig.authDomain;
export const redirectOk = authDomain === location.hostname;
export const app = appMod.initializeApp(Object.assign({}, firebaseConfig, { authDomain }));
// จำการเข้าสู่ระบบไว้ในเครื่องแบบถาวร (ไม่ต้องล็อกอินใหม่ทุกครั้งที่รีเฟรช/เปิดแอป)
let authInst;
try {
  authInst = authMod.initializeAuth(app, {
    persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
    popupRedirectResolver: authMod.browserPopupRedirectResolver
  });
} catch (e) {
  authInst = authMod.getAuth(app);
}
export const auth = authInst;

// เก็บข้อมูลไว้ในเครื่อง (IndexedDB) — เปิดแอปซ้ำเร็วขึ้น และใช้ต่อได้ตอนเน็ตหลุด
// การบันทึกตอนออฟไลน์จะเข้าคิวในเครื่องและส่งเองเมื่อกลับมาออนไลน์
let dbInst;
try {
  dbInst = fsMod.initializeFirestore(app, {
    localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
  });
} catch (e) {
  dbInst = fsMod.getFirestore(app);
}
export const db = dbInst;

export const {
  onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
} = authMod;

export const {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where,
  writeBatch, serverTimestamp, deleteField, FieldPath, onSnapshot, arrayUnion, arrayRemove
} = fsMod;
