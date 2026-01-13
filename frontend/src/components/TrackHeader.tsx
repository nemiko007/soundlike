// src/components/TrackHeader.tsx
import React from 'react';

export default function TrackHeader() {
  return (
    <div className="text-center mb-8">
      <h1 className="!text-4xl !font-extrabold !mb-4 !text-gyaru-pink">🎧 All Tracks 🎶</h1> {/* h1クラスに!important追加 */}
      <p><a href="/" className="!text-gyaru-pink !font-bold hover:!text-gyaru-pink/80 hover:!underline">Go back to Login/Upload</a></p>
    </div>
  );
}
