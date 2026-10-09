# دليل إعداد وتسليم WhiteWase للمشتري

هذا الدليل يشرح بنية المشروع، إعداد الحسابات والخدمات، التشغيل المحلي، والنشر. أُخذت أسماء الإعدادات والمسارات من نسخة المشروع الحالية. أرقام الأسطر أدناه مرجع تقريبي للنسخة الحالية؛ قد تتغير إذا عُدّل الملف.

> **مهم:** نقل الشيفرة لا ينقل حسابات Firebase أو سجلات BaaS أو الملفات المرفوعة أو أسرار النشر. يجب نقل هذه الخدمات والبيانات إلى حسابات يملكها المشتري أو إبقاء الخدمات الحالية متاحة باتفاق واضح.

## 1. ما الذي يتكوّن منه المشروع؟

| الجزء | المسار | الوظيفة |
| --- | --- | --- |
| واجهة الموقع | `artifacts/minecraft-hub/` | موقع React/Vite لمشاركة وإدارة ملفات Minecraft |
| واجهة API مستقلة | `artifacts/api-server/` | خادم Express لتشغيل API منفصلة في Node.js |
| تطبيق الإنتاج على Cloudflare | `artifacts/cloudflare-app/` | Worker واحد يخدم API والواجهة المبنية على نفس النطاق |
| عقد API وتوليد الأنواع | `lib/api-spec/`, `lib/api-client-react/`, `lib/api-zod/` | مواصفات API والعميل والأنواع المولّدة |
| سكربت النشر | `deploy-cloudflare.sh` | يبني الواجهة ثم ينشر تطبيق Cloudflare |

توجد ثلاثة أنواع من الخدمات الخارجية:

1. **Firebase Authentication** لتسجيل الدخول بالبريد وكلمة المرور وGoogle.
2. **BaaS** لبيانات الموقع وملفات المستخدمين والملفات المرفوعة. المجموعات المستخدمة هي `files` و`profiles` و`settings`.
3. **Cloudflare Workers** كخيار النشر المتكامل المهيأ حاليًا. يحتاج هذا الخيار إلى Worker أو خدمة BaaS متوافقة يمكن ربطها من Cloudflare.

الموقع لا يستخدم Firebase Firestore لتخزين بياناته، ولا Firebase Storage لرفع ملفات Minecraft. وجود `VITE_FIREBASE_STORAGE_BUCKET` مطلوب ضمن إعداد Firebase Web App الحالي، لكن تخزين بيانات الموقع وملفاته يتم عبر BaaS.

## 2. قبل البدء: ما الذي يجب أن يملكه المشتري؟

- مستودع الشيفرة أو نسخة كاملة من ملفات المشروع، بما فيها `pnpm-lock.yaml`.
- مشروع Firebase يملكه المشتري، مع Firebase Web App مهيأ.
- خدمة BaaS ومفتاح API صالحان، أو نسخة BaaS متوافقة مع API المستخدم هنا، مع خطة لنقل المجموعات والملفات الموجودة.
- حساب استضافة ونطاق إن أراد استخدام نطاق خاص.
- لحالة النشر الحالية: حساب Cloudflare وصلاحية نشر Worker، بالإضافة إلى ربط Service Binding بخدمة BaaS التي يملكها المشتري أو يحق له استخدامها.

إذا كانت هناك حسابات مستخدمين قائمة، فلا يكفي إنشاء مشروع Firebase جديد: ترتبط ملكية الملفات والملفات الشخصية بمعرّف Firebase UID. يجب نقل الحسابات بطريقة تحفظ هذه المعرّفات أو تنفيذ تحويل بيانات مدروس. لا تحذف سجلات BaaS أو الملفات قبل التأكد من نجاح النقل والنسخ الاحتياطي.

## 3. إعداد Firebase يدويًا

### إنشاء التطبيق وإعداد تسجيل الدخول

1. أنشئ مشروعًا في Firebase Console يملكه المشتري.
2. أضف **Web App** إلى المشروع، وانسخ إعدادات التطبيق الظاهرة في Firebase Console.
3. افتح **Authentication → Sign-in method** وفعّل:
   - **Email/Password**
   - **Google**
4. افتح **Authentication → Settings → Authorized domains** وأضف النطاقات الفعلية التي سيعمل عليها الموقع، مثل نطاق `workers.dev` الذي يعيده النشر أو النطاق الخاص. أضف نطاق المعاينة عند الحاجة للتجربة.
5. لا تنشئ Service Account لهذا الموقع ولا تضع ملف JSON خاصًا به في الواجهة. التطبيق يتحقق من Firebase ID tokens بمفاتيح Firebase العامة، ولا يحتاج مفتاحًا خاصًا من Firebase.

