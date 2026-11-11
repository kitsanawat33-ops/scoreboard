// ค่าเชื่อมต่อ Firebase ของ ScoreBoard (โปรเจกต์ ppj-scoreboard) — ไม่ใช่รหัสลับ ความปลอดภัยอยู่ที่ firestore.rules
export const firebaseConfig = {
  apiKey: "AIzaSyA2ObmIiQ6qGSXVGYVVVSQTsefjG7Y2kw8",
  authDomain: "ppj-scoreboard.firebaseapp.com",
  projectId: "ppj-scoreboard",
  storageBucket: "ppj-scoreboard.firebasestorage.app",
  messagingSenderId: "1031594915968",
  appId: "1:1031594915968:web:b2587bd27f099ff6e7ce65"
};

// ล็อกอินผ่านโดเมนเดียวกับแอป (แก้ปัญหา Safari/iPad "missing initial state")
// ต้องมี https://ppj-scoreboard.web.app/__/auth/handler ใน Google Cloud → OAuth client (เพิ่มแล้ว 11 พ.ย. 2569)
export const SAME_DOMAIN_AUTH = true;

// ผู้ดูแลระบบคนแรก (เข้าครั้งแรกแล้วระบบสร้างบัญชีผู้ดูแลให้อัตโนมัติ)
export const BOOTSTRAP_ADMIN = "kitsanawat33@gmail.com";
