# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

---

# SoundLike - Project Specification

## 1. 概要
SoundLikeは、ユーザーが自作の音楽ファイル(MP3)をアップロードし、共有・視聴できるWebアプリケーションです。
Firebase Authenticationによるユーザー認証と、Go言語による堅牢なバックエンドAPIを備えています。

## 2. 技術スタック
- **Frontend**: React (Astro), Tailwind CSS, Firebase SDK
- **Backend**: Go (Echo Framework)
- **Database**: SQLite (WAL mode enabled)
- **Authentication**: Firebase Authentication (Email/Password)
- **File Storage**: Local Filesystem

## 3. 機能要件

### 3.1 ユーザー認証
- **新規登録/ログイン**: メールアドレスとパスワードによる認証。
- **メール認証**: ファイルアップロードやソーシャル機能の利用にはメール認証が必須。
- **パスワードリセット**: 登録メールアドレスへのリセットリンク送信。
- **アカウント削除**: ユーザーデータ（DBレコード、ファイル、Firebaseアカウント）の完全削除。セキュリティのための再認証フローを含む。

### 3.2 プロフィール管理
- **表示名設定**: ユーザーごとのユニークな表示名を設定可能。
- **重複チェック**: 他のユーザーと重複する表示名は使用不可。

### 3.3 音楽トラック管理
- **アップロード**:
  - MP3ファイルのみ対応。
  - 最大サイズ: 15MB。
  - メタデータ: タイトル（必須）、アーティスト、歌詞。
- **一覧表示**: 新着順に表示（最大50件）。
- **削除**: アップロードした本人のみ削除可能。

### 3.4 ソーシャル機能
- **いいね (Like)**: トラックに対して「いいね」を付与/解除可能。
- **お気に入り一覧**: 自分が「いいね」したトラックの一覧を表示。

### 3.5 フォロー機能
- **ユーザーフォロー**: 他のユーザーをフォロー/フォロー解除可能。
- **フォロー状態**: 特定のユーザーをフォローしているか確認可能。

### 3.6 コメント機能
- **コメント投稿**: トラックに対してコメントを投稿可能（最大500文字）。
- **コメント表示**: トラックごとのコメント一覧を表示。
- **コメント削除**: 自分のコメントを削除可能。

## 4. API仕様 (Backend)

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/tracks` | トラック一覧を取得 (Limit 50) | Optional (for like status) |
| `GET` | `/api/tracks/favorites` | ログインユーザーのお気に入り一覧を取得 | Yes |
| `POST` | `/api/upload` | MP3ファイルのアップロード | Yes (Verified Email) |
| `POST` | `/api/profile` | プロフィール（表示名）の更新 | Yes (Verified Email) |
| `POST` | `/api/track/:id/like` | いいねのトグル (ON/OFF) | Yes (Verified Email) |
| `POST` | `/api/user/:uid/follow` | ユーザーフォローのトグル (ON/OFF) | Yes (Verified Email) |
| `GET` | `/api/user/:uid/follow/status` | フォロー状態の確認 | Yes |
| `GET` | `/api/track/:id/comments` | コメント一覧の取得 | No |
| `POST` | `/api/track/:id/comment` | コメントの投稿 | Yes (Verified Email) |
| `DELETE` | `/api/comment/:id` | コメントの削除 | Yes (Owner only) |
| `DELETE` | `/api/track/:id` | トラックの削除 | Yes (Owner only) |
| `DELETE` | `/api/account` | アカウントと全データの削除 | Yes |

## 5. データベース設計 (SQLite)

### `tracks` テーブル
- **id**: INTEGER (PK, Auto Increment)
- **filename**: TEXT (Unique, UUID + .mp3)
- **title**: TEXT
- **artist**: TEXT
- **lyrics**: TEXT
- **uploader_uid**: TEXT (Firebase UID)
- **uploader_name**: TEXT
- **created_at**: DATETIME

### `likes` テーブル
- **id**: INTEGER (PK, Auto Increment)
- **user_uid**: TEXT
- **track_id**: INTEGER
- **created_at**: DATETIME
- **UNIQUE**: (user_uid, track_id)

### `follows` テーブル
- **follower_uid**: TEXT (PK)
- **following_uid**: TEXT (PK)
- **created_at**: DATETIME

### `comments` テーブル
- **id**: INTEGER (PK, Auto Increment)
- **track_id**: INTEGER
- **user_uid**: TEXT
- **user_name**: TEXT
- **content**: TEXT
- **created_at**: DATETIME

## 6. セキュリティ対策
- **認証・認可**: Firebase Authトークンの検証、メール認証状態のチェック。
- **入力値検証**: 文字数制限、必須項目チェック。
- **ファイルアップロード**:
  - 拡張子制限 (.mp3)
  - MIMEタイプ検証 (Magic number check)
  - ファイル名ランダム化 (UUID) によるディレクトリトラバーサル防止
- **DB保護**:
  - プレースホルダによるSQLインジェクション対策
  - データディレクトリのパーミッション設定 (0700)
  - トランザクション処理による整合性確保
- **HTTPヘッダー**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options等の設定。
- **DoS対策**: レートリミット (20 req/sec), タイムアウト設定 (30s), リクエストボディサイズ制限。