### أين توضع إعدادات Firebase؟

تُستخدم القيم التالية في واجهة الموقع، واسم كل قيمة يجب أن يطابق الاسم حرفيًا:

| اسم الإعداد | مصدره في Firebase Console |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `measurementId` |

مواضع قراءة الإعدادات الحالية:

- `artifacts/minecraft-hub/src/auth/firebase.ts`، الأسطر 10–16: يقرأ المتصفح قيم `VITE_FIREBASE_*`.
- `artifacts/api-server/src/lib/firebaseAuth.ts`، الأسطر 9–15: يقرأ `FIREBASE_PROJECT_ID` للتحقق من هوية الطلبات؛ ويقبل كبديل `VITE_FIREBASE_PROJECT_ID`.
- `artifacts/cloudflare-app/src/lib/firebaseAuth.ts`، الأسطر 9–23: يقرأ `FIREBASE_PROJECT_ID` من إعدادات Worker.
- `deploy-cloudflare.sh`، الأسطر 8–18: يشترط متغيرات Firebase السبعة عند تشغيل سكربت النشر، ويمرر معرّف المشروع إلى Worker في الأسطر 31–34.

#### وضع القيم محليًا

للبناء المحلي للواجهة، أنشئ ملفًا محليًا غير مرفوع إلى Git:

`artifacts/minecraft-hub/.env.local`

واكتب داخله القيم التي نسختها من Firebase، كل قيمة في سطر:

```dotenv
VITE_FIREBASE_API_KEY=ضع_القيمة_هنا
VITE_FIREBASE_AUTH_DOMAIN=ضع_القيمة_هنا
VITE_FIREBASE_PROJECT_ID=ضع_القيمة_هنا
VITE_FIREBASE_STORAGE_BUCKET=ضع_القيمة_هنا
VITE_FIREBASE_MESSAGING_SENDER_ID=ضع_القيمة_هنا
VITE_FIREBASE_APP_ID=ضع_القيمة_هنا
VITE_FIREBASE_MEASUREMENT_ID=ضع_القيمة_هنا
```

هذه أسماء أمثلة فقط؛ لا تضع النص `ضع_القيمة_هنا` كما هو. Vite يضمّن قيم `VITE_*` في ملفات الواجهة المبنية، لذا لا تضع فيها أي سرّ خادم. إعداد `apiKey` في Firebase Web App إعداد عميل وليس بديلًا عن حماية المشروع: اضبط Authorized domains وقواعد Firebase المناسبة.

يستثني `.gitignore` ملفات `.env*` من Git (مع استثناء `.env.example`) في الأسطر 14–17. تحقّق من عدم رفع ملف `.env.local` إلى المستودع.

#### وضع القيم على الاستضافة

أضف القيم نفسها في مدير متغيرات البيئة/الأسرار الخاص بمنصة الاستضافة **ضمن بيئة البناء**، ثم أعد البناء والنشر بعد أي تعديل. في Replit تُضاف من **Secrets**. في Cloudflare Pages/Workers أو Render أو Railway أو غيرها، استخدم مدير الأسرار/متغيرات المشروع في لوحة المنصة، ولا تكتب القيم السرية في Git أو في ملف المصدر.

إعدادات الواجهة تُعرف مسبقًا للعميل عند البناء، لذلك تغييرها في لوحة الاستضافة بعد اكتمال بناء ملفات ثابتة لا يغيّر تلك الملفات؛ أعد تشغيل عملية البناء والنشر.

## 4. إعداد BaaS والبيانات

الخادم يحتاج متغيري البيئة التاليين:

| المتغير | إلزامي؟ | المعنى |
| --- | --- | --- |
| `BAAS_BASE_URL` | نعم للتشغيل المستقل؛ موصى به دائمًا | أصل خدمة BaaS بصيغة HTTPS، مثل `https://example.workers.dev` |
| `BAAS_API_KEY` | نعم | مفتاح سري يرسله الخادم إلى BaaS في ترويسة `X-API-Key` |

استخدم **عنوان أصل الخدمة**، لا رابط لوحة التحكم مثل `/projects/1`، ولا تضف مسارًا إلى نهاية العنوان. عميل BaaS يحوّل القيمة إلى أصل HTTPS ويتحقق منها:

