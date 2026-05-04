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
- `BACKEND_PUBLIC_URL`: URL publica deste backend, usada para montar links autenticados de download.
- `DOWNLOAD_LINK_SECRET`: segredo para assinar links temporarios de download. Se nao definido, usa `JWT_SECRET`.
- `DOWNLOAD_LINK_TTL_SECONDS`: validade do link temporario de download em segundos. Padrao: `900`.

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
BACKEND_PUBLIC_URL=https://URL-GERADA-PELO-RENDER
DOWNLOAD_LINK_TTL_SECONDS=900
DATABASE_URL=sua-url-do-neon
JWT_SECRET=seu-jwt-secret
JWT_EXPIRES_IN=3h
DOWNLOAD_LINK_SECRET=outro-segredo-grande-para-download
CAKTO_WEBHOOK_SECRET=seu-segredo-do-webhook
ADMIN_IMPORT_SECRET=seu-segredo-de-importacao
CAKTO_PRODUCT_NAME=Pack do Criador
CAKTO_CLIENT_ID=client-id-da-cakto
CAKTO_CLIENT_SECRET=client-secret-da-cakto
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=seu-login-smtp-da-brevo
SMTP_PASS=sua-smtp-key-da-brevo
MAIL_FROM=Pack do Criador <email-validado-na-brevo@seudominio.com>
```

Nao precisa adicionar `PORT` no Render; ele fornece essa variavel automaticamente.

### Envio de email com Brevo

O backend usa Nodemailer com SMTP, entao nao precisa instalar SDK da Brevo.

No painel da Brevo:

1. Ative emails transacionais/SMTP.
2. Crie ou copie suas credenciais em **SMTP & API > SMTP**.
3. Use o **SMTP login** em `SMTP_USER`.
4. Use uma **SMTP key** em `SMTP_PASS`. Nao use API key nem a senha da conta Brevo.
5. Valide o remetente ou autentique o dominio. O email de `MAIL_FROM` precisa ser um remetente aceito pela Brevo.

Para Render Free, use a porta `2525`, porque portas SMTP comuns como `587` e `465` podem ser bloqueadas pela hospedagem:

```text
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_SECURE=false
```

Se voce estiver em uma instancia paga e quiser usar a porta padrao da Brevo, tambem pode usar `SMTP_PORT=587` com `SMTP_SECURE=false`.

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

### Cadastrar pack de figurinhas

Use essa rota com token de administrador para salvar no banco o link final do storage/CDN.
Esse link deve apontar para fora da Vercel, por exemplo Cloudflare R2, S3, Supabase Storage, Google Drive ou outro CDN.

```http
POST https://URL-GERADA-PELO-RENDER/admin/sticker-packs
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "name": "Icone 3D",
  "description": "Pack de figurinhas de icones 3D",
  "downloadUrl": "https://cdn.seudominio.com/packs/icone-3d.zip",
  "category": "Figurinhas",
  "sortOrder": 1,
  "isActive": true
}
```

Para listar todos os packs como admin:

```http
GET https://URL-GERADA-PELO-RENDER/admin/sticker-packs
Authorization: Bearer SEU_TOKEN_ADMIN
```

### Listar packs no front

Use essa rota com token de usuario logado. Ela retorna apenas packs ativos.
O campo `downloadUrl` retornado para o front e uma URL temporaria assinada pelo backend. Ao acessar essa URL, o backend valida a assinatura e responde apenas com redirect `302` para o arquivo real no storage/CDN, sem trafegar o arquivo pesado pela Vercel.

```http
GET https://URL-GERADA-PELO-RENDER/sticker-packs
Authorization: Bearer SEU_TOKEN
```

Resposta:

```json
{
  "packs": [
    {
      "id": "id-do-pack",
      "name": "Icone 3D",
      "description": "Pack de figurinhas de icones 3D",
      "coverUrl": null,
      "downloadUrl": "https://URL-GERADA-PELO-RENDER/sticker-packs/id-do-pack/download?expires=1234567890&signature=...",
      "category": "Figurinhas"
    }
  ]
}
```

No front, use esse `downloadUrl` como navegacao/anchor direto, nao faca proxy por uma rota `/api` da Vercel. Exemplo: `<a href={pack.downloadUrl}>Baixar</a>`. Se o link expirar, basta buscar `/sticker-packs` novamente para receber outro.

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

### `POST /auth/logout`

Envie o token no header:

```http
Authorization: Bearer SEU_TOKEN
```

Resposta:

```json
{
  "ok": true
}
```

Depois do logout, remova o token salvo no front.

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
