# PPJ ScoreBoard — เวอร์ชัน Firebase

ระบบบันทึกคะแนน เช็คชื่อ (รายวิชา + ประจำชั้น) เช็คงาน และตัดเกรดนักเรียน
ย้ายจาก Google Apps Script + Google Sheets มาใช้ **Firebase (Firestore + Authentication + Hosting)**

พัฒนาโดย **KITSANAWAT · Pixel Math Studio**

- เว็บ: https://ppj-scoreboard.web.app
- โปรเจกต์ Firebase: `ppj-scoreboard` (แพ็กเกจ Spark ฟรี, Firestore ที่ asia-southeast1)
- ผู้ดูแลระบบคนแรก: `kitsanawat33@gmail.com` (ตั้งใน `public/config.js` และ `firestore.rules`)

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | หน้าเว็บ (หน้าตาและการทำงานเดิมจาก Apps Script) |
| `public/api.js` | ชั้นข้อมูล — พอร์ตสูตรจาก `Code.gs` เดิม (ตัดเกรด คะแนนเข้าเรียน คะแนนส่งงาน) |
| `public/fb.js`, `config.js` | เชื่อม Firebase SDK |
| `public/sw.js`, `manifest.webmanifest`, `icons/` | PWA ติดตั้งเป็นแอป ใช้งานต่อได้ตอนเน็ตหลุด |
| `firestore.rules` | กฎความปลอดภัยฝั่งเซิร์ฟเวอร์ |
| `.github/workflows/deploy-firebase.yml` | Deploy อัตโนมัติเมื่อ push เข้า branch `firebase` |

## สิทธิ์

| บทบาท | ทำอะไรได้ |
|---|---|
| ผู้ดูแลระบบ | ทุกอย่าง: บุคลากร นักเรียน ภาคเรียน สถานะ เกณฑ์ ทุกรายวิชา |
| ครู | เห็น/แก้เฉพาะรายวิชาที่มีชื่อตนเป็นครูผู้สอน (เพิ่มวิชาเองได้) |
| ครูประจำชั้น | ครูที่กำหนดห้องไว้ เช็คชื่อประจำชั้นได้เฉพาะห้องของตน (1 ห้องมีได้หลายคน) |

เข้าระบบด้วยบัญชี Google — ผู้ดูแลเพิ่มแค่อีเมลที่เมนู **บุคลากร / สิทธิ์**
เลขประจำตัวประชาชนเก็บแยกใน `rosterSecrets` อ่านได้เฉพาะผู้ดูแลระบบ

## ข้อมูลใน Firestore

| คอลเลกชัน | เก็บอะไร |
|---|---|
| `meta/settings`, `meta/gradeRules`, `meta/attendanceStatuses`, `meta/taskStatuses` | ตั้งค่า ภาคเรียน เกณฑ์เกรด สถานะ |
| `users/{email}` | บุคลากร บทบาท ห้องประจำชั้น |
| `rosters/{ภาค_ปี_ชั้น_ห้อง}` | รายชื่อนักเรียนต่อห้องต่อภาคเรียน |
| `rosterSecrets/{…}` | เลขประจำตัวประชาชน (ผู้ดูแลเท่านั้น) |
| `subjects/{id}` | รายวิชา ครูผู้สอน สัดส่วนคะแนน องค์ประกอบคะแนน ภาระงาน |
| `scoreSheets/{subjectId}` | คะแนน + สถานะ ร/มส/0 |
| `attendanceBook/{subjectId}` | เช็คชื่อรายวิชา ทุกวันในเอกสารเดียว |
| `taskBook/{subjectId}` | การส่งงาน |
| `homeroomBook/{ภาค_ปี_ชั้น_ห้อง}` | เช็คชื่อประจำชั้น |

## ย้ายข้อมูลจากระบบเดิม

1. Google Sheets `เก็บคะแนนนักเรียน(งานหลัก)` → ไฟล์ → ดาวน์โหลด → Microsoft Excel (.xlsx)
2. เข้าเว็บด้วยบัญชีผู้ดูแล → เมนู **ย้ายข้อมูลจากระบบเดิม** → เลือกไฟล์ → ตรวจสอบ → นำเข้า

ไฟล์ถูกอ่านในเบราว์เซอร์แล้วเขียนตรงเข้า Firestore — **ห้าม commit ไฟล์ข้อมูลนักเรียนลง GitHub** (repo นี้เป็น public)

## Deploy

ตั้งค่าครั้งเดียว: เพิ่ม GitHub secret `FIREBASE_SERVICE_ACCOUNT` (เนื้อหาไฟล์ JSON ของ service account ที่มีบทบาท *Firebase Admin*)
จากนั้นทุกครั้งที่ push เข้า branch `firebase` จะ deploy หน้าเว็บและ `firestore.rules` ให้เอง

หรือ deploy เองจากเครื่อง: `npm i -g firebase-tools && firebase login && firebase deploy`