- خادم Express: `artifacts/api-server/src/lib/baas.ts`، الأسطر 14–34.
- Worker: `artifacts/cloudflare-app/src/lib/baas.ts`، الأسطر 38–52 و85–101.
- ربط الخدمة واسمها في Cloudflare: `artifacts/cloudflare-app/wrangler.toml`، الأسطر 12–19.

يجب أن توفر خدمة BaaS المتوافقة عمليات البيانات والتخزين التي يستخدمها الكود، ومنها إنشاء وقراءة وتعديل وحذف السجلات، رفع الملفات وحذفها، وتحديد الحقول الفريدة. تفاصيل واجهة BaaS موجودة في `replit.md`، الأسطر 54–62، وتفاصيل المجموعات في الأسطر 37–40.

المشروع ينشئ مخططات الحقول الفريدة عند الاستخدام:

- `files.customId`
- `profiles.username`
- `settings.ownerUserId`

الصور وروابط التنزيل المخزنة في سجلات BaaS يجب أن تبقى متاحة للموقع، وملفات التخزين الحالية لا تنتقل تلقائيًا عند تغيير عنوان BaaS. انسخ السجلات والكائنات ثم اختبر الروابط قبل تحويل الموقع إلى الخدمة الجديدة.

### حفظ إعدادات BaaS محليًا

لا يقرأ خادم Express ملف `.env` تلقائيًا في إعداداته الحالية؛ مرّر متغيرات البيئة من الطرفية أو بيئة التشغيل. مثال Bash لجلسة محلية فقط:

```bash
export BAAS_BASE_URL="https://عنوان-خدمة-baas-الخاصة-بك"
export BAAS_API_KEY="ضع-المفتاح-السري-هنا"
export FIREBASE_PROJECT_ID="معرف-مشروع-firebase"
```

لا تحفظ المفتاح في ملفات المصدر أو في Git أو في واجهة المتصفح.

## 5. إعداد مفاتيح Cloudflare Worker

### المتغيرات والأسرار

| الإعداد | نوعه | الاستخدام |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | إعداد نشر | يحدد حساب Cloudflare الذي يستهدفه سكربت النشر |
| `CLOUDFLARE_API_TOKEN` | سرّ نشر | صلاحية Wrangler لنشر Worker |
| `BAAS_API_KEY` | سرّ Worker | مصادقة Worker مع BaaS |
| `BAAS_BASE_URL` | إعداد Worker | أصل BaaS؛ يفضّل ضبطه حتى عند استخدام Service Binding |
| `FIREBASE_PROJECT_ID` | متغير Worker | معرّف مشروع Firebase المستخدم للتحقق من ID tokens |
| `VIRUSTOTAL_API_KEY` | اختياري | يشغّل إرسال الملفات إلى VirusTotal |
| `DEEPAI_API_KEY` | اختياري | يشغّل فحص صور الرفع عبر DeepAI |

لا تضع `BAAS_API_KEY` أو `CLOUDFLARE_API_TOKEN` في متغير يبدأ بـ `VITE_`؛ متغيرات `VITE_*` مكشوفة ضمن ملفات الواجهة.

### تعيين أسرار الإنتاج

يمكن إضافة أسرار Worker من مجلد التطبيق عبر Wrangler، مع كتابة كل قيمة عند المطالبة التفاعلية:

```bash
cd artifacts/cloudflare-app
npx wrangler secret put BAAS_API_KEY
npx wrangler secret put BAAS_BASE_URL
```

إذا قرر المشتري تفعيل إحدى خدمات الفحص، يضيف مفتاحها بالطريقة نفسها، مثل:

```bash
npx wrangler secret put VIRUSTOTAL_API_KEY
npx wrangler secret put DEEPAI_API_KEY
```

`FIREBASE_PROJECT_ID` متغير غير سرّي يمرره `deploy-cloudflare.sh` إلى Wrangler من `VITE_FIREBASE_PROJECT_ID`. إعداد Worker غير السرّي `NODE_ENV` وربط BaaS موجودان في `artifacts/cloudflare-app/wrangler.toml`، الأسطر 12–21.

**Service Binding:** يحتوي الملف الحالي على:

```toml
[[services]]
binding = "BAAS_SERVICE"
service = "baas-platform"
```

