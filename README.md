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
- `STICKER_UPLOAD_MAX_FILES`: limite de arquivos por upload, padrao `1000`.
- `STICKER_UPLOAD_MAX_REQUEST_MB`: limite total do multipart, padrao `512`.

> Na Vercel, Functions tem limite de payload de 4.5MB por request. Se este backend estiver rodando na Vercel, configure `STICKER_UPLOAD_MAX_IMAGE_MB=4` e `STICKER_UPLOAD_MAX_REQUEST_MB=4`, ou envie as figurinhas em lotes menores pelo frontend. Requests maiores sao barrados pela propria Vercel antes de chegar no Express.
> Para figurinhas protegidas em producao, prefira uma hospedagem com disco persistente ou um storage externo. O `STICKER_STORAGE_DIR` local nao e uma boa base duravel para arquivos enviados em Functions serverless.

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
STICKER_UPLOAD_MAX_FILES=1000
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
      "coverImageId": "img_abc",
      "coverUrl": "/stickers/images/img_abc"
    }
  ]
}
```

### Imagens de uma categoria

```http
GET /stickers/categories/:id/images?limit=60
GET /stickers/categories/:id/images?limit=60&cursor=img_abc
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
  ],
  "pagination": {
    "limit": 60,
    "hasNextPage": true,
    "nextCursor": "img_abc"
  }
}
```

Use `nextCursor` na proxima chamada para carregar o proximo lote. O limite padrao e 60 imagens por chamada, com maximo de 200.

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

### Admin: listar categorias

```http
GET /admin/stickers/categories
```

Retorna os mesmos cards de `GET /stickers/categories`, com `coverImageId` e `coverUrl`.

### Admin: detalhar categoria

```http
GET /admin/stickers/categories/:id
```

Retorna `category` e `images` para a tela de edicao do admin.

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

`coverImageId` e opcional. Envie `null` para remover a capa manual. Se nao houver capa, o card usa a primeira figurinha da categoria como fallback.

### Admin: definir ou remover capa

```http
PUT /admin/stickers/categories/:id/cover
Content-Type: application/json
```

```json
{
  "imageId": "img_abc"
}
```

```http
DELETE /admin/stickers/categories/:id/cover
```

Ambos retornam `{ "category": { ... } }`.

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

Se o backend estiver hospedado na Vercel, cada chamada deste endpoint precisa ficar abaixo de 4.5MB no total. Para uploads grandes, envie uma imagem por request ou divida em lotes pequenos; em hospedagens como Render, o limite pode ser controlado por `STICKER_UPLOAD_MAX_REQUEST_MB`.

Exemplo de envio no frontend:

```js
async function uploadStickerBatch({ apiUrl, categoryId, files, token }) {
  const formData = new FormData();

  for (const file of files) {
    formData.append("files", file, file.name);
  }

  const response = await fetch(`${apiUrl}/admin/stickers/categories/${categoryId}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Nao foi possivel enviar a figurinha.");
  }

  return data;
}
```

Nao defina `Content-Type` manualmente nesse `fetch`; o navegador precisa gerar o `multipart/form-data` com `boundary`. Tambem nao envie arquivo como base64 ou JSON.

Para Vercel, divida os arquivos em lotes pequenos antes de chamar o endpoint:

```js
const VERCEL_SAFE_UPLOAD_BYTES = Math.floor(3.8 * 1024 * 1024);

function splitFilesForVercel(files, maxBytes = VERCEL_SAFE_UPLOAD_BYTES) {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const file of files) {
    if (file.size >= maxBytes) {
      throw new Error(`O arquivo ${file.name} tem mais de 3.8MB. Comprima ou redimensione antes de enviar.`);
    }

    if (currentBatch.length && currentSize + file.size > maxBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(file);
    currentSize += file.size;
  }

  if (currentBatch.length) {
    batches.push(currentBatch);
  }

  return batches;
}

async function uploadStickers({ apiUrl, categoryId, files, token }) {
  const batches = splitFilesForVercel(Array.from(files));
  const results = [];

  for (const batch of batches) {
    results.push(await uploadStickerBatch({ apiUrl, categoryId, files: batch, token }));
  }

  return results;
}
```

Resposta:

```json
{
  "uploaded": 2,
  "category": {
    "id": "cat_123",
    "slug": "acessorios",
    "title": "Acessorios",
    "description": "Figurinhas para stories de moda e beleza.",
    "totalStickers": 304,
    "coverImageId": "img_abc",
    "coverUrl": "/stickers/images/img_abc"
  },
  "images": [
    {
      "id": "img_abc",
      "categoryId": "cat_123",
      "name": "brincos.png",
      "originalName": "brincos.png",
      "mimeType": "image/png",
      "size": 123456,
      "url": "/stickers/images/img_abc",
      "downloadUrl": "/stickers/images/img_abc/download",
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

### Admin: editar nome da figurinha

```http
PATCH /admin/stickers/images/:id
Content-Type: application/json
```

```json
{
  "name": "brincos dourados.png"
}
```

Retorna `{ "image": { ... } }`.

### Admin: excluir figurinha

```http
DELETE /admin/stickers/images/:id
```

Retorna `{ "ok": true, "deletedImageId": "img_abc", "category": { ... } }`.

### Admin: remover categoria

```http
DELETE /admin/stickers/categories/:id
```

Remove a categoria e as imagens dela no banco. Os arquivos locais tambem sao apagados em segundo plano.

## SQL das tabelas de figurinhas no Neon

O arquivo `prisma/init-neon.sql` ja foi atualizado. Se for criar manualmente, rode a parte de `StickerCategory`, `StickerImage` e `StickerCategoryCover` no editor SQL do Neon.

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
