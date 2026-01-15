package main

import (
	"context"
	"database/sql"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/google/uuid" // 追加
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	_ "github.com/mattn/go-sqlite3"
)

// Track構造体: データベースのレコードをGoのオブジェクトとして扱うため
type Track struct {
	ID           int       `json:"id"`
	Filename     string    `json:"filename"`
	Title        string    `json:"title"`
	Artist       string    `json:"artist"`
	Lyrics       string    `json:"lyrics"`
	UploaderUID  string    `json:"uploader_uid"`
	UploaderName string    `json:"uploader_name"` // 追加
	CreatedAt    time.Time `json:"created_at"`
	LikesCount   int       `json:"likes_count"`
	IsLiked      bool      `json:"is_liked"`
}

// firebaseAuthMiddleware は、リクエストヘッダーからIDトークンを検証するミドルウェア
func firebaseAuthMiddleware(app *firebase.App) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authClient, err := app.Auth(context.Background())
			if err != nil {
				log.Printf("error getting Auth client: %v\n", err)
				return c.JSON(http.StatusInternalServerError, "Firebase Auth client error")
			}

			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				return c.JSON(http.StatusUnauthorized, "Authorization header is missing")
			}

			idToken := strings.TrimSpace(strings.Replace(authHeader, "Bearer", "", 1))
			if idToken == "" {
				return c.JSON(http.StatusUnauthorized, "ID token is missing")
			}

			token, err := authClient.VerifyIDToken(context.Background(), idToken)
			if err != nil {
				log.Printf("error verifying ID token: %v\n", err)
				return c.JSON(http.StatusForbidden, "Invalid ID token")
			}

			c.Set("user", token)
			return next(c)
		}
	}
}

var db *sql.DB // グローバル変数としてデータベース接続を保持

