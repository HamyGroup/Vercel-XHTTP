// export const config = { runtime: "edge" }; // این خط حذف شده تا از Node.js runtime استفاده شود

const TARGET_DOMAIN = process.env.TARGET_DOMAIN;
if (!TARGET_BASE) {
    console.error("Misconfigured: TARGET_DOMAIN environment variable is not set.");
    // در Node.js runtime، نمی‌توانیم مستقیماً Response ارسال کنیم مگر اینکه handler آن را برگرداند.
    // بنابراین، خطا را در کنسول ثبت کرده و یک خطا برمی‌گردانیم.
}

const TARGET_BASE = TARGET_DOMAIN.replace(/\/$/, ""); // حذف اسلش انتهایی در صورت وجود

// لیستی از هدرهایی که باید از درخواست ورودی حذف شوند یا نادیده گرفته شوند
// این لیست شامل هدرهای مربوط به اتصال، پروکسی و هدرهای Vercel است
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade", // حذف upgrade اگر websocket نیاز نیست
  "host",    // host را بعداً به صورت دستی تنظیم خواهیم کرد
]);

export default async function handler(req) {
  // بررسی اولیه برای اطمینان از تنظیم بودن TARGET_DOMAIN
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const url = new URL(req.url);
    // ساخت URL مقصد
    // مسیر از 8 کاراکتر اول URL درخواست (مثلاً 'https://your-app.vercel.app') شروع می‌شود
    const path = url.pathname.slice(url.protocol.length + url.host.length);
    const targetUrl = `${TARGET_BASE}${path}`;

    // آماده‌سازی هدرهای درخواست خروجی
    const headers = new Headers(req.headers);

    // حذف هدرهای ممنوعه یا غیرضروری
    HOP_HEADERS.forEach((header) => {
      headers.delete(header);
    });

    // حذف هدرهای خاص Vercel که نباید به سرور مقصد ارسال شوند
    for (const key of headers.keys()) {
      if (key.startsWith("x-vercel-")) {
        headers.delete(key);
      }
    }

    // تنظیم هدر 'host' برای سرور مقصد
    headers.set("host", new URL(TARGET_BASE).host);

    // مدیریت هدر 'x-forwarded-for' برای حفظ IP اصلی کلاینت
    // درخواست ورودی ممکن است چندین IP داشته باشد؛ ما فقط IP اصلی را می‌گیریم
    const forwardedFor = headers.get("x-forwarded-for");
    let clientIp = req.headers.get("x-real-ip") || forwardedFor?.split(',')[0];
    if (clientIp) {
        // اگر x-forwarded-for از قبل وجود داشت، IP کلاینت را به انتهای آن اضافه می‌کنیم
        if (forwardedFor) {
            headers.set("x-forwarded-for", `${forwardedFor}, ${clientIp}`);
        } else {
            headers.set("x-forwarded-for", clientIp);
        }
    } else {
        // اگر هیچ IP پیدا نشد، حذف می‌کنیم تا سرور مقصد دچار مشکل نشود
        headers.delete("x-forwarded-for");
    }

    // آماده‌سازی بدنه درخواست (body)
    let body = undefined;
    // بررسی کنید که آیا متد درخواست نیاز به بدنه دارد و آیا بدنه در درخواست اصلی وجود دارد
    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      body = req.body;
    }

    // ارسال درخواست به سرور مقصد
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: body,
      // duplex: "half", // حذف شده
      // redirect: "manual", // حذف شده برای استفاده از رفتار پیش‌فرض fetch
    });

    // اگر پاسخ دریافت شد، آن را برگردانید
    // نکته: مدیریت ریدایرکت‌ها و کوکی‌ها ممکن است نیاز به منطق بیشتری داشته باشد
    // اگر سرور مقصد ریدایرکت ارسال کند، fetch به طور خودکار آن را دنبال نمی‌کند (چون redirect: "manual" را حذف کردیم، رفتار پیش‌فرض fetch را داریم که ریدایرکت را دنبال می‌کند)
    // اگر نیاز دارید ریدایرکت‌ها را دستی مدیریت کنید، باید پاسخ fetch را بررسی کنید و در صورت نیاز درخواست جدیدی ارسال کنید.

    // برای اطمینان بیشتر، هدرهای پاسخ را نیز بررسی و فیلتر کنید (اختیاری)
    // const responseHeaders = new Headers(response.headers);
    // responseHeaders.delete("set-cookie"); // مثال: حذف کوکی‌ها اگر مشکل‌ساز هستند

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers, // یا responseHeaders اگر فیلتر کردید
    });

  } catch (err) {
    console.error("Relay error:", err.message);
    // در صورت بروز خطا، یک پاسخ Bad Gateway برگردانید
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
