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

# ビルド時に環境変数を受け取るためのARG設定
ARG PUBLIC_FIREBASE_API_KEY
ARG PUBLIC_FIREBASE_AUTH_DOMAIN
ARG PUBLIC_FIREBASE_PROJECT_ID
ARG PUBLIC_FIREBASE_STORAGE_BUCKET
ARG PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG PUBLIC_FIREBASE_APP_ID
ARG PUBLIC_FIREBASE_MEASUREMENT_ID

# 受け取ったARGを環境変数として設定（ビルドコマンドで利用可能にする）
ENV PUBLIC_FIREBASE_API_KEY=$PUBLIC_FIREBASE_API_KEY
ENV PUBLIC_FIREBASE_AUTH_DOMAIN=$PUBLIC_FIREBASE_AUTH_DOMAIN
ENV PUBLIC_FIREBASE_PROJECT_ID=$PUBLIC_FIREBASE_PROJECT_ID
ENV PUBLIC_FIREBASE_STORAGE_BUCKET=$PUBLIC_FIREBASE_STORAGE_BUCKET
ENV PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV PUBLIC_FIREBASE_APP_ID=$PUBLIC_FIREBASE_APP_ID
ENV PUBLIC_FIREBASE_MEASUREMENT_ID=$PUBLIC_FIREBASE_MEASUREMENT_ID

# 【追加】変数が正しく渡されているかチェック（値が空ならエラーを出して停止）
RUN if [ -z "$PUBLIC_FIREBASE_API_KEY" ]; then echo "ERROR: PUBLIC_FIREBASE_API_KEY is not set during build."; exit 1; fi

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
