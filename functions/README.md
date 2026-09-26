# Backend Cloud Functions - Clearview Atlas (Pluggy Open Finance)

Este diretório contém os endpoints seguros do backend para comunicação com a API da **Pluggy** via **Firebase Cloud Functions (2nd Gen)**.

## 🚀 Como Publicar no Firebase

1. Certifique-se de estar logado no Firebase:
   ```bash
   npx firebase login
   ```

2. Configure suas credenciais da Pluggy no Firebase:
   ```bash
   npx firebase functions:secrets:set PLUGGY_CLIENT_ID
   npx firebase functions:secrets:set PLUGGY_CLIENT_SECRET
   ```
   *(Ou configure no arquivo `.env` dentro de `functions/`)*

3. Faça o deploy das funções:
   ```bash
   npx firebase deploy --only functions
   ```

## 📡 Endpoints Disponíveis

- **`POST /createPluggyConnectToken`**: Gera o `accessToken` (30 min) para abrir o Widget PluggyConnect no app.
- **`GET /getPluggyItem?itemId=...`**: Consulta dados da instituição conectada e contas.
- **`POST /deletePluggyItem`**: Desconecta uma instituição e revoga o consentimento.
- **`POST /pluggyWebhook`**: Endpoint para receber notificações automáticas em tempo real da Pluggy.
