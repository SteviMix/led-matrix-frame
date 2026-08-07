export interface StatusMode {
  mode: 'idle' | 'slideshow' | 'draw' | 'paint-by-number';
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
