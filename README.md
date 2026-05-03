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
- `CHECKOUT_AFFILIATE_URL`: link de checkout com afiliada.
- `CHECKOUT_OWN_URL`: link de checkout sem afiliada.
- `CHECKOUT_ROTATION_SOURCE`: use `purchases` para alternar por vendas registradas ou `users` para alternar por usuarios com acesso.
- `SMTP_*`: dados do provedor de email.
- `APP_URL`: URL do seu frontend/login.
- `CORS_ORIGINS`: origens permitidas pelo CORS, separadas por virgula. Em producao, inclua `https://packdocriador.com`.
- `STICKER_STORAGE_DIR`: pasta privada onde as imagens das figurinhas ficam salvas.
- `STICKER_UPLOAD_MAX_IMAGE_MB`: limite por imagem, padrao `20`.
- `STICKER_UPLOAD_MAX_FILES`: limite de arquivos por upload, padrao `1000`.
- `STICKER_UPLOAD_MAX_REQUEST_MB`: limite total do multipart, padrao `512`.
- `STICKER_DELIVERY_MODE`: use `proxy` para a API fazer stream das imagens ou `redirect` para redirecionar para uma URL publica/Worker do R2 depois de validar o usuario.

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
CHECKOUT_AFFILIATE_URL=https://pay.cakto.com.br/wjzbfzc_596335?affiliate=6daZPhsr
CHECKOUT_OWN_URL=https://pay.cakto.com.br/wjzbfzc_596335
CHECKOUT_AFFILIATE_SALES_BEFORE_OWN=3
CHECKOUT_ROTATION_SOURCE=purchases
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

### Storage com Cloudflare R2

Para nao perder imagens em deploy, restart ou troca de instancia no Render, use R2 em producao.

No painel da Cloudflare:

1. Acesse **R2 Object Storage** em **Armazenamento e banco**.
2. Crie um bucket, por exemplo `pack-do-criador-stickers`.
3. Abra **Manage R2 API Tokens**.
4. Crie um token com permissao de leitura e escrita no bucket.
5. Copie `Access Key ID`, `Secret Access Key` e o `Account ID`.

No Render, configure:

```text
STICKER_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=seu-account-id
R2_BUCKET=pack-do-criador-stickers
R2_ACCESS_KEY_ID=sua-access-key-id
R2_SECRET_ACCESS_KEY=sua-secret-access-key
STICKER_STORAGE_MAX_MB=9500
```

O `R2_ENDPOINT` e opcional. Se precisar informar manualmente:

```text
R2_ENDPOINT=https://SEU_ACCOUNT_ID.r2.cloudflarestorage.com
```

Depois faca deploy novamente. As imagens enviadas depois dessa configuracao ficam salvas no R2. Registros antigos que apontavam para arquivos locais perdidos precisam ser reenviados.

`STICKER_STORAGE_MAX_MB` trava novos uploads quando a soma das imagens no banco mais o lote enviado passar do limite. Use `9500` para ficar perto de 9.5GB, abaixo do free tier de 10GB do R2. Use `9.5` apenas se quiser testar a trava em 9.5MB.

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

## Deploy na Railway

Crie um projeto na Railway apontando para este repositorio.

Use estas configuracoes:

```text
Build Command: npm run railway-build
Start Command: npm start
```

Configure as variaveis do ambiente de producao na Railway. Para este projeto, o conjunto minimo esperado e:

```text
APP_URL=https://packdocriador.com
CORS_ORIGINS=https://packdocriador.com,https://www.packdocriador.com
DATABASE_URL=sua-url-do-neon
JWT_SECRET=gere-um-novo-segredo-grande
JWT_EXPIRES_IN=7d
CAKTO_WEBHOOK_SECRET=gere-um-novo-segredo-do-webhook
ADMIN_IMPORT_SECRET=gere-um-novo-segredo-de-importacao
CAKTO_PRODUCT_NAME=Pack do Criador
CAKTO_CLIENT_ID=client-id-da-cakto
CAKTO_CLIENT_SECRET=client-secret-da-cakto
CHECKOUT_AFFILIATE_URL=https://pay.cakto.com.br/wjzbfzc_596335?affiliate=6daZPhsr
CHECKOUT_OWN_URL=https://pay.cakto.com.br/wjzbfzc_596335
CHECKOUT_AFFILIATE_SALES_BEFORE_OWN=3
CHECKOUT_ROTATION_SOURCE=purchases
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=seu-login-smtp-da-brevo
SMTP_PASS=sua-smtp-key-da-brevo
MAIL_FROM=Pack do Criador <email-validado-na-brevo@seudominio.com>
SUPPORT_EMAIL=packdocriador1@gmail.com
STICKER_STORAGE_DRIVER=r2
STICKER_UPLOAD_MAX_IMAGE_MB=20
STICKER_UPLOAD_MAX_FILES=1000
STICKER_UPLOAD_MAX_REQUEST_MB=512
STICKER_STORAGE_MAX_MB=9500
R2_ACCOUNT_ID=seu-account-id
R2_BUCKET=pack-do-criador-stickers
R2_ACCESS_KEY_ID=access-key-id-rotacionado
R2_SECRET_ACCESS_KEY=secret-access-key-rotacionado
```

