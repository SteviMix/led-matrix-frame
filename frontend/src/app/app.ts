import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { StatusService } from './services/status';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  private statusService = inject(StatusService);

  protected readonly title = signal('frontend');
  // Shared with every other component via StatusService - not a private copy.
  protected readonly status = this.statusService.status;

  ngOnInit(): void {
    this.statusService.refresh();
  }
}
