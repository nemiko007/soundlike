# frontend/Dockerfile

# --- ビルドステージ ---
# Node.jsイメージを使ってフロントエンドをビルド
FROM node:20-slim AS builder

WORKDIR /app

# 依存関係をインストール
COPY package.json package-lock.json ./
RUN npm install

# ソースコードをコピーしてビルド
COPY . .

# ビルド時のメモリ不足対策としてヒープサイズを拡張
ENV NODE_OPTIONS="--max-old-space-size=4096"
# Astroのビルドコマンドを実行
RUN npm run build

# --- 実行ステージ ---
# 軽量なNginxイメージを使って静的ファイルを配信
FROM nginx:alpine

# Nginxの設定ファイルをコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf

# ビルドステージで生成された静的ファイルをNginxの公開ディレクトリにコピー
COPY --from=builder /app/dist /usr/share/nginx/html

# ポート80を公開
EXPOSE 80

# Nginxをフォアグラウンドで起動
CMD ["nginx", "-g", "daemon off;"]
