export interface Playlist {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  image_count?: number; // only present on GET /api/playlists (the list endpoint)
}

export interface Image {
  id: number;
  original_path: string;
  processed_path: string;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
  source: 'upload' | 'draw' | 'paint-by-number';
  created_at: string;
  playlist_ids: number[]; // every playlist this image currently belongs to (many-to-many)
  sort_order?: number; // this image's position - only present when nested under a specific playlist
}

// GET /api/playlists/:id returns a playlist with its images nested.
export interface PlaylistWithImages extends Playlist {
  images: Image[];
}