Nao configure `PORT`; a Railway injeta essa variavel automaticamente.

Depois do deploy, teste:

```text
https://URL-DA-API.up.railway.app/health
https://URL-DA-API.up.railway.app/health/db
```

Quando os health checks responderem, configure no frontend:

```text
BACKEND_API_URL=https://URL-DA-API.up.railway.app
```

Atualize tambem o webhook da Cakto para a nova API:

```text
https://URL-DA-API.up.railway.app/webhooks/cakto?secret=SEU_CAKTO_WEBHOOK_SECRET
```

### Entrega das imagens via R2 ou Worker

Por padrao, as URLs de figurinhas continuam protegidas e a API faz stream do arquivo:

```text
STICKER_DELIVERY_MODE=proxy
```

Se voce criar um dominio publico controlado no R2 ou um Cloudflare Worker para entregar objetos, pode reduzir trafego da Railway:

```text
STICKER_DELIVERY_MODE=redirect
R2_PUBLIC_BASE_URL=https://imagens.seudominio.com
```

Nesse modo, a API ainda valida JWT, acesso ativo e aparelho antes de responder. Depois disso, ela redireciona para `R2_PUBLIC_BASE_URL` com o caminho do objeto. Se o bucket ficar publico, qualquer pessoa com a URL final pode abrir o arquivo; para manter protecao forte, use um Worker com URLs temporarias ou validacao propria.

### Checklist pos-migracao

Teste estes fluxos antes de desligar o Render:

- `GET /health` e `GET /health/db`.
- Login e `GET /auth/me`.
- Area de membros no frontend em `https://packdocriador.com`.
- `GET /stickers/categories`.
- Listagem, visualizacao e download de figurinhas.
- Upload admin em `/admin/stickers/categories/:id/images`.
- `GET /checkout/link`.
- Webhook real ou teste da Cakto em `/webhooks/cakto`.

Como segredos foram expostos fora do ambiente, rotacione antes de colocar a Railway em producao: JWT, R2, Cakto, SMTP e, se possivel, a credencial do Neon.

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

### Importar afiliados manualmente

A API publica da Cakto retorna afiliados comissionados em pedidos, mas nao expõe a lista completa de **Meus Afiliados** do painel. Para fazer esses afiliados aparecerem em `/admin/users`, importe os emails uma vez:

```http
POST https://URL-GERADA-PELO-RENDER/admin/import-affiliates
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "affiliates": [
    {
      "name": "-",
      "email": "isalellis01@gmail.com",
      "productName": "Pack do Criador",
      "commissionPercentage": 75,
      "status": "Ativo"
    },
    {
      "name": "Ana",
      "email": "lauraana.brum@gmail.com",
      "productName": "Pack do Criador",
      "commissionPercentage": 30,
      "status": "Ativo"
    }
  ]
}
```

Retorna `{ "ok": true, "summary": { ... }, "users": [ ... ] }`.

### Listar usuarios e afiliados

```http
GET https://URL-GERADA-PELO-RENDER/admin/users
Authorization: Bearer SEU_TOKEN_ADMIN
```

Por padrao, a resposta junta os usuarios salvos no Neon com afiliados encontrados nos pedidos pagos da Cakto para o produto configurado em `CAKTO_PRODUCT_NAME`. Afiliados que ja existem no Neon nao sao duplicados.

Retorna:

```json
{
  "ok": true,
  "users": [
    {
      "id": "USER_ID",
      "name": "Cliente",
      "email": "cliente@email.com",
      "role": "USER",
      "roleLabel": "user",
      "hasAccess": true,
      "temporaryPassword": false,
      "profile": {
        "id": "PROFILE_ID",
        "role": "USER",
        "roleLabel": "user",
        "temporarilyDisabled": false,
        "disabledUntil": null,
        "disabledReason": null,
        "deviceId": "DEVICE_ID_DO_USUARIO",
        "deviceBoundAt": "2026-05-01T00:00:00.000Z",
        "deviceBlockedEmailSentAt": null,
        "deviceBound": true,
        "requiresDeviceId": true
      }
    },
    {
      "id": "cakto-affiliate-123",
      "name": "-",
      "email": "afiliado@email.com",
      "role": "AFILIADO",
      "roleLabel": "afiliado",
      "hasAccess": false,
      "source": "cakto",
      "affiliate": {
        "id": 123,
        "productName": "Pack do Criador",
        "commissionPercentage": 30,
        "commissionValue": 29.9,
        "lastOrderId": "ORDER_ID",
        "lastOrderDate": "2026-05-01T00:00:00.000Z"
      }
    }
  ],
  "sources": {
    "database": 1,
    "caktoAffiliates": 1
  },
  "warnings": []
}
```

Roles aceitos pelo front: `admin`, `user`, `teste`, `afiliado`.

### Admin: alterar tipo de perfil