في `artifacts/cloudflare-app/wrangler.toml`، الأسطر 12–15. يجب أن يطابق `service` اسم Worker BaaS في حساب Cloudflare الذي سينفّذ النشر. إذا كانت خدمة المشتري باسم مختلف، عدّل هذا الاسم قبل النشر. إذا كانت BaaS على استضافة خارج Cloudflare، لا تفترض أن هذا الربط سيعمل؛ اتبع إعداد BaaS المعتمد لديها واختبر الوصول من Worker.

### إعداد التشغيل المحلي للـ Worker

الأمر `pnpm --filter @workspace/cloudflare-app run dev` يستدعي `artifacts/cloudflare-app/scripts/dev-vars.mjs`. هذا السكربت ينشئ `artifacts/cloudflare-app/.dev.vars` من متغيرات البيئة المتاحة في Replit أو الطرفية؛ ويكتب إعدادات BaaS ومفاتيح الفحص الاختيارية ومعرّف Firebase فقط (الأسطر 9–30 من السكربت). لا تعدّل `.dev.vars` ليصبح ملفًا مشتركًا ولا ترفعه إلى Git؛ `.gitignore` يستثني ملفات `.dev.vars*` في السطر 17.

## 6. مفاتيح اختيارية للفحص

- **VirusTotal:** `VIRUSTOTAL_API_KEY`. عند غيابه يستمر الموقع لكن لا يجري فحص VirusTotal. حالة الفحص المعروضة ليست ضمانًا بأن الملف آمن، والتنزيل لا يتوقف على حالة الفحص الحالية.
- **DeepAI:** `DEEPAI_API_KEY`. يستخدم لفحص الصور المرفوعة. إذا لم يتوفر المفتاح، قد يستمر بعض الرفع مع تحذير، لكن بعض عمليات تعديل الصور قد لا تكتمل. أضف المفتاح فقط إذا كان المشتري يملك حسابًا ويريد تفعيل التكامل واختباره.

لا يلزم أيٌّ من هذين المفتاحين لتشغيل المصادقة أو قاعدة البيانات أو استضافة الموقع. لا تضفهما افتراضيًا ضمن التسليم دون قرار صريح باعتماد التكاملين.

## 7. التشغيل المحلي للمشروع

يتطلب المشروع Node.js 24 وpnpm. نسخة pnpm المسجلة في المشروع موضحة في `package.json` عند الجذر، السطر 5.

من جذر المشروع:

```bash
pnpm install --frozen-lockfile
```

أضف إعدادات Firebase إلى `artifacts/minecraft-hub/.env.local`، ومرّر إعدادات BaaS وFirebase الخاصة بالخادم إلى بيئة الطرفية كما في القسمين السابقين.

### الخيار أ: تطوير الواجهة مع Express API

شغّل الخادم والواجهة في جلستين طرفيتين منفصلتين:

```bash
pnpm --filter @workspace/api-server run dev
```

```bash
pnpm --filter @workspace/minecraft-hub run dev
```

Vite يوجّه طلبات `/api` أثناء التطوير إلى Express. عنوان الهدف الافتراضي `http://127.0.0.1:8080`، ويمكن تغييره عبر `API_SERVER_URL` أو المنفذ عبر `API_SERVER_PORT`؛ راجع `artifacts/minecraft-hub/vite.config.ts`، الأسطر 24–27 و124–132. خادم Express يستمع افتراضيًا إلى 8080، أو إلى قيمة `PORT` إن تم تمريرها؛ راجع `artifacts/api-server/src/index.ts`، الأسطر 4–15.

### الخيار ب: تشغيل تطبيق Cloudflare محليًا

وفّر متغيرات البيئة المطلوبة ثم شغّل:

```bash
pnpm --filter @workspace/cloudflare-app run dev
```

يبدأ Wrangler محليًا ويستخدم إعدادات `.dev.vars` التي يولّدها السكربت. يجب أن يستطيع التشغيل المحلي الوصول إلى خدمة BaaS، وأن يكون `BAAS_API_KEY` متاحًا. هذا الخيار يحاكي النسخة التي تخدم الواجهة وAPI من Worker واحد.

### أوامر الفحص والبناء

```bash
pnpm run typecheck
pnpm --filter @workspace/minecraft-hub run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/cloudflare-app run typecheck
```

أوامر الحزم المحلية موضحة في `artifacts/minecraft-hub/package.json` و`artifacts/api-server/package.json` و`artifacts/cloudflare-app/package.json`.

## 8. النشر على Cloudflare — الطريقة المهيأة حاليًا

هذه الطريقة تنشر الموقع والـ API معًا على Worker واحد، وتناسب إعدادات المشروع الحالية.

