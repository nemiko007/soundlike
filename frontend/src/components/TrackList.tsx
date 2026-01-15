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
  likes_count?: number;
  is_liked?: boolean;
}

function getTrackUrl(filename: string) {
  return `/uploads/${filename}`;
}

export default function TrackList() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseAuthUser | null>(null); // ログイン中のユーザー情報
  const [viewMode, setViewMode] = useState<'all' | 'favorites'>('all'); // 'all' or 'favorites'

  // ユーザーの認証状態を監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // ログアウトしたら 'all' モードに戻す
      if (!currentUser) {
        setViewMode('all');
      }
    });
    return () => unsubscribe();
  }, []);

  // トラックリストのフェッチ
  useEffect(() => {
    const fetchTracks = async () => {
      try {
        setLoading(true);
        setError(null); // Reset error on new fetch

        let url = '/api/tracks';
        const headers: HeadersInit = {};

        // ログイン状態であれば、どのリクエストにもトークンを付与する
        // (全件取得時にも is_liked を正しく判定するため)
        if (user) {
          const idToken = await user.getIdToken();
          headers['Authorization'] = `Bearer ${idToken}`;
        }

        if (viewMode === 'favorites') {
          if (!user) {
            // お気に入り表示にはログインが必要
            setTracks([]); // トラックを空にする
            setLoading(false);
            return;
          }
          url = '/api/tracks/favorites';
        }

        const response = await fetch(url, { headers });
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
  }, [viewMode, user]); // viewMode or user が変わったら再フェッチ

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

  const handleLike = async (trackId: number) => {
    if (!user) {
      alert("Please login to like tracks! 💖");
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/track/${trackId}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      if (!response.ok) throw new Error("Failed to like track");

      const data = await response.json();
      
      if (viewMode === 'favorites' && !data.is_liked) {
        // お気に入りビューで「いいね」を解除した場合、リストから削除する
        setTracks(tracks.filter(track => track.id !== trackId));
      } else {
        setTracks(tracks.map(track => 
          track.id === trackId 
            ? { ...track, likes_count: data.likes_count, is_liked: data.is_liked }
            : track
        ));
      }
    } catch (err: any) {
      console.error("Error liking track:", err);
    }
  };

  if (loading) return <p className="text-gyaru-pink text-center text-lg mt-8">Loading tracks...</p>;
  if (error) return <p className="text-red-500 text-center text-lg mt-8">Error: {error}</p>;

  return (
    <div className="mt-8">
      {/* タブ切り替えUI */}
      <div className="flex justify-center mb-6 border-b border-gray-700">
        <button
          onClick={() => setViewMode('all')}
          className={`px-6 py-3 text-lg font-bold transition-colors ${
            viewMode === 'all'
              ? 'text-gyaru-pink border-b-2 border-gyaru-pink'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          All Tracks
        </button>
        {user && (
          <button
            onClick={() => setViewMode('favorites')}
            className={`px-6 py-3 text-lg font-bold transition-colors ${
              viewMode === 'favorites'
                ? 'text-gyaru-pink border-b-2 border-gyaru-pink'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            My Favorites 💖
          </button>
        )}
      </div>
      {tracks.length === 0 && !loading ? (
        <p className="text-gray-400 text-center text-lg mt-8">{viewMode === 'favorites' ? 'You have no favorite tracks yet. 💖' : 'No tracks uploaded yet. Be the first to upload one!'}</p>
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
                
                <div className="mt-3 flex items-center">
                  <button onClick={() => handleLike(track.id)} className={`flex items-center space-x-2 px-3 py-2 rounded-full transition-colors ${track.is_liked ? 'bg-gyaru-pink/20 text-gyaru-pink' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                    <span className="text-xl">{track.is_liked ? '💖' : '🤍'}</span>
                    <span className="font-bold">{track.likes_count || 0}</span>
                  </button>
                </div>

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
