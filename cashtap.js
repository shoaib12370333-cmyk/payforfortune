const crypto = require("crypto");

const BASE_URL = "https://api.cashtap.cash/checkout/v1";

async function createCheckoutSession({ amount, lineItems, customerEmail, paymentMethods, successUrl, cancelUrl, metadata }) {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CASHTAP_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      line_items: lineItems,
      customer_email: customerEmail,
      payment_methods: paymentMethods,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    const message = body?.error?.message || "Failed to create checkout session";
    throw new Error(message);
  }
  return body;
}

async function getCheckoutSession(sessionId) {
  const res = await fetch(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      Authorization: `Bearer ${process.env.CASHTAP_SECRET_KEY}`,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    const message = body?.error?.message || "Failed to retrieve checkout session";
    throw new Error(message);
  }
  return body;
}

// Verifies X-CashTap-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>...]
function verifyWebhookSignature(rawBody, header, secret, toleranceSec = 300) {
  if (typeof header !== "string" || header.length > 1024) return false;

  let t = null;
  const sigs = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }

  if (!/^\d{1,12}$/.test(t || "")) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest();

  return sigs.slice(0, 5).some((s) => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    const sigBuf = Buffer.from(s, "hex");
    return sigBuf.length === expected.length && crypto.timingSafeEqual(sigBuf, expected);
  });
}

module.exports = { createCheckoutSession, getCheckoutSession, verifyWebhookSignature };
