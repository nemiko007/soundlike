// src/components/Login.tsx
import { useState, useEffect, useRef } from "react";
import { auth } from "../firebase/client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  type User as FirebaseAuthUser,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";

export default function Login() {
  const [user, setUser] = useState<FirebaseAuthUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState<string>("");
  const [artist, setArtist] = useState<string>("");
  const [lyrics, setLyrics] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const lastUidRef = useRef<string | null>(null);

  // ユーザーの認証状態を監視し、userステートを更新する
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  // メール確認状態を自動検知するためのポーリング処理
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (user && !user.emailVerified) {
      interval = setInterval(async () => {
        try {
          // Firebase上のユーザー情報を再読み込み
          await user.reload();
          if (user.emailVerified) {
            setMessage("Email verified! You can now upload files. 📧");
            setUser(auth.currentUser); // 最新の状態（verified: true）をUIに反映
            clearInterval(interval);   // 確認できたら監視を終了
          }
        } catch (e) {
          console.error("Verification check failed", e);
        }
      }, 3000); // 3秒ごとにチェック
    }
    return () => clearInterval(interval);
  }, [user]);

  // userステート（ログイン状態）の変化に応じてフォームの初期化やリセットを行う
  useEffect(() => {
    if (user) {
      // ユーザーが切り替わった場合（ログイン直後など）のみフォームを初期化
      // Firebaseのトークン更新などでuserオブジェクトが変わっても、UIDが同じなら入力中のフォームをリセットしない
      if (user.uid !== lastUidRef.current) {
        setDisplayName(user.displayName || "");
        lastUidRef.current = user.uid;

        // ログイン時にメッセージやアップロードフォームをリセット
        setError(null);
        setMessage("");
        setFile(null);
        setTitle("");
        setArtist("");
        setLyrics("");
      }
    } else {
      // ログアウト時
      if (lastUidRef.current !== null) {
        setDisplayName("");
        setEmail("");
        setPassword("");
        lastUidRef.current = null;

        // ログアウト時にフォームをリセット
        setError(null);
        setMessage("");
        setFile(null);
        setTitle("");
        setArtist("");
        setLyrics("");
      }
    }
  }, [user]);

  const handleAuthAction = async () => {
    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }
    
    if (!isLoginMode) {
      // パスワードの強度チェック (8文字以上、かつ英字と数字を含む) - 新規登録時のみ
      const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
      if (!passwordRegex.test(password)) {
        setError("Password must be at least 8 characters long and contain both letters and numbers.");
        return;
      }
    }

    setError(null);
    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
        setMessage("Account created! Verification email sent. Please check your inbox. 📧");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user) {
      setError("You must be logged in to update your profile.");
      return;
    }
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      setError("Display name cannot be empty.");
      return;
    }
    setError(null);
    setMessage("");

    try {
      // true を渡してIDトークンを強制的にリフレッシュし、最新の email_verified 状態を反映させる
      const idToken = await user.getIdToken(true);
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ display_name: trimmedDisplayName }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to update profile.");
      }

      await user.reload(); // サーバー側で更新された最新のユーザー情報を取得
      setMessage(data.message);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSendVerificationEmail = async () => {
    if (!user) return;
    setMessage("");
    setError(null);
    try {
      await sendEmailVerification(user);
      setMessage("Verification email sent! Please check your inbox. 📧");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setError("Please enter your email address to reset your password.");
      return;
    }
    setError(null);
    setMessage("");
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("Password reset email sent! Please check your inbox. 📧");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const confirmDelete = window.confirm(
      "Are you sure you want to delete your account? This action cannot be undone.\n\nAll your uploaded tracks and data will be permanently deleted."
    );
    if (!confirmDelete) return;

    setMessage("");
    setError(null);

    try {
      // 1. バックエンドのデータを削除
      const idToken = await user.getIdToken();
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${idToken}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete account data.");
      }

      // 2. Firebase Authのアカウントを削除
      await deleteUser(user);
      setMessage("Account deleted successfully. Bye! 👋");
    } catch (e: any) {
      if (e.code === 'auth/requires-recent-login') {
        // 再認証が必要な場合、パスワードの入力を求めて再試行する
        const password = window.prompt("Security Check: Please enter your password to confirm deletion.");
        if (password && user.email) {
          try {
            const credential = EmailAuthProvider.credential(user.email, password);
            await reauthenticateWithCredential(user, credential);
            await deleteUser(user);
            setMessage("Account deleted successfully. Bye! 👋");
            return;
          } catch (reauthError: any) {
            setError(`Re-authentication failed: ${reauthError.message}`);
            return;
          }
        }
      }
      setError(`Error: ${e.message}`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!user) {
      setMessage("You must be logged in to upload.");
      return;
    }
    if (!user.emailVerified) {
      setMessage("You must verify your email address to upload.");
      return;
    }
    if (!user.displayName) {
      setMessage("Please set a display name in Profile Settings before uploading.");
      return;
    }
    if (!file) {
      setMessage("Please select a file to upload.");
      return;
    }
    if (!title.trim()) {
      setMessage("Title is required.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("artist", artist);
    formData.append("lyrics", lyrics);

    try {
      // trueを指定してトークンを強制リフレッシュし、最新の email_verified 情報を取得する
      const idToken = await user.getIdToken(true);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Something went wrong");
      }
      
      setMessage(data.message);
      setFile(null);
      setTitle("");
      setArtist("");
      setLyrics("");
      const fileInput = document.getElementById('mp3-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  };

  return (
    <div className="max-w-md mx-auto p-8 bg-gyaru-black rounded-xl shadow-lg text-white"> {/* mt-10 を削除 */}
      {user ? (
        <div className="space-y-4"> {/* Spacing for logged-in view */}
          <h2 className="text-3xl font-extrabold text-center text-gyaru-pink">Welcome, {user.displayName || user.email}! ✨</h2> {/* Larger heading */}
          <p className="text-center text-lg"><a href="/tracks/" className="!text-gyaru-pink !font-bold hover:!text-gyaru-pink/80 hover:!underline">View all tracks</a></p> {/* リンク修正 with !important */}

          {user.emailVerified ? (
            <>
              <div className="border-t border-gray-700 py-4 space-y-3">
                <h3 className="text-xl font-semibold text-gyaru-pink">Profile Settings 💖</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Display Name</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="p-2 bg-gray-800 text-white border border-gray-600 rounded-md w-full focus:ring-gyaru-pink focus:border-gyaru-pink" placeholder="Your Name" />
                </div>
                <button onClick={handleUpdateProfile} className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 rounded-md text-white font-bold transition-colors">Update Profile</button>
              </div>

              <div className="border-t border-b border-gray-700 py-6 my-4 space-y-4"> {/* Adjusted padding */}
                <h3 className="text-2xl font-semibold mb-3">Upload a new MP3</h3> {/* Larger heading */}
                <div>
                    <label htmlFor="mp3-title" className="block text-base font-medium text-gray-300 mb-1">Title (required)</label> {/* Larger label */}
                    <input type="text" id="mp3-title" value={title} onChange={(e) => setTitle(e.target.value)} className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full" /> {/* Increased padding */}
                </div>
                <div>
                    <label htmlFor="mp3-artist" className="block text-base font-medium text-gray-300 mb-1">Artist</label>
                    <input type="text" id="mp3-artist" value={artist} onChange={(e) => setArtist(e.target.value)} className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full" />
                </div>
                <div>
                    <label htmlFor="mp3-lyrics" className="block text-base font-medium text-gray-300 mb-1">Lyrics</label>
                    <textarea id="mp3-lyrics" value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full"></textarea>
                </div>
                <input type="file" id="mp3-file-input" onChange={handleFileChange} accept=".mp3" className="block w-full text-base text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-base file:font-semibold file:bg-gyaru-pink file:text-white hover:file:bg-gyaru-pink/80"/>
                <button onClick={handleUpload} className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-bold text-white bg-gyaru-pink hover:bg-gyaru-pink/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gyaru-pink mt-4">
                  Upload
                </button>
                {message && <p className="mt-4 p-3 bg-gyaru-pink/20 text-gyaru-pink rounded-md text-sm">{message}</p>}
              </div>
            </>
          ) : (
            <div className="bg-yellow-900/30 border border-yellow-600/50 p-4 rounded-md text-center my-4 space-y-2">
              <p className="text-yellow-200">Please verify your email to upload files. ⚠️</p>
              <button onClick={handleSendVerificationEmail} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-md font-bold text-sm transition-colors">
                Resend Verification Email
              </button>
              {message && <p className="mt-2 p-3 bg-gyaru-pink/20 text-gyaru-pink rounded-md text-sm">{message}</p>}
            </div>
          )}

          <button onClick={handleLogout} className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-bold text-white bg-gyaru-pink hover:bg-gyaru-pink/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gyaru-pink mt-4">
            Logout
          </button>
          <div className="mt-8 border-t border-gray-700 pt-4 text-center">
            <button onClick={handleDeleteAccount} className="text-sm text-red-500 hover:text-red-400 hover:underline">
              Delete Account
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4"> {/* Spacing for login view */}
          <h2 className="text-3xl font-extrabold text-center text-gyaru-pink">{isLoginMode ? "Login" : "Sign Up"}</h2> {/* Larger heading */}
          <div>
            <label htmlFor="email" className="block text-base font-medium text-gray-300 mb-1">Email</label>
            <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full" />
          </div>
          <div className="mb-6">
            <label htmlFor="password" className="block text-base font-medium text-gray-300 mb-1">Password</label>
            <input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full" />
            {isLoginMode && (
              <div className="text-right mt-2">
                <button onClick={handlePasswordReset} className="text-sm text-gyaru-pink hover:text-gyaru-pink/80 hover:underline focus:outline-none">
                  Forgot Password?
                </button>
              </div>
            )}
          </div>
          {message && <p className="p-3 bg-gyaru-pink/20 text-gyaru-pink rounded-md text-sm mb-4">{message}</p>}
          {error && <p className="text-gyaru-pink text-sm mb-4">{error}</p>}
          <button onClick={handleAuthAction} className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-bold text-white bg-gyaru-pink hover:bg-gyaru-pink/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gyaru-pink mt-4">
            {isLoginMode ? "Login" : "Sign Up"}
          </button>
          <div className="text-center mt-4">
            <button onClick={() => { setIsLoginMode(!isLoginMode); setError(null); setMessage(""); }} className="text-sm text-gray-300 hover:text-white">
              {isLoginMode ? "Don't have an account? Sign Up" : "Already have an account? Login"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
