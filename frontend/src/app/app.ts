import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { Status } from './models/status';
import { ApiService } from './services/api';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  private api = inject(ApiService);

  protected readonly title = signal('frontend');
  protected readonly status = signal<Status | null>(null);

  ngOnInit(): void {
    this.api.getStatus().subscribe({
      next: (value) => this.status.set(value),
      error: (err) => console.error('status fetch failed', err)
    });
  }
}
