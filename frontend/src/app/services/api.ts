import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Image, Playlist, PlaylistWithImages } from '../models/playlist';
import { Status } from '../models/status';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getStatus(): Observable<Status> {
    return this.http.get<Status>('/api/status');
  }

  getPlaylists(): Observable<Playlist[]> {
    return this.http.get<Playlist[]>('/api/playlists');
  }

  getPlaylist(id: number): Observable<PlaylistWithImages> {
    return this.http.get<PlaylistWithImages>(`/api/playlists/${id}`);
  }

  createPlaylist(name: string): Observable<Playlist> {
    return this.http.post<Playlist>('/api/playlists', { name });
  }

  renamePlaylist(id: number, name: string): Observable<Playlist> {
    return this.http.patch<Playlist>(`/api/playlists/${id}`, { name });
  }

  deletePlaylist(id: number): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`/api/playlists/${id}`);
  }

  getImages(): Observable<Image[]> {
    return this.http.get<Image[]>('/api/images');
  }

  assignImage(imageId: number, playlistId: number | null): Observable<Image> {
    return this.http.patch<Image>(`/api/images/${imageId}`, { playlistId });
  }
}