func main() {
	ctx := context.Background()
	// render.yamlで設定したGOOGLE_APPLICATION_CREDENTIALS環境変数を自動的に読み込むようにするため、
	// 明示的なファイルパス指定を削除します。
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		log.Fatalf("error initializing app: %v\n", err)
	}

	// === SQLiteデータベースの初期化 ===
	dataDir := "./data"
	if _, err := os.Stat(dataDir); os.IsNotExist(err) {
		// 0700: 所有者のみが読み書き実行可能 (外部からのアクセスを遮断)
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			log.Fatalf("error creating data directory: %v\n", err)
		}
	}
	// 2. SQLiteのWALモードを有効化 (同時書き込み性能の向上とロックエラー防止)
	db, err = sql.Open("sqlite3", filepath.Join(dataDir, "soundlike.db?_journal_mode=WAL"))
	if err != nil {
		log.Fatalf("error opening database: %v\n", err)
	}
	defer db.Close() // サーバー終了時にデータベース接続を閉じる

	// tracksテーブルを作成（もし存在しなければ）
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS tracks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT NOT NULL UNIQUE,
		title TEXT NOT NULL,
		artist TEXT,
		lyrics TEXT,
		uploader_uid TEXT NOT NULL,
		uploader_name TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatalf("error creating tracks table: %v\n", err)
	}

	// likesテーブルを作成
	createLikesTableSQL := `
	CREATE TABLE IF NOT EXISTS likes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_uid TEXT NOT NULL,
		track_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_uid, track_id)
	);`
	if _, err := db.Exec(createLikesTableSQL); err != nil {
		log.Fatalf("error creating likes table: %v\n", err)
	}

	// 既存のテーブルに uploader_name カラムがない場合に追加するための処理（簡易マイグレーション）
	// エラーが発生しても（カラムが既に存在するなど）、ログを出して続行します
	if _, err := db.Exec("ALTER TABLE tracks ADD COLUMN uploader_name TEXT"); err != nil {
		log.Println("Info: uploader_name column might already exist or could not be added:", err)
	}
	log.Println("Database initialized successfully.")

	e := echo.New()
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	// 1. セキュリティヘッダーの追加 (XSS, HSTS, Sniffing対策)
	// 4. CSPを追加して、万が一のXSSリスクをさらに低減
	e.Use(middleware.SecureWithConfig(middleware.SecureConfig{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline';", // APIサーバーなので厳格に
	}))

	// 2. レートリミット (簡易的なメモリ保存: 1秒あたり20リクエストまで)
	e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStore(20)))

	// 3. タイムアウト設定 (30秒でタイムアウト) - Slowloris対策
	e.Use(middleware.TimeoutWithConfig(middleware.TimeoutConfig{
		Timeout: 30 * time.Second,
	}))

	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		// localhostと、デプロイされたフロントエンドのURLを許可します。
		// "https://frontend-xxxx.onrender.com" の部分はご自身のフロントエンドのURLに置き換えてください。
		AllowOrigins: []string{"http://localhost:3000", "https://frontend-xxxx.onrender.com"},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	// --- 公開エンドポイント ---
	e.Static("/uploads", "uploads")

	e.GET("/api/tracks", func(c echo.Context) error {
		// 任意の認証チェック（ログインしていれば is_liked を判定するため）
		var currentUserID string
		authHeader := c.Request().Header.Get("Authorization")
		if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
			idToken := strings.TrimSpace(strings.Replace(authHeader, "Bearer", "", 1))
			client, err := app.Auth(context.Background())
			if err == nil {
				token, err := client.VerifyIDToken(context.Background(), idToken)
				if err == nil {
					currentUserID = token.UID
				}
			}
		}

		uploaderUID := c.QueryParam("uploader_uid")

		// いいね数と、現在のユーザーがいいねしているかを取得するクエリ
		baseQuery := `
		SELECT 
			t.id, t.filename, t.title, t.artist, t.lyrics, t.uploader_uid, t.uploader_name, t.created_at,
			(SELECT COUNT(*) FROM likes WHERE track_id = t.id) AS likes_count,
			EXISTS(SELECT 1 FROM likes WHERE track_id = t.id AND user_uid = ?) AS is_liked
		FROM tracks t`

		args := []interface{}{currentUserID}
		var queryBuilder strings.Builder
		queryBuilder.WriteString(baseQuery)

		if uploaderUID != "" {
			queryBuilder.WriteString(" WHERE t.uploader_uid = ?")
			args = append(args, uploaderUID)
		}

		// 1. 全件取得によるサーバークラッシュ防止 (LIMIT制限)
		queryBuilder.WriteString(" ORDER BY t.created_at DESC LIMIT 50")

		rows, err := db.Query(queryBuilder.String(), args...)
		if err != nil {
			log.Printf("error querying tracks: %v\n", err)
			return c.JSON(http.StatusInternalServerError, "Error retrieving tracks")
		}
		defer rows.Close()

		tracks := make([]Track, 0)
		for rows.Next() {
			var track Track
			// lyricsとartistはNULL許容のため、sql.NullStringで受け取る
			var artist sql.NullString
			var lyrics sql.NullString
			var uploaderName sql.NullString // uploader_nameもNULL許容として扱う
			if err := rows.Scan(&track.ID, &track.Filename, &track.Title, &artist, &lyrics, &track.UploaderUID, &uploaderName, &track.CreatedAt, &track.LikesCount, &track.IsLiked); err != nil {
				log.Printf("error scanning track row: %v\n", err)
				return c.JSON(http.StatusInternalServerError, "Error processing tracks")
			}
			track.Artist = artist.String
			track.Lyrics = lyrics.String
			track.UploaderName = uploaderName.String // NULLの場合は空文字になる
			tracks = append(tracks, track)
		}

		return c.JSON(http.StatusOK, tracks)
	})

	// --- 認証が必要な保護されたルートグループ ---
	apiGroup := e.Group("/api")
	apiGroup.Use(firebaseAuthMiddleware(app))

	apiGroup.POST("/upload", func(c echo.Context) error {
		user := c.Get("user").(*auth.Token)
		log.Printf("File upload attempt by user: %s", user.UID)

		// リクエストボディのサイズ制限 (例: 20MB)
		// ファイル(15MB) + メタデータ分を考慮
		c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 20<<20)

		// 1. セキュリティ強化: メール未認証のユーザーによる書き込みをバックエンドでも拒否
		if verified, ok := user.Claims["email_verified"].(bool); !ok || !verified {
			return c.JSON(http.StatusForbidden, map[string]string{"message": "Email verification is required to upload."})
		}

		// トークンから表示名を取得し、設定されているか確認する
		uploaderName, ok := user.Claims["name"].(string)
		if !ok || uploaderName == "" {
			return c.JSON(http.StatusForbidden, map[string]string{"message": "You must set a display name before uploading."})
		}

		// フォームからメタデータを取得
		title := c.FormValue("title")
		artist := c.FormValue("artist")
		lyrics := c.FormValue("lyrics")

		if title == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Title is required"})
		}
		// 入力値の長さ制限
		if len(title) > 100 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Title is too long (max 100 chars)"})
		}
		if len(artist) > 100 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Artist name is too long (max 100 chars)"})
		}
		if len(lyrics) > 10000 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Lyrics are too long (max 10000 chars)"})
		}

		file, err := c.FormFile("file")
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Error retrieving the file"})
		}

		// ファイルサイズチェック (例: 15MB)
		if file.Size > 15*1024*1024 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "File is too large (max 15MB)"})
		}

		// 拡張子チェック
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".mp3" {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Only .mp3 files are allowed"})
		}

		src, err := file.Open()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error opening the file"})
		}
		defer src.Close()

		// MIMEタイプチェック (簡易的なマジックナンバーチェック)
		// 先頭の512バイトを読み込んで判定する
		buffer := make([]byte, 512)
		_, err = src.Read(buffer)
		if err != nil && err != io.EOF {
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error checking file type"})
		}
		// ファイルポインタを先頭に戻す
		if _, err := src.Seek(0, 0); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error processing file"})
		}

		contentType := http.DetectContentType(buffer)
		// 明らかに危険なタイプ（HTML, JS, XMLなど）を拒否する
		// MP3は "application/octet-stream" や "audio/mpeg" と判定されることが多い
		if strings.Contains(contentType, "text/") || strings.Contains(contentType, "application/javascript") || strings.Contains(contentType, "application/json") || strings.Contains(contentType, "application/xml") {
			log.Printf("Rejected file type: %s", contentType)
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid file type detected"})
		}

		// 3. ファイル名の安全性確保: ディスク上ではUUIDのみを使用し、元のファイル名に依存しない
		// (元のファイル名に含まれる特殊文字や長さによるファイルシステムエラーを防止)
		uniqueFileName := uuid.New().String() + ".mp3"

		dstPath := filepath.Join("uploads", uniqueFileName)

		dst, err := os.Create(dstPath)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Error creating the destination file")
		}
		defer dst.Close()

		if _, err = io.Copy(dst, src); err != nil {
			return c.JSON(http.StatusInternalServerError, "Error saving the file")
		}

		// データベースにメタデータを保存
		// filenameカラムには uniqueFileName (uuid.mp3) が入るため、フロントエンドからのアクセスURLも安全になる
		insertSQL := `INSERT INTO tracks (filename, title, artist, lyrics, uploader_uid, uploader_name) VALUES (?, ?, ?, ?, ?, ?)`
		_, err = db.Exec(insertSQL, uniqueFileName, title, artist, lyrics, user.UID, uploaderName)
		if err != nil {
			log.Printf("error inserting track metadata: %v\n", err)
			// 4. ゴミファイル対策: DB保存失敗時はファイルを削除する
			os.Remove(dstPath)
			// 5. 情報漏洩対策: 内部エラー詳細(err.Error())をクライアントに返さない
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Internal server error during metadata saving."})
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "File uploaded successfully!"})
	})

	// ProfileUpdateRequest defines the structure for the profile update request
	type ProfileUpdateRequest struct {
		DisplayName string `json:"display_name"`
	}

	// プロフィール更新API (表示名の重複チェックを含む)
	apiGroup.POST("/profile", func(c echo.Context) error {
		user := c.Get("user").(*auth.Token)

		var req ProfileUpdateRequest
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid request body"})
		}

		// メール未認証ならプロフィール更新も禁止
		if verified, ok := user.Claims["email_verified"].(bool); !ok || !verified {
			return c.JSON(http.StatusForbidden, map[string]string{"message": "Email verification is required to update profile."})
		}

		newDisplayName := strings.TrimSpace(req.DisplayName)
		if newDisplayName == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Display name cannot be empty"})
		}
		if len(newDisplayName) > 30 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Display name is too long (max 30 chars)"})
		}

		// 表示名の重複をチェック (自分以外のユーザーが使っていないか)
		var existingUID string
		err := db.QueryRow("SELECT uploader_uid FROM tracks WHERE uploader_name = ? AND uploader_uid != ? LIMIT 1", newDisplayName, user.UID).Scan(&existingUID)
		if err == nil { // errがnilということは、レコードが見つかったということ
			return c.JSON(http.StatusConflict, map[string]string{"message": "Display name '" + newDisplayName + "' is already taken."})
		}
		if err != sql.ErrNoRows {
			log.Printf("error checking display name uniqueness: %v\n", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error checking display name."})
		}

		// Firebase Authの表示名を更新
		authClient, err := app.Auth(context.Background())
		if err != nil {
			log.Printf("error getting Auth client for profile update: %v\n", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Internal server error."})
		}
		params := (&auth.UserToUpdate{}).DisplayName(newDisplayName)
		if _, err := authClient.UpdateUser(context.Background(), user.UID, params); err != nil {
			log.Printf("error updating firebase auth display name for user %s: %v\n", user.UID, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed to update authentication profile."})
		}

		// 既存のトラックのuploader_nameをすべて更新
		// この処理はAuthの更新が成功してから行う
		if _, err := db.Exec("UPDATE tracks SET uploader_name = ? WHERE uploader_uid = ?", newDisplayName, user.UID); err != nil {
			// ここで失敗した場合、Authの更新とDBの更新に不整合が起きるが、
			// 次回のアップロードやプロフィール更新で修正される可能性が高い。
			log.Printf("error updating uploader_name in tracks: %v\n", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error updating track information."})
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "Profile updated successfully!"})
	})

	// いいねしたトラック一覧を取得するAPI
	apiGroup.GET("/tracks/favorites", func(c echo.Context) error {
		user := c.Get("user").(*auth.Token)

		// ユーザーがいいねしたトラックを取得するクエリ
		// JOINを使って、likesテーブルとtracksテーブルを結合する
		query := `
		SELECT 
			t.id, t.filename, t.title, t.artist, t.lyrics, t.uploader_uid, t.uploader_name, t.created_at,
			(SELECT COUNT(*) FROM likes WHERE track_id = t.id) AS likes_count,
			1 AS is_liked
		FROM tracks t
		INNER JOIN likes l ON t.id = l.track_id
		WHERE l.user_uid = ?
		ORDER BY l.created_at DESC
		LIMIT 50` // お気に入り一覧もLIMITで保護

		rows, err := db.Query(query, user.UID)
		if err != nil {
			log.Printf("error querying favorite tracks: %v\n", err)
			return c.JSON(http.StatusInternalServerError, "Error retrieving favorite tracks")
		}
		defer rows.Close()

		tracks := make([]Track, 0)
		for rows.Next() {
			var track Track
			var artist sql.NullString
			var lyrics sql.NullString
			var uploaderName sql.NullString
			if err := rows.Scan(&track.ID, &track.Filename, &track.Title, &artist, &lyrics, &track.UploaderUID, &uploaderName, &track.CreatedAt, &track.LikesCount, &track.IsLiked); err != nil {
				log.Printf("error scanning favorite track row: %v\n", err)
				return c.JSON(http.StatusInternalServerError, "Error processing favorite tracks")
			}
			track.Artist = artist.String
			track.Lyrics = lyrics.String
			track.UploaderName = uploaderName.String
			tracks = append(tracks, track)
		}
		return c.JSON(http.StatusOK, tracks)
	})

	// いいね機能のAPI
	apiGroup.POST("/track/:id/like", func(c echo.Context) error {
		user := c.Get("user").(*auth.Token)
		trackID, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			return c.JSON(http.StatusBadRequest, "Invalid track ID")
		}

		// メール未認証ならいいねも禁止
		if verified, ok := user.Claims["email_verified"].(bool); !ok || !verified {
			return c.JSON(http.StatusForbidden, map[string]string{"message": "Email verification is required to like tracks."})
		}

		// 2. DB整合性強化: トランザクションを開始
		tx, err := db.Begin()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Database transaction error")
		}
		defer tx.Rollback() // エラー時はロールバック

		// トランザクション内でチェック
		var exists bool
		err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM likes WHERE user_uid = ? AND track_id = ?)", user.UID, trackID).Scan(&exists)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Database error")
		}

		if exists {
			_, err = tx.Exec("DELETE FROM likes WHERE user_uid = ? AND track_id = ?", user.UID, trackID)
		} else {
			_, err = tx.Exec("INSERT INTO likes (user_uid, track_id) VALUES (?, ?)", user.UID, trackID)
		}
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Failed to update likes")
		}
		if err := tx.Commit(); err != nil { // コミット実行
			return c.JSON(http.StatusInternalServerError, "Failed to commit transaction")
		}

		// 更新後のカウントと状態を返す
		var newCount int
		db.QueryRow("SELECT COUNT(*) FROM likes WHERE track_id = ?", trackID).Scan(&newCount)
		return c.JSON(http.StatusOK, map[string]interface{}{"likes_count": newCount, "is_liked": !exists})
	})

	// 曲の削除API
	apiGroup.DELETE("/track/:id", func(c echo.Context) error {
		user := c.Get("user").(*auth.Token)
		trackID, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			return c.JSON(http.StatusBadRequest, "Invalid track ID")
		}

		// DBからトラック情報を取得し、アップロードユーザーが一致するか確認
		var track Track
		err = db.QueryRow("SELECT id, filename, uploader_uid FROM tracks WHERE id = ?", trackID).Scan(&track.ID, &track.Filename, &track.UploaderUID)
		if err == sql.ErrNoRows {
			return c.JSON(http.StatusNotFound, "Track not found")
		}
		if err != nil {
			log.Printf("error querying track for deletion: %v\n", err)
			return c.JSON(http.StatusInternalServerError, "Error retrieving track info")
		}

		if track.UploaderUID != user.UID {
			return c.JSON(http.StatusForbidden, "You are not authorized to delete this track")
		}

		// 3. DB整合性強化: 削除処理もトランザクション化
		tx, err := db.Begin()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Database transaction error")
		}
		defer tx.Rollback()

		// 先にDBから関連データを削除
		if _, err := tx.Exec("DELETE FROM likes WHERE track_id = ?", trackID); err != nil {
			return c.JSON(http.StatusInternalServerError, "Error deleting likes")
		}
		if _, err := tx.Exec("DELETE FROM tracks WHERE id = ?", trackID); err != nil {
			return c.JSON(http.StatusInternalServerError, "Error deleting track metadata")
		}

		// DBコミット
		if err := tx.Commit(); err != nil {
			return c.JSON(http.StatusInternalServerError, "Failed to commit deletion")
		}

		// DB削除が確定した後にファイルを削除 (不整合防止)
		filePath := filepath.Join("uploads", track.Filename)
		if err := os.Remove(filePath); err != nil {
			// ファイル削除に失敗してもDBからは消えているため、システムとしての整合性は保たれる
			// (ゴミファイルは残るが、ユーザーには影響しない)
			log.Printf("warning: failed to delete file %s after db deletion: %v\n", filePath, err)
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "Track deleted successfully!"})
	})

	// アカウント削除API
	apiGroup.DELETE("/account", func(c echo.Context) error {
		user := c.Get("user").(*auth.Token)
		uid := user.UID

		// トランザクション開始
		tx, err := db.Begin()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Database transaction error")
		}
		defer tx.Rollback()

		// 1. ユーザーがアップロードしたトラックのファイル名を取得 (ファイル削除用)
		rows, err := tx.Query("SELECT filename FROM tracks WHERE uploader_uid = ?", uid)
		if err != nil {
			log.Printf("error querying user tracks for deletion: %v\n", err)
			return c.JSON(http.StatusInternalServerError, "Error querying user tracks")
		}
		var filenames []string
		for rows.Next() {
			var fname string
			if err := rows.Scan(&fname); err == nil {
				filenames = append(filenames, fname)
			}
		}
		rows.Close()

		// 2. ユーザーが行った「いいね」を削除
		if _, err := tx.Exec("DELETE FROM likes WHERE user_uid = ?", uid); err != nil {
			return c.JSON(http.StatusInternalServerError, "Error deleting user likes")
		}

		// 3. ユーザーのトラックについた「いいね」を削除
		if _, err := tx.Exec("DELETE FROM likes WHERE track_id IN (SELECT id FROM tracks WHERE uploader_uid = ?)", uid); err != nil {
			return c.JSON(http.StatusInternalServerError, "Error deleting likes on user tracks")
		}

		// 4. トラック情報を削除
		if _, err := tx.Exec("DELETE FROM tracks WHERE uploader_uid = ?", uid); err != nil {
			return c.JSON(http.StatusInternalServerError, "Error deleting user tracks")
		}

		// コミット
		if err := tx.Commit(); err != nil {
			return c.JSON(http.StatusInternalServerError, "Failed to commit account deletion")
		}

		// 5. 物理ファイルを削除 (DB削除成功後)
		for _, fname := range filenames {
			filePath := filepath.Join("uploads", fname)
			if err := os.Remove(filePath); err != nil {
				log.Printf("warning: failed to delete file %s: %v", filePath, err)
			}
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "Account data deleted successfully."})
	})

	e.Logger.Fatal(e.Start(":8080"))
}
