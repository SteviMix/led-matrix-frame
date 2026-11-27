export interface StatusMode {
  mode: 'idle' | 'slideshow' | 'draw' | 'paint-by-number';
  // Slideshow fields - only present while mode === 'slideshow'.
  playlistId?: number | null;
  imageCount?: number;
  currentIndex?: number | null; // index of the image currently on the panel
  intervalSeconds?: number;
  running?: boolean;
  // Paint-by-number fields - only present while mode === 'paint-by-number'.
  sessionId?: number;
  gridWidth?: number;
  gridHeight?: number;
  totalBlocks?: number;
  revealedCount?: number;
}

export interface Status {
  rendererConnected: boolean;
  uptimeSeconds: number;
  database: {
    connected: boolean;
    rowCounts: Record<string, number>;
  };
  mode: StatusMode;
}
