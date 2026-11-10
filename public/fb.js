// ตัวเชื่อม Firebase SDK (เปลี่ยนเวอร์ชันได้ที่เดียว)
const V = '12.0.0';
const appMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const authMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const fsMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
import { firebaseConfig } from './config.js';

export const app = appMod.initializeApp(firebaseConfig);
export const auth = authMod.getAuth(app);

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
  writeBatch, serverTimestamp, deleteField, FieldPath, onSnapshot
} = fsMod;
