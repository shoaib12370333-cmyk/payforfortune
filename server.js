require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const basicAuth = require("express-basic-auth");
const path = require("path");

const store = require("./store");
const cashtap = require("./cashtap");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Webhook route needs the raw body for signature verification,
// so it's registered before the JSON body parser.
app.post(
  "/webhooks/cashtap",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signatureHeader = req.get("X-CashTap-Signature");
    const secret = process.env.CASHTAP_WEBHOOK_SECRET;

    const valid = cashtap.verifyWebhookSignature(req.body, signatureHeader, secret);
    if (!valid) {
      return res.sendStatus(400);
    }

    let event;
    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }

    const session = event.data && event.data.object;
    if (session && session.id) {
      const metaOrderId = session.metadata && session.metadata.orderId;
      const existing = metaOrderId ? store.findOrderByOrderId(metaOrderId) : store.findOrderBySessionId(session.id);
      store.upsertOrder({
        orderId: existing ? existing.orderId : metaOrderId,
        sessionId: session.id,
        status: session.status,
        amount: session.amount,
        amountReceived: session.amount_received,
        email: session.customer_email,
        playerId: existing ? existing.playerId : (session.metadata && session.metadata.playerId) || "",
        productName: existing ? existing.productName : (session.metadata && session.metadata.productName) || "",
        fulfilled: existing ? existing.fulfilled : false,
        updatedAt: new Date().toISOString(),
      });
    }

    res.sendStatus(200);
  }
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  const config = store.getConfig();
  res.render("index", { config, error: null });
});

app.post("/checkout", async (req, res) => {
  const config = store.getConfig();
  const { playerId, email, productId } = req.body;
  const product = config.products.find((p) => p.id === productId);

  if (!playerId || !email || !product) {
    return res.status(400).render("index", { config, error: "Please fill in all fields and pick a package." });
  }

  // Generated up front: CashTap doesn't hand back a session id until
  // after creation, but success_url has to be set on the create call.
  const orderId = crypto.randomUUID();

  store.upsertOrder({
    orderId,
    status: "pending",
    amount: product.amount,
    email,
    playerId,
    productName: product.name,
    fulfilled: false,
    createdAt: new Date().toISOString(),
  });

  try {
    const session = await cashtap.createCheckoutSession({
      amount: product.amount,
      lineItems: [
        { name: `${config.gameName} — ${product.name}`, quantity: 1, unit_amount: product.amount },
      ],
      customerEmail: email,
      paymentMethods: config.payment_methods,
      successUrl: `${BASE_URL}/success?order=${orderId}`,
      cancelUrl: `${BASE_URL}/cancel`,
      metadata: { orderId, playerId, productId: product.id, productName: product.name },
    });

    store.upsertOrder({
      orderId,
      sessionId: session.id,
      status: session.status,
    });

    res.redirect(303, session.url);
  } catch (err) {
    res.status(502).render("index", { config, error: err.message });
  }
});

app.get("/success", async (req, res) => {
  const config = store.getConfig();
  const orderId = req.query.order;
  if (!orderId) return res.redirect("/");

  const existing = store.findOrderByOrderId(orderId);
  if (!existing || !existing.sessionId) {
    return res.render("success", { config, status: "unknown", order: existing || null, sessionId: null });
  }

  try {
    const session = await cashtap.getCheckoutSession(existing.sessionId);
    store.upsertOrder({
      orderId,
      sessionId: existing.sessionId,
      status: session.status,
      amountReceived: session.amount_received,
      updatedAt: new Date().toISOString(),
    });

    res.render("success", {
      config,
      status: session.status,
      order: store.findOrderByOrderId(orderId),
      sessionId: existing.sessionId,
    });
  } catch (err) {
    res.render("success", { config, status: existing.status || "unknown", order: existing, sessionId: existing.sessionId });
  }
});

app.get("/cancel", (req, res) => {
  res.render("cancel", { config: store.getConfig() });
});

// --- Admin (protected) ---
const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER || "admin"]: process.env.ADMIN_PASSWORD || "" },
  challenge: true,
  realm: "PayForFortune Admin",
});

function buildCustomerSummary(orders) {
  const byEmail = new Map();
  for (const o of orders) {
    if (!o.email) continue;
    if (!byEmail.has(o.email)) {
      byEmail.set(o.email, { email: o.email, total: 0, pending: 0, completed: 0, failedOrExpired: 0, lastOrderAt: "" });
    }
    const c = byEmail.get(o.email);
    c.total += 1;
    if (o.status === "completed") c.completed += 1;
    else if (o.status === "failed" || o.status === "expired") c.failedOrExpired += 1;
    else c.pending += 1;
    const ts = o.updatedAt || o.createdAt || "";
    if (ts > c.lastOrderAt) c.lastOrderAt = ts;
  }
  return Array.from(byEmail.values()).sort((a, b) => (a.lastOrderAt < b.lastOrderAt ? 1 : -1));
}

app.get("/admin", adminAuth, (req, res) => {
  const config = store.getConfig();
  const orders = store.getOrders();
  res.render("admin", { config, orders, customers: buildCustomerSummary(orders), saved: false });
});

app.post("/admin/config", adminAuth, (req, res) => {
  const config = store.getConfig();
  const body = req.body;

  config.brandName = body.brandName;
  config.gameName = body.gameName;

  const updatedProducts = [];
  config.products.forEach((p, i) => {
    if (body[`remove_${i}`]) return;
    updatedProducts.push({
      id: body[`productId_${i}`],
      name: body[`productName_${i}`],
      amount: parseFloat(body[`productAmount_${i}`]),
    });
  });

  if (body.newProductId && body.newProductName && body.newProductAmount) {
    updatedProducts.push({
      id: body.newProductId,
      name: body.newProductName,
      amount: parseFloat(body.newProductAmount),
    });
  }

  config.products = updatedProducts;
  store.saveConfig(config);

  const orders = store.getOrders();
  res.render("admin", { config, orders, customers: buildCustomerSummary(orders), saved: true });
});

app.post("/admin/fulfill", adminAuth, (req, res) => {
  const order = store.findOrderBySessionId(req.body.sessionId);
  if (order) {
    store.upsertOrder({ ...order, fulfilled: true });
  }
  res.redirect("/admin#orders");
});

app.listen(PORT, () => {
  console.log(`PayForFortune listening on port ${PORT}`);
});
