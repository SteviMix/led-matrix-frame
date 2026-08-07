import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-draw',
  imports: [],
  templateUrl: './draw.html',
  styleUrl: './draw.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Draw {}
