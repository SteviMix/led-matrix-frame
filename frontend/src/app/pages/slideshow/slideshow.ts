import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Image, Playlist, PlaylistWithImages } from '../../models/playlist';
import { ApiService } from '../../services/api';
import { StatusService } from '../../services/status';

@Component({
  selector: 'app-slideshow',
  imports: [],
  templateUrl: './slideshow.html',
  styleUrl: './slideshow.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Slideshow implements OnInit {
  private api = inject(ApiService);
  private statusService = inject(StatusService);

  protected readonly playlists = signal<Playlist[]>([]);
  protected readonly images = signal<Image[]>([]);
  protected readonly selectedPlaylist = signal<PlaylistWithImages | null>(null);
  protected readonly newPlaylistName = signal('');
  protected readonly intervalInput = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // Everything below is derived from the shared status signal - never stored
  // separately, so it always matches the last /api/status response.
  protected readonly statusError = this.statusService.error;

  protected readonly currentModeName = computed(
    () => this.statusService.status()?.mode.mode ?? null
  );

  // The slideshow's mode state, or null when another mode (or idle) is active.
  protected readonly slideshow = computed(() => {
    const mode = this.statusService.status()?.mode;
    return mode?.mode === 'slideshow' ? mode : null;
  });

  // 1-based position for display, or null when nothing is on the panel yet
  // (e.g. the active playlist is empty).
  protected readonly position = computed(() => {
    const state = this.slideshow();
    if (!state || state.currentIndex == null || !state.imageCount) {
      return null;
    }
    return { current: state.currentIndex + 1, total: state.imageCount };
  });

  protected readonly activePlaylistName = computed(() => {
    const id = this.slideshow()?.playlistId;
    return id == null ? 'No playlist selected' : this.playlistName(id);
  });

  ngOnInit(): void {
    this.loadPlaylists();
    this.loadImages();
    // Re-fetch on entry: the shell's initial fetch may be stale by the time
    // this screen opens.
    this.statusService.refresh();
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
        // Deleting the active playlist empties the running slideshow.
        this.statusService.refresh();
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

  // --- Slideshow playback -------------------------------------------------

  protected playPlaylist(playlistId: number): void {
    this.runSlideshowAction(this.api.startSlideshow(playlistId), 'Failed to start slideshow.');
  }

  protected stopSlideshow(): void {
    this.runSlideshowAction(this.api.stopSlideshow(), 'Failed to stop slideshow.');
  }

  protected nextSlide(): void {
    this.runSlideshowAction(this.api.nextSlide(), 'Failed to go to the next image.');
  }

  protected previousSlide(): void {
    this.runSlideshowAction(this.api.previousSlide(), 'Failed to go to the previous image.');
  }

  // The backend timer advances the slideshow on its own, so the displayed
  // position goes stale between actions. Until live updates exist, this lets
  // the user re-sync with the server on demand.
  protected refreshStatus(): void {
    this.statusService.refresh();
  }

  protected onIntervalSubmit(event: Event): void {
    event.preventDefault();
    // Input values are always strings; the backend only accepts a JSON
    // number > 0, so convert and pre-check here. The backend stays the real
    // validator - its 400 message is shown if it still rejects the value.
    const raw = this.intervalInput().trim();
    const seconds = Number(raw);
    if (raw === '' || !Number.isFinite(seconds) || seconds <= 0) {
      this.error.set('Interval must be a positive number of seconds.');
      return;
    }

    this.error.set(null);
    this.api.updateSlideshowSettings(seconds).subscribe({
      next: () => {
        this.intervalInput.set('');
        this.statusService.refresh();
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(this.backendMessage(err) ?? 'Failed to update interval.')
    });
  }

  // A given image can link to any playlist it is not already in.
  protected availablePlaylistsFor(image: Image): Playlist[] {
    return this.playlists().filter((playlist) => !image.playlist_ids.includes(playlist.id));
  }

  protected playlistName(id: number): string {
    return this.playlists().find((playlist) => playlist.id === id)?.name ?? `#${id}`;
  }

  // Calls a mode endpoint, then re-fetches status - on success AND on error.
  // An error (e.g. 409 "Slideshow is not the active mode") usually means the
  // UI was out of date, so re-fetching is exactly how it catches up. The
  // endpoint's own response body is deliberately ignored: status has a single
  // write path, StatusService.refresh().
  private runSlideshowAction(request: Observable<unknown>, failMessage: string): void {
    this.error.set(null);
    request.subscribe({
      next: () => this.statusService.refresh(),
      error: (err: HttpErrorResponse) => {
        this.error.set(this.backendMessage(err) ?? failMessage);
        this.statusService.refresh();
      }
    });
  }

  // The backend reports errors as { error: "..." }; returns that text if present.
  private backendMessage(err: HttpErrorResponse): string | null {
    const body: unknown = err.error;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
    return null;
  }

  // Linking/unlinking can change image_count (on playlists) and playlist_ids
  // (on images), plus the currently open playlist's membership and the active
  // slideshow's imageCount - all must be re-fetched from the server, never
  // hand-edited locally.
  private refreshAfterLinkChange(): void {
    this.loadPlaylists();
    this.loadImages();
    this.statusService.refresh();
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
