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
	ID          int       `json:"id"`
	Filename    string    `json:"filename"`
	Title       string    `json:"title"`
	Artist      string    `json:"artist"`
	Lyrics      string    `json:"lyrics"`
	UploaderUID string    `json:"uploader_uid"`
	CreatedAt   time.Time `json:"created_at"`
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
	db, err = sql.Open("sqlite3", "./soundlike.db")
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatalf("error creating tracks table: %v\n", err)
	}
	log.Println("Database and 'tracks' table initialized successfully.")

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
		rows, err := db.Query("SELECT id, filename, title, artist, lyrics, uploader_uid, created_at FROM tracks ORDER BY created_at DESC")
		if err != nil {
			log.Printf("error querying tracks: %v\n", err)
			return c.JSON(http.StatusInternalServerError, "Error retrieving tracks")
		}
		defer rows.Close()

		var tracks []Track
		for rows.Next() {
			var track Track
			// lyricsとartistはNULL許容のため、sql.NullStringで受け取る
			var artist sql.NullString
			var lyrics sql.NullString
			if err := rows.Scan(&track.ID, &track.Filename, &track.Title, &artist, &lyrics, &track.UploaderUID, &track.CreatedAt); err != nil {
				log.Printf("error scanning track row: %v\n", err)
				return c.JSON(http.StatusInternalServerError, "Error processing tracks")
			}
			track.Artist = artist.String
			track.Lyrics = lyrics.String
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
		insertSQL := `INSERT INTO tracks (filename, title, artist, lyrics, uploader_uid) VALUES (?, ?, ?, ?, ?)`
		_, err = db.Exec(insertSQL, uniqueFileName, title, artist, lyrics, user.UID)
		if err != nil {
			log.Printf("error inserting track metadata: %v\n", err)
			// ファイルは保存されたがDB登録失敗した場合は、保存したファイルも削除するべきだが、今回は簡易化
			return c.JSON(http.StatusInternalServerError, "Error saving track metadata")
		}

		return c.JSON(http.StatusOK, map[string]string{"message": "File " + originalFileName + " and metadata uploaded successfully with ID " + uniqueFileName + "!"})
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
