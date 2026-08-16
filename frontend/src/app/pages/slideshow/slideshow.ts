import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';

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

  protected readonly unassignedImages = computed(() =>
    this.images().filter((image) => image.playlist_id === null)
  );

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

  protected assignImage(imageId: number, playlistId: number | null): void {
    this.error.set(null);
    this.api.assignImage(imageId, playlistId).subscribe({
      next: () => {
        this.loadImages();
        this.loadPlaylists(); // image_count lives on the playlists list, not the images list
        const selected = this.selectedPlaylist();
        if (selected) {
          this.selectPlaylist(selected.id);
        }
      },
      error: () => this.error.set('Failed to update image assignment.')
    });
  }

  private isDuplicateName(name: string, excludeId?: number): boolean {
    const normalized = name.toLowerCase();
    return this.playlists().some(
      (playlist) => playlist.id !== excludeId && playlist.name.toLowerCase() === normalized
    );
  }
}
