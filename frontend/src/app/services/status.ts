import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';

import { Status } from '../models/status';
import { ApiService } from './api';

// Single source of truth for backend status (/api/status) across the whole app.
//
// providedIn: 'root' makes this a singleton, so every component that injects
// it reads the same signal - the app shell and the slideshow screen can never
// disagree about the current mode.
//
// Only this service writes the signal, and only with what the server returned:
// components expose no setter, they call refresh() after any mutation that can
// change status, and the re-fetched value flows to every reader.
@Injectable({ providedIn: 'root' })
export class StatusService {
  private api = inject(ApiService);

  private readonly statusSignal = signal<Status | null>(null);
  private readonly errorSignal = signal<string | null>(null);

  // Read-only views: components can read these but cannot .set() them.
  readonly status = this.statusSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  private readonly refreshRequests = new Subject<void>();

  constructor() {
    // switchMap cancels an in-flight GET when a newer refresh is requested,
    // so an older response arriving late can never overwrite a newer one.
    // catchError sits on the inner request so one failed fetch does not
    // terminate the outer stream - later refreshes still work.
    this.refreshRequests
      .pipe(
        switchMap(() =>
          this.api.getStatus().pipe(
            catchError((err) => {
              console.error('status fetch failed', err);
              this.errorSignal.set('Failed to load backend status.');
              return EMPTY;
            })
          )
        )
      )
      .subscribe((status) => {
        this.statusSignal.set(status);
        this.errorSignal.set(null);
      });
  }

  refresh(): void {
    this.refreshRequests.next();
  }
}