1. استورد المستودع إلى Replit أو بيئة بناء فيها Node.js وpnpm، وثبّت الاعتماديات باستخدام `pnpm install --frozen-lockfile`.
2. في متغيرات بيئة عملية البناء/النشر، أضف:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - قيم Firebase السبعة المذكورة في القسم 3.
3. أنشئ في Cloudflare أسرار Worker اللازمة عبر `wrangler secret put`: `BAAS_API_KEY` و`BAAS_BASE_URL`.
4. حدّث Service Binding `BAAS_SERVICE` في `artifacts/cloudflare-app/wrangler.toml` ليربط Worker BaaS الصحيح، إن لم يكن الاسم `baas-platform`.
5. انشر من جذر المشروع:

   ```bash
   pnpm --filter @workspace/cloudflare-app run deploy
   ```

   أو:

   ```bash
   ./deploy-cloudflare.sh
   ```

6. انتظر انتهاء النشر وخذ عنوان Worker الذي تعرضه Cloudflare. أضف اسم المضيف إلى Firebase Authorized domains.
7. افتح الموقع واختبر التسجيل والدخول، إعدادات الحساب، عرض الملفات، رفع ملف تجريبي وتنزيله، ثم تحقق من:

   ```text
   https://عنوان-الموقع/api/healthz
   ```

   يجب أن يرجع الفحص حالة `ok`. ظهور `degraded` يعني أن Worker لم يتمكن من إجراء فحص BaaS؛ راجع سر `BAAS_API_KEY` وعنوان BaaS وService Binding.

سكربت النشر يتحقق من متغيرات Cloudflare وFirebase المطلوبة في `deploy-cloudflare.sh`، الأسطر 8–25، ثم يبني الواجهة وينشر Worker في الأسطر 27–35. أسرار BaaS لا يمررها هذا السكربت تلقائيًا؛ يجب إضافتها إلى بيئة Worker كما سبق.

## 9. النشر على استضافة أخرى

### تشغيل API على Node.js وخدمة الملفات الثابتة على الاستضافة

يمكن تشغيل `artifacts/api-server` على استضافة Node.js مثل VPS أو خدمة تطبيقات تدعم Node، واستضافة `artifacts/minecraft-hub` كملفات ثابتة. يجب إعداد كل ما يلي:

1. في خدمة API، عيّن `BAAS_BASE_URL` و`BAAS_API_KEY` و`FIREBASE_PROJECT_ID` كمتغيرات بيئة خادمية. إذا كانت قيمة `VITE_FIREBASE_PROJECT_ID` موجودة في بيئة الخادم، يقبلها Express كبديل، لكن الأفضل ضبط `FIREBASE_PROJECT_ID` صراحة.
2. اجعل الخدمة تعمل على المنفذ الذي تمرره المنصة عبر `PORT`. أمر التشغيل الإنتاجي في حزمة API هو `pnpm --filter @workspace/api-server run start` بعد البناء، وملف الدخول `artifacts/api-server/src/index.ts`.
3. ابنِ الواجهة مع متغيرات Firebase السبعة. مخرجات البناء موجودة في `artifacts/minecraft-hub/dist/public`.
4. وجّه طلبات `/api/*` من نفس نطاق الواجهة إلى خدمة API، ووجّه المسارات الأخرى إلى ملفات الواجهة مع إعادة توجيه مسارات التطبيق إلى `index.html`.
5. إذا فصلت الواجهة والـ API على نطاقين مختلفين، يجب إعداد reverse proxy أو تغيير إعدادات بناء التطبيق لتوجيه API إلى عنوان الخدمة المنفصلة، وضبط `CORS_ALLOWED_ORIGINS` على خادم Express بالأصل الكامل للواجهة، مثل `https://www.example.com` دون مسار. الكود الحالي يقرأ هذه القيمة في `artifacts/api-server/src/app.ts`، الأسطر 9–21 و49–59. لا تستخدم `*` لقائمة المصادر المسموحة.
6. أضف نطاق الواجهة إلى Firebase Authorized domains.

المشروع يستدعي API بمسار `/api` من نفس نطاق الموقع. لذلك فإن رفع ملفات الواجهة وحدها إلى استضافة صفحات ثابتة لا يكفي؛ يجب تمرير `/api` إلى خادم API. إعداد Vite في `artifacts/minecraft-hub/vite.config.ts` يحتوي على Proxy للتطوير المحلي فقط، وليس بديلًا عن reverse proxy في الإنتاج.

### منصات الصفحات الثابتة فقط

