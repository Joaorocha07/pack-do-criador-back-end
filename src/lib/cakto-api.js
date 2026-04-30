const CAKTO_BASE_URL = "https://api.cakto.com.br";

async function getCaktoAccessToken() {
  if (!process.env.CAKTO_CLIENT_ID || !process.env.CAKTO_CLIENT_SECRET) {
    throw new Error("CAKTO_CLIENT_ID e CAKTO_CLIENT_SECRET precisam estar configurados.");
  }

  const response = await fetch(`${CAKTO_BASE_URL}/public_api/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.CAKTO_CLIENT_ID,
      client_secret: process.env.CAKTO_CLIENT_SECRET
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao autenticar na Cakto: ${response.status} ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchCaktoOrdersPage({ token, page, limit }) {
  const url = new URL(`${CAKTO_BASE_URL}/public_api/orders/`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao listar pedidos da Cakto: ${response.status} ${body}`);
  }

  return response.json();
}

async function listCaktoOrders({ maxPages = 20, limit = 100 } = {}) {
  const token = await getCaktoAccessToken();
  const orders = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchCaktoOrdersPage({ token, page, limit });
    const pageOrders = Array.isArray(data.results) ? data.results : [];

    orders.push(...pageOrders);

    if (!data.next || pageOrders.length === 0) {
      break;
    }
  }

  return orders;
}

module.exports = {
  listCaktoOrders
};
