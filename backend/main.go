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
		if err := os.MkdirAll(dataDir, 0o755); err != nil {
			log.Fatalf("error creating data directory: %v\n", err)
		}
	}
	db, err = sql.Open("sqlite3", filepath.Join(dataDir, "soundlike.db"))
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

		// いいね数と、現在のユーザーがいいねしているかを取得するクエリ
		query := `
		SELECT 
			t.id, t.filename, t.title, t.artist, t.lyrics, t.uploader_uid, t.uploader_name, t.created_at,
			(SELECT COUNT(*) FROM likes WHERE track_id = t.id) AS likes_count,
			EXISTS(SELECT 1 FROM likes WHERE track_id = t.id AND user_uid = ?) AS is_liked
		FROM tracks t 
		ORDER BY t.created_at DESC`
		rows, err := db.Query(query, currentUserID)
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

		// フォームからメタデータを取得
		title := c.FormValue("title")
		artist := c.FormValue("artist")
		lyrics := c.FormValue("lyrics")
		uploaderName := c.FormValue("uploader_name") // フロントエンドから送信された名前を取得

		if title == "" {
			return c.JSON(http.StatusBadRequest, "Title is required")
		}

		file, err := c.FormFile("file")
		if err != nil {
			return c.JSON(http.StatusBadRequest, "Error retrieving the file")
		}

		src, err := file.Open()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Error opening the file")
		}
		defer src.Close()

		// ファイル名をUUIDでユニーク化
		originalFileName := filepath.Base(file.Filename)
		uniqueFileName := uuid.New().String() + "_" + originalFileName

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
		insertSQL := `INSERT INTO tracks (filename, title, artist, lyrics, uploader_uid, uploader_name) VALUES (?, ?, ?, ?, ?, ?)`
		_, err = db.Exec(insertSQL, uniqueFileName, title, artist, lyrics, user.UID, uploaderName)
		if err != nil {
			log.Printf("error inserting track metadata: %v\n", err)
			// ファイルは保存されたがDB登録失敗した場合は、保存したファイルも削除するべきだが、今回は簡易化
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error saving track metadata: " + err.Error()})
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "File " + originalFileName + " and metadata uploaded successfully with ID " + uniqueFileName + "!"})
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
		ORDER BY l.created_at DESC`

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

		// 既にいいねしているかチェック
		var exists bool
		err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM likes WHERE user_uid = ? AND track_id = ?)", user.UID, trackID).Scan(&exists)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, "Database error")
		}

		if exists {
			_, err = db.Exec("DELETE FROM likes WHERE user_uid = ? AND track_id = ?", user.UID, trackID)
		} else {
			_, err = db.Exec("INSERT INTO likes (user_uid, track_id) VALUES (?, ?)", user.UID, trackID)
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

		// ファイルを削除
		filePath := filepath.Join("uploads", track.Filename)
		if err := os.Remove(filePath); err != nil {
			log.Printf("error deleting file %s: %v\n", filePath, err)
			return c.JSON(http.StatusInternalServerError, "Error deleting track file")
		}

		// 関連するいいねを削除
		if _, err := db.Exec("DELETE FROM likes WHERE track_id = ?", trackID); err != nil {
			log.Printf("error deleting likes for track %d: %v\n", trackID, err)
			// 致命的なエラーではないので続行
		}

		// DBからレコードを削除
		_, err = db.Exec("DELETE FROM tracks WHERE id = ?", trackID)
		if err != nil {
			log.Printf("error deleting track from DB: %v\n", err)
			return c.JSON(http.StatusInternalServerError, "Error deleting track metadata")
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "Track deleted successfully!"})
	})

	e.Logger.Fatal(e.Start(":8080"))
}