```http
PATCH https://URL-GERADA-PELO-RENDER/admin/users/USER_ID/role
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "role": "afiliado"
}
```

Retorna `{ "ok": true, "message": "Tipo de perfil atualizado.", "user": { ... } }`.

### Admin: desativar conta temporariamente

```http
PATCH https://URL-GERADA-PELO-RENDER/admin/users/USER_ID/temporary-disable
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "disabledUntil": "2026-05-08T23:59:59.000Z",
  "reason": "Pausa temporaria solicitada pelo suporte."
}
```

Enquanto estiver desativado, login e endpoints protegidos retornam `403` com `disabledUntil` e `disabledReason`.

### Admin: reativar conta

```http
DELETE https://URL-GERADA-PELO-RENDER/admin/users/USER_ID/temporary-disable
Authorization: Bearer SEU_TOKEN_ADMIN
```

Retorna `{ "ok": true, "message": "Conta reativada.", "user": { ... } }`.

### Admin: alterar senha de um perfil

```http
PATCH https://URL-GERADA-PELO-RENDER/admin/users/USER_ID/password
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "password": "nova-senha-segura",
  "temporaryPassword": false
}
```

Retorna `{ "ok": true, "message": "Senha do perfil atualizada.", "user": { ... } }`.

### Admin: alterar aparelho vinculado

```http
PATCH https://URL-GERADA-PELO-RENDER/admin/users/USER_ID/device
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_ADMIN
```

Body:

```json
{
  "deviceId": "DEVICE_ID_NOVO"
}
```

Retorna `{ "ok": true, "message": "Aparelho do perfil atualizado.", "user": { ... } }`.

### Admin: resetar aparelho vinculado

```http
DELETE https://URL-GERADA-PELO-RENDER/admin/users/USER_ID/device
Authorization: Bearer SEU_TOKEN_ADMIN
```

Retorna `{ "ok": true, "message": "Vinculo de aparelho resetado.", "user": { ... } }`. No proximo login/acesso do perfil `user`, o primeiro `deviceId` enviado vira o aparelho vinculado. A API tambem envia um email avisando que o aparelho foi resetado e que o proximo login deve ser feito no aparelho/navegador que a pessoa quer manter cadastrado.

### Login com ID do aparelho

Perfis `user` precisam enviar o mesmo `deviceId` no login e nas chamadas protegidas. O front pode gerar um UUID uma vez e salvar em `localStorage`.

```http
POST https://URL-GERADA-PELO-RENDER/auth/login
Content-Type: application/json
x-device-id: DEVICE_ID_DO_APARELHO
```

Body:

```json
{
  "email": "cliente@email.com",
  "password": "senha-do-cliente",
  "deviceId": "DEVICE_ID_DO_APARELHO"
}
```

Em chamadas protegidas do usuario, envie:

```http
Authorization: Bearer SEU_TOKEN
x-device-id: DEVICE_ID_DO_APARELHO
```

Se o perfil `user` tentar acessar de outro aparelho, a API retorna `403` e envia um email explicando que a conta so pode ser acessada no aparelho e navegador cadastrados. O email orienta a pedir reset em `SUPPORT_EMAIL`, por padrao `packdocriador1@gmail.com`. O reenvio desse aviso respeita `DEVICE_BLOCK_ALERT_INTERVAL_MINUTES`, padrao `60`.

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
GET /stickers/categories/:id/images?page=2&limit=60
GET /stickers/categories/:id/images?offset=60&limit=60
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
    "page": 1,
    "offset": 0,
    "hasNextPage": true,
    "nextCursor": "img_abc",
    "nextPage": 2,
    "nextOffset": 60
  }
}
```

Use `nextPage`, `nextOffset` ou `nextCursor` na proxima chamada para carregar o proximo lote. O limite padrao e 60 imagens por chamada, com maximo de 200.

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

### Admin: uso do storage

```http
GET /admin/stickers/storage-usage
Authorization: Bearer SEU_TOKEN_ADMIN
```

Retorna o total usado no storage ativo e o limite configurado em `STICKER_STORAGE_MAX_MB`. Quando `STICKER_STORAGE_DRIVER=r2`, o uso vem do bucket Cloudflare R2; `databaseBytes` fica apenas como referencia dos metadados salvos no Neon.

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

### `GET /checkout/link`

Endpoint publico, sem JWT, para buscar o link de venda da vez.

Com `CHECKOUT_AFFILIATE_SALES_BEFORE_OWN=3`, o ciclo fica assim:

- posicoes 1, 2 e 3: `CHECKOUT_AFFILIATE_URL`
- posicao 4: `CHECKOUT_OWN_URL`
- posicao 5: reinicia no link afiliado

Resposta:

```json
{
  "url": "https://pay.cakto.com.br/wjzbfzc_596335?affiliate=6daZPhsr",
  "target": "affiliate",
  "source": "purchases",
  "currentCount": 0,
  "nextPosition": 1,
  "cycleSize": 4,
  "affiliateSlots": 3
}
```

Se quiser redirecionar direto para a Cakto, use:

```text
GET /checkout/link?redirect=true
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
