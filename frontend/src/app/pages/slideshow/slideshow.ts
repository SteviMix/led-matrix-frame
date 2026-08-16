import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { Image, Playlist, PlaylistWithImages } from '../../models/playlist';
import { ApiService } from '../../services/api';

@Component({
  selector: 'app-slideshow',
  imports: [],
  templateUrl: './slideshow.html',
  styleUrl: './slideshow.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Slideshow implements OnInit {
  private api = inject(ApiService);

  protected readonly playlists = signal<Playlist[]>([]);
  protected readonly images = signal<Image[]>([]);
  protected readonly selectedPlaylist = signal<PlaylistWithImages | null>(null);
  protected readonly newPlaylistName = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadPlaylists();
    this.loadImages();
  }

  protected loadPlaylists(): void {
    this.error.set(null);
    this.loading.set(true);
    this.api.getPlaylists().subscribe({
      next: (playlists) => {
        this.playlists.set(playlists);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load playlists.');
        this.loading.set(false);
      }
    });
  }

  protected loadImages(): void {
    this.error.set(null);
    this.loading.set(true);
    this.api.getImages().subscribe({
      next: (images) => {
        this.images.set(images);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load images.');
        this.loading.set(false);
      }
    });
  }

  protected selectPlaylist(id: number): void {
    this.error.set(null);
    this.api.getPlaylist(id).subscribe({
      next: (playlist) => this.selectedPlaylist.set(playlist),
      error: () => this.error.set('Failed to load playlist.')
    });
  }

  protected closeSelectedPlaylist(): void {
    this.selectedPlaylist.set(null);
  }

  protected onCreateSubmit(event: Event): void {
    event.preventDefault();
    this.createPlaylist();
  }

  protected createPlaylist(): void {
    const name = this.newPlaylistName().trim();
    if (!name) {
      return;
    }
    if (this.isDuplicateName(name)) {
      this.error.set(`A playlist named "${name}" already exists.`);
      return;
    }

    this.error.set(null);
    this.api.createPlaylist(name).subscribe({
      next: () => {
        this.newPlaylistName.set('');
        this.loadPlaylists();
      },
      error: () => this.error.set('Failed to create playlist.')
    });
  }

  protected renamePlaylist(id: number, currentName: string): void {
    const name = window.prompt('New playlist name:', currentName);
    if (!name || !name.trim()) {
      return;
    }
    const trimmed = name.trim();
    if (this.isDuplicateName(trimmed, id)) {
      this.error.set(`A playlist named "${trimmed}" already exists.`);
      return;
    }

    this.error.set(null);
    this.api.renamePlaylist(id, trimmed).subscribe({
      next: () => {
        this.loadPlaylists();
        if (this.selectedPlaylist()?.id === id) {
          this.selectPlaylist(id);
        }
      },
      error: () => this.error.set('Failed to rename playlist.')
    });
  }

  protected deletePlaylist(id: number): void {
    this.error.set(null);
    this.api.deletePlaylist(id).subscribe({
      next: () => {
        this.loadPlaylists();
        this.loadImages();
        if (this.selectedPlaylist()?.id === id) {
          this.selectedPlaylist.set(null);
        }
      },
      error: () => this.error.set('Failed to delete playlist.')
    });
  }

  protected linkImage(playlistId: number, imageId: number): void {
    this.error.set(null);
    this.api.linkImage(playlistId, imageId).subscribe({
      next: () => this.refreshAfterLinkChange(),
      error: (err: HttpErrorResponse) => {
        // 409 = already linked. Not a failure worth blocking on - the pair is
        // already in the state the user wanted, so just note it and re-fetch
        // to make sure the UI reflects the (already-correct) server state.
        this.error.set(
          err.status === 409
            ? 'That image is already in that playlist.'
            : 'Failed to link image to playlist.'
        );
        this.refreshAfterLinkChange();
      }
    });
  }

  protected unlinkImage(playlistId: number, imageId: number): void {
    this.error.set(null);
    this.api.unlinkImage(playlistId, imageId).subscribe({
      next: () => this.refreshAfterLinkChange(),
      error: () => this.error.set('Failed to unlink image from playlist.')
    });
  }

  // A given image can link to any playlist it is not already in.
  protected availablePlaylistsFor(image: Image): Playlist[] {
    return this.playlists().filter((playlist) => !image.playlist_ids.includes(playlist.id));
  }

  protected playlistName(id: number): string {
    return this.playlists().find((playlist) => playlist.id === id)?.name ?? `#${id}`;
  }

  // Linking/unlinking can change image_count (on playlists) and playlist_ids
  // (on images), plus the currently open playlist's membership - all three
  // must be re-fetched from the server, never hand-edited locally.
  private refreshAfterLinkChange(): void {
    this.loadPlaylists();
    this.loadImages();
    const selected = this.selectedPlaylist();
    if (selected) {
      this.selectPlaylist(selected.id);
    }
  }

  private isDuplicateName(name: string, excludeId?: number): boolean {
    const normalized = name.toLowerCase();
    return this.playlists().some(
      (playlist) => playlist.id !== excludeId && playlist.name.toLowerCase() === normalized
    );
  }
}
