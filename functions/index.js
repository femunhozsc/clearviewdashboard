const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

const PLUGGY_API_URL = "https://api.pluggy.ai";

/**
 * Obtém API Key da Pluggy usando CLIENT_ID e CLIENT_SECRET
 */
async function getPluggyApiKey(clientId, clientSecret) {
  const cid = clientId || process.env.PLUGGY_CLIENT_ID;
  const csecret = clientSecret || process.env.PLUGGY_CLIENT_SECRET;

  if (!cid || !csecret) {
    throw new Error("Credenciais da Pluggy (CLIENT_ID ou CLIENT_SECRET) não configuradas.");
  }

  const response = await axios.post(`${PLUGGY_API_URL}/auth`, {
    clientId: cid,
    clientSecret: csecret,
  });

  return response.data.apiKey;
}

/**
 * Endpoint 1: Criar Connect Token para abrir o Widget no Frontend
 * POST /createPluggyConnectToken
 */
exports.createPluggyConnectToken = onRequest({ cors: true }, (req, res) => {
  cors(req, res, async () => {
    try {
      const { clientUserId, itemId } = req.body || {};
      const customClientId = req.headers["x-pluggy-client-id"];
      const customClientSecret = req.headers["x-pluggy-client-secret"];

      const apiKey = await getPluggyApiKey(customClientId, customClientSecret);

      const payload = {};
      if (clientUserId) payload.clientUserId = clientUserId;
      if (itemId) payload.itemId = itemId;

      const tokenResponse = await axios.post(
        `${PLUGGY_API_URL}/connect_token`,
        payload,
        {
          headers: { "X-API-KEY": apiKey },
        }
      );

      return res.status(200).json({
        accessToken: tokenResponse.data.accessToken,
      });
    } catch (error) {
      console.error("Erro ao criar Connect Token:", error.response?.data || error.message);
      return res.status(500).json({
        error: "Falha ao gerar Connect Token da Pluggy",
        details: error.response?.data || error.message,
      });
    }
  });
});

/**
 * Endpoint 2: Obter dados detalhados de um Item (Banco conectado)
 * GET/POST /getPluggyItem
 */
exports.getPluggyItem = onRequest({ cors: true }, (req, res) => {
  cors(req, res, async () => {
    try {
      const itemId = req.query.itemId || req.body?.itemId;
      if (!itemId) {
        return res.status(400).json({ error: "itemId é obrigatório." });
      }

      const customClientId = req.headers["x-pluggy-client-id"];
      const customClientSecret = req.headers["x-pluggy-client-secret"];
      const apiKey = await getPluggyApiKey(customClientId, customClientSecret);

      const [itemResp, accountsResp] = await Promise.all([
        axios.get(`${PLUGGY_API_URL}/items/${itemId}`, { headers: { "X-API-KEY": apiKey } }),
        axios.get(`${PLUGGY_API_URL}/accounts?itemId=${itemId}`, { headers: { "X-API-KEY": apiKey } }),
      ]);

      return res.status(200).json({
        item: itemResp.data,
        accounts: accountsResp.data.results || [],
      });
    } catch (error) {
      console.error("Erro ao consultar Item Pluggy:", error.response?.data || error.message);
      return res.status(500).json({
        error: "Falha ao consultar Item da Pluggy",
        details: error.response?.data || error.message,
      });
    }
  });
});

/**
 * Endpoint 3: Excluir/Desconectar Item da Pluggy
 * POST /deletePluggyItem
 */
exports.deletePluggyItem = onRequest({ cors: true }, (req, res) => {
  cors(req, res, async () => {
    try {
      const { itemId, clientId } = req.body || {};
      if (!itemId) {
        return res.status(400).json({ error: "itemId é obrigatório." });
      }

      const customClientId = req.headers["x-pluggy-client-id"];
      const customClientSecret = req.headers["x-pluggy-client-secret"];
      const apiKey = await getPluggyApiKey(customClientId, customClientSecret);

      await axios.delete(`${PLUGGY_API_URL}/items/${itemId}`, {
        headers: { "X-API-KEY": apiKey },
      });

      // Se passou clientId, remove também do Firestore
      if (clientId) {
        await db.collection("clientes").doc(clientId).collection("open_finance_items").doc(itemId).delete();
      }

      return res.status(200).json({ success: true, message: "Item desconectado com sucesso." });
    } catch (error) {
      console.error("Erro ao excluir Item Pluggy:", error.response?.data || error.message);
      return res.status(500).json({
        error: "Falha ao desconectar Item da Pluggy",
        details: error.response?.data || error.message,
      });
    }
  });
});

/**
 * Endpoint 4: Webhook da Pluggy (Atualizações automáticas)
 * POST /pluggyWebhook
 */
exports.pluggyWebhook = onRequest({ cors: true }, async (req, res) => {
  try {
    const event = req.body;
    console.log("Pluggy Webhook recebido:", event?.event, event?.itemId);

    // Eventos comuns: item/created, item/updated, transactions/new
    if (event && event.itemId) {
      // Salva log do webhook para auditoria
      await db.collection("open_finance_webhooks").add({
        ...event,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erro no processamento do Webhook:", error.message);
    return res.status(500).json({ error: "Erro interno no webhook" });
  }
});
