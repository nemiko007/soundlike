// src/components/Login.tsx
import { useState, useEffect } from "react";
import { auth } from "../firebase/client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User as FirebaseAuthUser,
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setError(null);
      setMessage("");
      setFile(null);
      setTitle("");
      setArtist("");
      setLyrics("");
    });
    return () => unsubscribe();
  }, []);

  const handleLoginOrSignUp = async () => {
    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (signInError: any) {
      if (signInError.code === 'auth/user-not-found' || signInError.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
        } catch (signUpError: any) {
          setError(signUpError.message);
        }
      }
      else {
        setError(signInError.message);
      }
    }
  };

  const handleViewTracks = () => {
    window.location.href = `${window.location.origin}/tracks`;
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e: any) {
      setError(e.message);
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
      const idToken = await user.getIdToken();
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
          <h2 className="text-3xl font-extrabold text-center text-gyaru-pink">Welcome, {user.email}! ✨</h2> {/* Larger heading */}
          <p className="text-center text-lg"><button onClick={handleViewTracks} className="!text-gyaru-pink !font-bold hover:!text-gyaru-pink/80 hover:!underline">View all tracks</button></p> {/* リンク修正 with !important */}
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
          <button onClick={handleLogout} className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-bold text-white bg-gyaru-pink hover:bg-gyaru-pink/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gyaru-pink mt-4">
            Logout
          </button>
        </div>
      ) : (
        <div className="space-y-4"> {/* Spacing for login view */}
          <h2 className="text-3xl font-extrabold text-center text-gyaru-pink">Login or Sign Up</h2> {/* Larger heading */}
          <div>
            <label htmlFor="email" className="block text-base font-medium text-gray-300 mb-1">Email</label>
            <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full" />
          </div>
          <div className="mb-6">
            <label htmlFor="password" className="block text-base font-medium text-gray-300 mb-1">Password</label>
            <input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" className="p-3 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-gyaru-pink focus:border-gyaru-pink w-full" />
          </div>
          {error && <p className="text-gyaru-pink text-sm mb-4">{error}</p>}
          <button onClick={handleLoginOrSignUp} className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-bold text-white bg-gyaru-pink hover:bg-gyaru-pink/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gyaru-pink mt-4">
            Login / Sign Up
          </button>
        </div>
      )}
    </div>
  );
}
