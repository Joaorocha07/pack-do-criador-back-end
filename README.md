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
- `STICKER_STORAGE_DIR`: pasta privada onde as imagens das figurinhas ficam salvas.
- `STICKER_UPLOAD_MAX_IMAGE_MB`: limite por imagem, padrao `20`.
- `STICKER_UPLOAD_MAX_FILES`: limite de arquivos por upload, padrao `200`.
- `STICKER_UPLOAD_MAX_REQUEST_MB`: limite total do multipart, padrao `512`.

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
JWT_EXPIRES_IN=3h
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
STICKER_STORAGE_DIR=./.private/stickers
STICKER_UPLOAD_MAX_IMAGE_MB=20
STICKER_UPLOAD_MAX_FILES=200
STICKER_UPLOAD_MAX_REQUEST_MB=512
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

## Figurinhas protegidas

As URLs retornadas apontam para endpoints protegidos. O frontend deve enviar o JWT em todas as chamadas, inclusive ao carregar a imagem:

```http
Authorization: Bearer SEU_TOKEN
```

### Cards para o usuario

```http
GET /stickers/categories
```

Retorna:

```json
{
  "categories": [
    {
      "id": "cat_123",
      "slug": "acessorios",
      "title": "Acessórios",
      "description": "Figurinhas para stories de moda e beleza.",
      "totalStickers": 304,
      "coverUrl": "/stickers/images/img_abc"
    }
  ]
}
```

### Imagens de uma categoria

```http
GET /stickers/categories/:id/images
```

Retorna:

```json
{
  "category": {
    "id": "cat_123",
    "title": "Acessórios",
    "description": "Figurinhas para stories de moda e beleza."
  },
  "images": [
    {
      "id": "img_abc",
      "name": "brincos.png",
      "url": "/stickers/images/img_abc",
      "downloadUrl": "/stickers/images/img_abc/download"
    }
  ]
}
```

### Servir imagem ou download

```http
GET /stickers/images/:id
GET /stickers/images/:id/download
```

### Admin: criar categoria

```http
POST /admin/stickers/categories
Content-Type: application/json
```

```json
{
  "title": "Acessórios",
  "description": "Figurinhas para stories de moda e beleza."
}
```

### Admin: editar categoria e capa

```http
PATCH /admin/stickers/categories/:id
Content-Type: application/json
```

```json
{
  "title": "Acessórios",
  "description": "Nova descrição",
  "coverImageId": "uuid-da-imagem"
}
```

### Admin: upload multiplo

```http
POST /admin/stickers/categories/:id/images
Content-Type: multipart/form-data
```

Campo do form:

```text
files: File[]
```

O backend aceita PNG, JPG, JPEG e WEBP, valida o MIME e a assinatura real do arquivo, salva em storage privado local e nunca expoe `storageKey` na resposta.

### Admin: remover categoria

```http
DELETE /admin/stickers/categories/:id
```

Remove a categoria e as imagens dela no banco. Os arquivos locais tambem sao apagados em segundo plano.

## SQL das tabelas de figurinhas no Neon

O arquivo `prisma/init-neon.sql` ja foi atualizado. Se for criar manualmente, rode a parte de `StickerCategory` e `StickerImage` no editor SQL do Neon.

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
