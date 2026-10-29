# ScoreBoard PWA (ตัวห่อ Apps Script)

Apps Script ให้บริการไฟล์ `manifest` และ `service worker` จากโดเมนตัวเองไม่ได้ จึงทำ PWA ด้วยวิธี
**ตัวห่อ (wrapper)**: โฮสต์โฟลเดอร์นี้ที่ใดก็ได้ที่เป็น HTTPS แล้วให้หน้าเว็บนี้ฝัง Web App เดิมแบบเต็มจอ

## ขั้นตอน
1. Apps Script → **Deploy → Manage deployments** → คัดลอก URL ที่ลงท้ายด้วย `/exec`
   - **Execute as:** Me
   - **Who has access:** Anyone (ถ้าเลือก "เฉพาะโดเมน" หน้า Login ของ Google จะฝังใน iframe ไม่ได้)
2. เปิด `index.html` ในโฟลเดอร์นี้ แก้บรรทัด `const APP_URL = '...'` เป็น URL ข้างบน
3. อัปโหลดทั้งโฟลเดอร์ `pwa/` ไปยัง HTTPS hosting ฟรี เช่น GitHub Pages, Netlify, Cloudflare Pages
4. เปิดลิงก์บนมือถือ
   - Android (Chrome): เมนู ⋮ → **ติดตั้งแอป / Add to Home screen**
   - iPhone (Safari): ปุ่มแชร์ → **Add to Home Screen**

## ข้อจำกัดที่ควรรู้
- ข้อมูลอยู่บน Google Sheets จึง **ต้องออนไลน์** เพื่อโหลดและบันทึก (ออฟไลน์จะเห็นแค่ข้อความแจ้งเตือน)
- `doGet()` ใน Code.gs ตั้ง `ALLOWALL` ไว้แล้ว จึงฝัง iframe ได้
- หลังแก้โค้ด Apps Script ต้อง Deploy เป็น **New version** แอปที่ติดตั้งไว้จึงได้ของใหม่ (ไม่ต้องติดตั้ง PWA ใหม่)
