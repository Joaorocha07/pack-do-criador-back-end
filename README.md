# Backend Pack do Criador

Backend simples para liberar acesso automaticamente depois de uma compra aprovada na Cakto.

## Fluxo

1. Cliente compra o produto na Cakto.
2. A Cakto chama `POST /webhooks/cakto`.
3. O backend verifica se a compra esta paga.
4. O backend cria ou libera o usuario no Neon/Postgres.
5. O backend envia email com login e senha temporaria.
6. O cliente faz login em `POST /auth/login` e recebe um JWT.

## Como rodar

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

No Windows PowerShell, copie o `.env.example` manualmente ou use:

```powershell
Copy-Item .env.example .env
```

## Variaveis importantes

- `DATABASE_URL`: connection string do Neon com `sslmode=require`.
- `JWT_SECRET`: segredo grande para assinar JWT.
- `CAKTO_WEBHOOK_SECRET`: segredo para proteger o webhook.
- `CAKTO_PRODUCT_NAME`: nome do produto que deve liberar acesso.
- `SMTP_*`: dados do provedor de email.
- `APP_URL`: URL do seu frontend/login.

## Deploy no Render

Crie um **Web Service** no Render apontando para este repositorio.

Use estas configuracoes:

```text
Runtime: Node
Build Command: npm run render-build
Start Command: npm start
```

Em **Environment Variables**, adicione:

```text
APP_URL=https://URL-GERADA-PELO-RENDER
DATABASE_URL=sua-url-do-neon
JWT_SECRET=seu-jwt-secret
JWT_EXPIRES_IN=7d
CAKTO_WEBHOOK_SECRET=seu-segredo-do-webhook
ADMIN_IMPORT_SECRET=seu-segredo-de-importacao
CAKTO_PRODUCT_NAME=Pack do Criador
CAKTO_CLIENT_ID=client-id-da-cakto
CAKTO_CLIENT_SECRET=client-secret-da-cakto
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=packdocriador1@gmail.com
SMTP_PASS=sua-senha-de-app-do-google
MAIL_FROM=Pack do Criador <packdocriador1@gmail.com>
```

Nao precisa adicionar `PORT` no Render; ele fornece essa variavel automaticamente.

Depois que o Render gerar a URL, teste:

```text
https://URL-GERADA-PELO-RENDER/health
```

Se responder `{ "ok": true }`, configure na Cakto:

```text
https://URL-GERADA-PELO-RENDER/webhooks/cakto?secret=SEU_CAKTO_WEBHOOK_SECRET
```

## Importar compradores antigos da Cakto

Configure `CAKTO_CLIENT_ID`, `CAKTO_CLIENT_SECRET` e `ADMIN_IMPORT_SECRET` no Render.

Primeiro crie ou promova seu usuario admin:

```http
POST https://URL-GERADA-PELO-RENDER/admin/bootstrap-admin?secret=SEU_ADMIN_IMPORT_SECRET
Content-Type: application/json
```

Body:

```json
{
  "name": "Pack do Criador",
  "email": "packdocriador1@gmail.com",
  "password": "uma-senha-forte"
}
```

Depois faca login em `/auth/login` com esse email e senha. A resposta vai trazer um JWT com `role=ADMIN`.

Use esse token nas rotas administrativas:

```http
POST https://URL-GERADA-PELO-RENDER/admin/import-cakto-purchases
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "sendEmail": true,
  "maxPages": 20
}
```

O importador busca pedidos pagos do produto definido em `CAKTO_PRODUCT_NAME`, cria usuarios no Neon e envia email de acesso quando `sendEmail` for `true`.

### Listar usuarios importados

```http
GET https://URL-GERADA-PELO-RENDER/admin/users
Authorization: Bearer SEU_TOKEN_ADMIN
```

### Enviar email de acesso manualmente

```http
POST https://URL-GERADA-PELO-RENDER/admin/send-access-email
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "email": "cliente@email.com"
}
```

Esse endpoint gera uma nova senha temporaria, envia o email e marca `accessEmailSent=true`.

## Rotas

### `POST /auth/login`

```json
{
  "email": "cliente@email.com",
  "password": "senha-recebida"
}
```

### `GET /auth/me`

Envie o token no header:

```http
Authorization: Bearer SEU_TOKEN
```

### `POST /auth/change-password`

```json
{
  "currentPassword": "senha-recebida",
  "newPassword": "nova-senha-segura"
}
```

### `POST /webhooks/cakto`

Configure essa URL no painel da Cakto:

```text
https://seu-dominio.com/webhooks/cakto?secret=SEU_SEGREDO
```

Se a Cakto permitir enviar header, prefira:

```http
x-cakto-secret: SEU_SEGREDO
```

## O que ajustar com o payload real da Cakto

O arquivo `src/routes/cakto.routes.js` tenta ler campos comuns como:

- `customer.email`
- `customer.name`
- `product.name`
- `status`
- `sale.id`

Quando voce pegar o exemplo oficial do webhook da Cakto, ajuste a funcao `mapCaktoPayload` se os nomes forem diferentes.
# pack-do-criador-back-end
