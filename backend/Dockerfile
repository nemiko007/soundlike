# backend/Dockerfile

# --- ビルドステージ ---
# Goのイメージを使ってアプリケーションをビルド
FROM golang:1.24-alpine AS builder

# CGOを有効にするために必要なビルドツールをインストール
RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# 依存関係をダウンロードしてキャッシュ
COPY go.mod go.sum ./
RUN go mod download

# ソースコードをコピー
COPY . .

# アプリケーションをビルド
# CGOを有効にしてビルドする（go-sqlite3に必要）
# -ldflags "-s -w" でデバッグ情報を削除し、バイナリサイズを削減
RUN go build -ldflags "-s -w" -o soundlike-backend .

# --- 実行ステージ ---
# 軽量なalpineイメージを使って最終的なコンテナを小さくする
FROM alpine:latest

WORKDIR /root/

# soundlike.dbとuploadsディレクトリを空で追加
# これらは永続化のためにボリュームとしてマウントされることを想定
RUN mkdir -p /root/uploads /root/data

# サービスアカウントキーはローカルまたはシークレットとして提供されるべき
# Dockerイメージに含めるべきではないが、開発・テスト用に配置するパスを確保
# COPY backend/firebase-service-account-key.json /root/firebase-service-account-key.json # 本番環境では非推奨

# ビルドステージで作成した実行ファイルをコピー
COPY --from=builder /app/soundlike-backend .

# サービスアカウントキーのパスを環境変数で渡すか、マウントする
# 例: -v /path/to/your/key.json:/root/firebase-service-account-key.json
# または: -e GOOGLE_APPLICATION_CREDENTIALS=/root/firebase-service-account-key.json

# ポート8080を公開
EXPOSE 8080

# アプリケーションを実行
CMD ["./soundlike-backend"]
