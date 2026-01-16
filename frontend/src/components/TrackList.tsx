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

interface Comment {
  id: number;
  track_id: number;
  user_uid: string;
  user_name: string;
  content: string;
  created_at: string;
}

interface ViewState {
  mode: 'all' | 'favorites' | 'user';
  uid?: string;
  name?: string;
}

function getTrackUrl(filename: string) {
  return `/uploads/${filename}`;
}

export default function TrackList() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseAuthUser | null>(null); // ログイン中のユーザー情報
  const [view, setView] = useState<ViewState>({ mode: 'all' });
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [activeCommentTrackId, setActiveCommentTrackId] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState<string>("");
  const [loadingComments, setLoadingComments] = useState<boolean>(false);

  // ユーザーの認証状態を監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // ログアウトしたら 'all' モードに戻す
      if (!currentUser) {
        setView({ mode: 'all' });
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

        if (view.mode === 'favorites') {
          if (!user) {
            // お気に入り表示にはログインが必要
            setTracks([]); // トラックを空にする
            setLoading(false);
            return;
          }
          url = '/api/tracks/favorites';
        } else if (view.mode === 'user' && view.uid) {
          url = `/api/tracks?uploader_uid=${view.uid}`;
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
  }, [view, user]); // view or user が変わったら再フェッチ

  // フォロー状態の確認 (ユーザー表示モード時)
  useEffect(() => {
    const checkFollow = async () => {
      if (view.mode === 'user' && view.uid && user && user.uid !== view.uid) {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch(`/api/user/${view.uid}/follow/status`, {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            setIsFollowing(data.is_following);
          }
        } catch (e) {
          console.error("Error checking follow status", e);
        }
      } else {
        setIsFollowing(false);
      }
    };
    checkFollow();
  }, [view, user]);

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
      
      if (view.mode === 'favorites' && !data.is_liked) {
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

  const handleUserClick = (uid: string, name?: string) => {
    // 既にそのユーザーで絞り込んでいる場合は何もしない
    if (view.mode === 'user' && view.uid === uid) return;
    setView({ mode: 'user', uid, name: name || 'Anonymous' });
  };

  const handleFollowToggle = async () => {
    if (!user || !view.uid) {
      alert("Please login to follow users.");
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/user/${view.uid}/follow`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.is_following);
        alert(data.message);
      } else {
        const err = await res.json();
        alert(err.message || "Failed to update follow status");
      }
    } catch (e) {
      console.error(e);
      alert("Error updating follow status");
    }
  };

  const fetchComments = async (trackId: number) => {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/track/${trackId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingComments(false);
    }
  };

  const toggleComments = (trackId: number) => {
    if (activeCommentTrackId === trackId) {
      setActiveCommentTrackId(null);
      setComments([]);
    } else {
      setActiveCommentTrackId(trackId);
      fetchComments(trackId);
    }
  };

  const handlePostComment = async (trackId: number) => {
    if (!user) {
      alert("Please login to comment.");
      return;
    }
    if (!commentInput.trim()) return;

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/track/${trackId}/comment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: commentInput })
      });
      
      if (res.ok) {
        setCommentInput("");
        fetchComments(trackId);
      } else {
        const data = await res.json();
        alert(data.message || "Failed to post comment");
      }
    } catch (e) {
      console.error(e);
      alert("Error posting comment");
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("Delete this comment?")) return;
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/comment/${commentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` }
      });
      if (res.ok) {
        if (activeCommentTrackId) fetchComments(activeCommentTrackId);
      } else {
        alert("Failed to delete comment");
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return <p className="text-gyaru-pink text-center text-lg mt-8">Loading tracks...</p>;
  if (error) return <p className="text-red-500 text-center text-lg mt-8">Error: {error}</p>;

  return (
    <div className="mt-8">
      {/* タブ切り替えUI */}
      <div className="mb-6">
        <div className="flex justify-center border-b border-gray-700">
          <button
            onClick={() => setView({ mode: 'all' })}
            className={`px-6 py-3 text-lg font-bold transition-colors ${
              view.mode === 'all'
                ? 'text-gyaru-pink border-b-2 border-gyaru-pink'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            All Tracks
          </button>
          {user && (
            <button
              onClick={() => setView({ mode: 'favorites' })}
              className={`px-6 py-3 text-lg font-bold transition-colors ${
                view.mode === 'favorites'
                  ? 'text-gyaru-pink border-b-2 border-gyaru-pink'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              My Favorites 💖
            </button>
          )}
        </div>
        {view.mode === 'user' && (
          <div className="text-center mt-4 p-2 bg-gyaru-pink/10 rounded-lg">
            <h3 className="text-md text-gray-300 mb-2">
              Showing tracks by: <span className="font-bold text-gyaru-pink">{view.name}</span>
            </h3>
            {user && user.uid !== view.uid && (
              <button
                onClick={handleFollowToggle}
                className={`px-4 py-1 rounded-full text-sm font-bold transition-colors mb-2 ${
                  isFollowing ? 'bg-gray-600 text-white hover:bg-gray-500' : 'bg-gyaru-pink text-white hover:bg-gyaru-pink/80'
                }`}
              >
                {isFollowing ? 'Unfollow' : 'Follow'}
              </button>
            )}
            <br />
            <button onClick={() => setView({ mode: 'all' })} className="text-sm text-gyaru-pink hover:underline">
              (Show All Tracks)
            </button>
          </div>
        )}
      </div>
      {tracks.length === 0 && !loading ? (
        <p className="text-gray-400 text-center text-lg mt-8">
          {view.mode === 'favorites' 
            ? 'You have no favorite tracks yet. 💖' 
            : view.mode === 'user'
            ? `No tracks found for ${view.name}.`
            : 'No tracks uploaded yet. Be the first to upload one!'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"> {/* Responsive grid */}
          {tracks.map((track) => (
            <div key={track.id} className="bg-gyaru-black p-6 rounded-xl shadow-lg border border-gyaru-pink/30 flex flex-col justify-between"> {/* Card styling */}
              <div>
                <h2 className="text-3xl font-extrabold mb-2 text-gyaru-pink">{track.title}</h2> {/* Larger title */}
                {track.artist && <p className="text-gray-300 text-lg mb-1"><span className="font-semibold">Artist:</span> {track.artist}</p>} {/* Larger artist */}
                <p className="text-gray-400 text-sm mb-2">
                  Track by:
                  <button
                    onClick={() => handleUserClick(track.uploader_uid, track.uploader_name)}
                    className="ml-1 font-semibold text-gyaru-pink/80 hover:text-gyaru-pink hover:underline focus:outline-none disabled:text-gray-500 disabled:no-underline"
                    disabled={view.mode === 'user' && view.uid === track.uploader_uid}
                  >
                    {track.uploader_name || "Anonymous"}
                  </button>
                </p>
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
                
                <div className="mt-3 flex items-center space-x-4">
                  <button onClick={() => handleLike(track.id)} className={`flex items-center space-x-2 px-3 py-2 rounded-full transition-colors ${track.is_liked ? 'bg-gyaru-pink/20 text-gyaru-pink' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                    <span className="text-xl">{track.is_liked ? '💖' : '🤍'}</span>
                    <span className="font-bold">{track.likes_count || 0}</span>
                  </button>
                  <button onClick={() => toggleComments(track.id)} className="flex items-center space-x-2 px-3 py-2 rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
                    <span className="text-xl">💬</span>
                    <span className="font-bold text-sm">Comments</span>
                  </button>
                </div>

                {/* Comments Section */}
                {activeCommentTrackId === track.id && (
                  <div className="mt-4 bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                    <h4 className="text-gyaru-pink font-bold mb-3">Comments</h4>
                    {loadingComments ? (
                      <p className="text-gray-500 text-sm">Loading...</p>
                    ) : comments.length === 0 ? (
                      <p className="text-gray-500 text-sm mb-3">No comments yet.</p>
                    ) : (
                      <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                        {comments.map((comment) => (
                          <div key={comment.id} className="bg-gray-800 p-2 rounded text-sm">
                            <div className="flex justify-between items-start">
                              <span className="font-bold text-gyaru-pink/80">{comment.user_name}</span>
                              <span className="text-xs text-gray-500">{new Date(comment.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-gray-300 mt-1">{comment.content}</p>
                            {user && user.uid === comment.user_uid && (
                              <button onClick={() => handleDeleteComment(comment.id)} className="text-xs text-red-400 hover:underline mt-1">Delete</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {user && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={commentInput}
                          onChange={(e) => setCommentInput(e.target.value)}
                          placeholder="Write a comment..."
                          className="flex-1 p-2 bg-gray-800 border border-gray-600 rounded text-sm text-white focus:border-gyaru-pink focus:outline-none"
                        />
                        <button onClick={() => handlePostComment(track.id)} className="px-3 py-1 bg-gyaru-pink text-white rounded text-sm font-bold hover:bg-gyaru-pink/80">Post</button>
                      </div>
                    )}
                  </div>
                )}

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
