const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { PluggyClient } = require("pluggy-sdk");
const axios = require("axios");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

const PLUGGY_API_URL = "https://api.pluggy.ai";

/**
 * Cria uma instância do PluggyClient com suporte a chaves passadas por header ou variáveis de ambiente
 */
function getPluggyClient(clientId, clientSecret) {
  const cid = clientId || process.env.PLUGGY_CLIENT_ID;
  const csecret = clientSecret || process.env.PLUGGY_CLIENT_SECRET;

  if (!cid || !csecret) {
    throw new Error("Credenciais da Pluggy (CLIENT_ID ou CLIENT_SECRET) não configuradas.");
  }

  return new PluggyClient({
    clientId: cid,
    clientSecret: csecret,
  });
}

/**
 * Obtém API Key da Pluggy usando CLIENT_ID e CLIENT_SECRET (Fallback Axios)
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

      const pluggy = getPluggyClient(customClientId, customClientSecret);
      const options = {};
      if (clientUserId) options.clientUserId = clientUserId;

      const tokenData = await pluggy.createConnectToken(itemId || undefined, Object.keys(options).length > 0 ? options : undefined);

      return res.status(200).json({
        accessToken: tokenData.accessToken,
      });
    } catch (error) {
      console.error("Tentando fallback axios para Connect Token devido a:", error.response?.data || error.message);
      try {
        const apiKey = await getPluggyApiKey(req.headers["x-pluggy-client-id"], req.headers["x-pluggy-client-secret"]);
        const payload = {};
        if (req.body?.clientUserId) payload.clientUserId = req.body.clientUserId;
        if (req.body?.itemId) payload.itemId = req.body.itemId;

        const tokenResp = await axios.post(`${PLUGGY_API_URL}/connect_token`, payload, {
          headers: { "X-API-KEY": apiKey },
        });

        return res.status(200).json({
          accessToken: tokenResp.data.accessToken,
        });
      } catch (fallbackErr) {
        console.error("Erro no fallback ao criar Connect Token:", fallbackErr.response?.data || fallbackErr.message);
        return res.status(500).json({
          error: "Falha ao gerar Connect Token da Pluggy",
          details: fallbackErr.response?.data || fallbackErr.message || error.message,
        });
      }
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
      const pluggy = getPluggyClient(customClientId, customClientSecret);

      const [item, accountsData] = await Promise.all([
        pluggy.fetchItem(itemId),
        pluggy.fetchAccounts(itemId),
      ]);

      return res.status(200).json({
        item: item,
        accounts: accountsData.results || [],
      });
    } catch (error) {
      console.error("Erro ao consultar Item Pluggy via SDK, tentando fallback:", error.message);
      try {
        const itemId = req.query.itemId || req.body?.itemId;
        const apiKey = await getPluggyApiKey(req.headers["x-pluggy-client-id"], req.headers["x-pluggy-client-secret"]);
        const [itemResp, accountsResp] = await Promise.all([
          axios.get(`${PLUGGY_API_URL}/items/${itemId}`, { headers: { "X-API-KEY": apiKey } }),
          axios.get(`${PLUGGY_API_URL}/accounts?itemId=${itemId}`, { headers: { "X-API-KEY": apiKey } }),
        ]);

        return res.status(200).json({
          item: itemResp.data,
          accounts: accountsResp.data.results || [],
        });
      } catch (fallbackErr) {
        console.error("Erro ao consultar Item Pluggy:", fallbackErr.response?.data || fallbackErr.message);
        return res.status(500).json({
          error: "Falha ao consultar Item da Pluggy",
          details: fallbackErr.response?.data || fallbackErr.message,
        });
      }
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
      const pluggy = getPluggyClient(customClientId, customClientSecret);

      try {
        await pluggy.deleteItem(itemId);
      } catch (delErr) {
        const apiKey = await getPluggyApiKey(customClientId, customClientSecret);
        await axios.delete(`${PLUGGY_API_URL}/items/${itemId}`, {
          headers: { "X-API-KEY": apiKey },
        });
      }

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
