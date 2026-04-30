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