يمكن استخدام منصة صفحات ثابتة لاستضافة الواجهة، لكن يجب توفير API على خدمة أخرى وربط `/api` بها عبر قواعد proxy/rewrites مدعومة من المنصة أو عبر نطاق موحّد وreverse proxy. لا تضع `BAAS_API_KEY` في إعدادات الواجهة، ولا تجعل المتصفح يتصل مباشرة بـ BaaS بمفتاح الخادم.

### خيار Cloudflare Pages منفصل

إذا استُخدمت Pages للواجهة بدل Worker المتكامل، يجب أن يبقى API متاحًا تحت المسار الذي تتوقعه الواجهة (`/api`) من خلال Worker أو Proxy. مجرد نشر `dist/public` على Pages لن يشغّل API. خيار Cloudflare Worker المتكامل في القسم السابق هو إعداد النشر الجاهز حاليًا والأقل حاجة إلى تغييرات.

## 10. ما الذي يجب نقله عند تغيير الخدمات؟

قبل إيقاف حسابات البائع أو خدماته:

1. خذ نسخة احتياطية من مجموعات BaaS الثلاث (`files`, `profiles`, `settings`) ومن جميع كائنات التخزين، لا من ملفات الشيفرة فقط.
2. احتفظ بربط كل ملف بسجل البيانات المقابل له، بما في ذلك معرّفات كائنات التخزين وروابط التنزيل والصور.
3. انقل حسابات Firebase مع UIDs أو خطط لتحويل ملكية `uploadedBy` و`userId` وغيرها من سجلات الحسابات. لا تغيّر مشروع Firebase قبل معرفة أثر اختلاف UIDs.
4. اختبر على بيئة جديدة بحساب وملفات تجريبية، وتحقق من أن الروابط ما زالت تعمل وأن الحقول الفريدة تطبق كما ينبغي.
5. احتفظ بنسخة قابلة للاسترجاع من الخدمة القديمة حتى يكتمل اختبار الدخول والرفع والتنزيل والتعديل والحذف على الخدمة الجديدة.

## 11. قائمة تحقق قبل تسليم الموقع

- [ ] الحسابات والخدمات وقواعد البيانات مملوكة للمشتري أو موثقة باتفاق استمرار الخدمة.
- [ ] Firebase Email/Password وGoogle مفعّلان والنطاق الفعلي ضمن Authorized domains.
- [ ] قيم `VITE_FIREBASE_*` مضبوطة في بيئة البناء، و`FIREBASE_PROJECT_ID` مضبوط للخادم أو Worker.
- [ ] `BAAS_BASE_URL` يشير إلى أصل الخدمة الصحيح عبر HTTPS و`BAAS_API_KEY` موجود في الخادم فقط.
- [ ] Cloudflare Worker مرتبط بخدمة BaaS الصحيحة؛ أو إعداد Node API وreverse proxy صالحان.
- [ ] مجلد `.env*` و`.dev.vars*` غير متعقبين في Git، ولا توجد مفاتيح في الواجهة أو المستودع.
- [ ] فحص `/api/healthz` يرجع `ok`.
- [ ] تم اختبار تسجيل مستخدم جديد، تسجيل الدخول، رفع ملف وصورة، تنزيل ملف، تحديث الملف الشخصي والإعدادات، والحذف بحسابات وملفات اختبار.
- [ ] تم اختبار الموقع على الهاتف والحاسوب، وإعادة تحميل صفحة داخلية مباشرة.
- [ ] تم توثيق أي مفاتيح اختيارية أو خدمات مدفوعة لازمة للمشتري وتجديدها.

## 12. مراجع داخل المشروع

- `BUYER_HANDOFF.md` — ملخص نقل الملكية والخدمات.
- `FIREBASE_AUTH.md` — إعداد Firebase والتحقق من الهوية.
- `replit.md` — بنية المشروع وعقود BaaS والأوامر.
- `deploy-cloudflare.sh` — متطلبات سكربت نشر Cloudflare.
- `artifacts/cloudflare-app/wrangler.toml` — اسم Worker وملفات الواجهة وService Binding.
- `artifacts/cloudflare-app/scripts/dev-vars.mjs` — إعدادات تشغيل Worker محليًا.
- `artifacts/minecraft-hub/src/auth/firebase.ts` — تهيئة Firebase في المتصفح.
- `artifacts/api-server/src/lib/baas.ts` و`artifacts/cloudflare-app/src/lib/baas.ts` — اتصال BaaS من Express وCloudflare.
