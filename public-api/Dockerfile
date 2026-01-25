FROM node:20-slim
WORKDIR /app

# 依存インストール（ロックファイルがあれば利用）
COPY package.json package-lock.json* ./
RUN npm ci || npm i

COPY tsconfig.json ./
COPY src ./src
COPY public-server.ts ./

# ビルド & dev 依存削除
RUN npm run build && npm prune --omit=dev

EXPOSE 8080
CMD ["npm", "start"]
