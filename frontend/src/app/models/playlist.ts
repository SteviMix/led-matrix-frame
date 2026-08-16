export interface Playlist {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  image_count?: number; // only present on GET /api/playlists (the list endpoint)
}

export interface Image {
  id: number;
  playlist_id: number | null;
  original_path: string;
  processed_path: string;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
  source: 'upload' | 'draw' | 'paint-by-number';
  sort_order: number;
  created_at: string;
}

// GET /api/playlists/:id returns a playlist with its images nested.
export interface PlaylistWithImages extends Playlist {
  images: Image[];
}
