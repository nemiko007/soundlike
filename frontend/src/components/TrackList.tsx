// src/components/TrackList.tsx
import { useState, useEffect } from 'react';
import { auth } from '../firebase/client'; // Firebase Authクライアント
import { onAuthStateChanged, type User as FirebaseAuthUser } from 'firebase/auth'; // FirebaseAuthUserをインポート

interface Track {
  id: number;
  filename: string;
  title: string;
  artist: string | null;
  lyrics: string | null;
  uploader_uid: string;
  uploader_name?: string;
  created_at: string;
}

function getTrackUrl(filename: string) {
  return `/uploads/${filename}`;
}

export default function TrackList() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseAuthUser | null>(null); // ログイン中のユーザー情報

  // ユーザーの認証状態を監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // トラックリストのフェッチ
  useEffect(() => {
    const fetchTracks = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/tracks`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: Track[] = await response.json();
        setTracks(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTracks();
  }, []); // 初回マウント時のみ実行

  const handleDelete = async (trackId: number, uploaderUid: string) => {
    if (!user || user.uid !== uploaderUid) {
      alert("You are not authorized to delete this track.");
      return;
    }

    if (!confirm("Are you sure you want to delete this track?")) {
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/track/${trackId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      alert(result.message);
      // 成功したらリストから削除
      setTracks(tracks.filter(track => track.id !== trackId));
    } catch (err: any) {
      setError(err.message);
      alert(`Error deleting track: ${err.message}`);
    }
  };


  if (loading) return <p className="text-gyaru-pink text-center text-lg mt-8">Loading tracks...</p>;
  if (error) return <p className="text-red-500 text-center text-lg mt-8">Error: {error}</p>;

  return (
    <div className="mt-8"> {/* Main container for the track list */}
      {tracks.length === 0 ? (
        <p className="text-gray-400 text-center text-lg mt-8">No tracks uploaded yet. Be the first to upload one!</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"> {/* Responsive grid */}
          {tracks.map((track) => (
            <div key={track.id} className="bg-gyaru-black p-6 rounded-xl shadow-lg border border-gyaru-pink/30 flex flex-col justify-between"> {/* Card styling */}
              <div>
                <h2 className="text-3xl font-extrabold mb-2 text-gyaru-pink">{track.title}</h2> {/* Larger title */}
                {track.artist && <p className="text-gray-300 text-lg mb-1"><span className="font-semibold">Artist:</span> {track.artist}</p>} {/* Larger artist */}
                <p className="text-gray-400 text-sm mb-2">Track by: {track.uploader_name || "Anonymous"}</p>
                {track.lyrics && (
                  <div className="bg-gyaru-black/20 border border-gray-600 p-3 mt-4 rounded-md whitespace-pre-wrap text-base text-gray-200 overflow-y-auto max-h-32"> {/* Adjusted padding and font size */}
                    <h4 className="font-medium mb-2 text-xl text-gyaru-pink">Lyrics:</h4> {/* Larger lyrics heading */}
                    <p>{track.lyrics}</p>
                  </div>
                )}
              </div>
              <div className="mt-6"> {/* Adjusted margin-top */}
                <audio controls src={getTrackUrl(track.filename)} className="w-full">
                  Your browser does not support the audio element.
                </audio>
                {user && user.uid === track.uploader_uid && (
                  <button 
                    onClick={() => handleDelete(track.id, track.uploader_uid)} 
                    className="mt-4 px-4 py-2 bg-gyaru-pink text-white rounded-md shadow-sm hover:bg-gyaru-pink/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gyaru-pink text-sm w-full"
                  >
                    Delete Track
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
