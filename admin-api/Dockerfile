FROM node:20-slim

# 必要なシステム依存を最小限インストール（Chromium 実行に必要）
RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
	libcups2 libdbus-1-3 libdrm2 libgtk-3-0 libnspr4 libnss3 libx11-6 libx11-xcb1 \
	libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
	libxshmfence1 libxss1 libxtst6 wget \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係のインストール（ロックファイルがあれば優先）
COPY package*.json ./
RUN npm ci

# アプリ本体をコピーしてビルド
COPY . .
# ローカル開発用の .env は本番イメージに含めない（エミュレータ誤接続を防止）
RUN rm -f .env || true
RUN npm run build

# 本番実行に不要なdev依存を削除して軽量化
RUN npm prune --omit=dev

# Playwright の Chromium をイメージに同梱（実行時ダウンロードを避ける）
RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
