const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "data", "config.json");
const ORDERS_PATH = path.join(__dirname, "data", "orders.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getConfig() {
  return readJson(CONFIG_PATH);
}

function saveConfig(config) {
  writeJson(CONFIG_PATH, config);
}

function getOrders() {
  return readJson(ORDERS_PATH);
}

function saveOrders(orders) {
  writeJson(ORDERS_PATH, orders);
}

function findOrderBySessionId(sessionId) {
  return getOrders().find((o) => o.sessionId === sessionId);
}

function findOrderByOrderId(orderId) {
  return getOrders().find((o) => o.orderId === orderId);
}

// Matches by orderId when present (set at creation, before we have a
// CashTap session id), falling back to sessionId once it's known.
function upsertOrder(order) {
  const orders = getOrders();
  const idx = orders.findIndex(
    (o) => (order.orderId && o.orderId === order.orderId) || (order.sessionId && o.sessionId === order.sessionId)
  );
  if (idx === -1) {
    orders.push(order);
  } else {
    orders[idx] = { ...orders[idx], ...order };
  }
  saveOrders(orders);
}

module.exports = {
  getConfig,
  saveConfig,
  getOrders,
  saveOrders,
  findOrderBySessionId,
  findOrderByOrderId,
  upsertOrder,
};
