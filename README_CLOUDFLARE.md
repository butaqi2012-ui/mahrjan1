# دليل تجهيز التطبيق لـ Cloudflare

لقد قمنا بتجهيز التطبيق بهيكلية **Full-Stack (Express + Vite)** وهي الخطوة الأساسية للتشغيل على خوادم سحابية.

## 1. الهيكلية الحالية
- **الخادم (server.ts)**: يعالج طلبات API (مثل إرسال البريد والرسائل النصية) ويخدم ملفات الواجهة الأمامية.
- **الواجهة الأمامية (Vite)**: يتم بناؤها كملفات ثابتة في مجلد `dist`.

## 2. خطوات التجهيز لـ Cloudflare

### الخيار أ: Cloudflare Pages (الأسهل)
1. قم برفع الكود إلى **GitHub**.
2. في لوحة تحكم Cloudflare، اختر **Pages** ثم **Connect to Git**.
3. إعدادات البناء (Build Settings):
   - **Framework preset**: `Vite`.
   - **Build command**: `npm run build`.
   - **Build output directory**: `dist`.
4. **لطلبات API**: يجب تحويل وظائف `server.ts` إلى **Cloudflare Pages Functions**.

### الخيار ب: Cloudflare Workers
إذا كنت ترغب في تشغيل Express مباشرة:
1. ستحتاج إلى استخدام مكتبة مثل `@hono/node-server` أو محول لـ Express.
2. استخدام **Wrangler CLI** لنشر الكود.

## 3. المتغيرات البيئية (Environment Variables)
يجب إضافة المتغيرات التالية في لوحة تحكم Cloudflare (قسم Settings -> Variables):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`

## 4. ملاحظات هامة
- تأكد من تحديث رابط `Shared App URL` في إعدادات Firebase (Authorized Domains) ليشمل رابط Cloudflare الجديد.
- الكود الحالي يدعم التشغيل المحلي والإنتاجي بشكل تلقائي.
