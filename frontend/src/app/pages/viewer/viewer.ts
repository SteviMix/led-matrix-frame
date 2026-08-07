import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-viewer',
  imports: [],
  templateUrl: './viewer.html',
  styleUrl: './viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Viewer {}
