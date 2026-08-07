import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-slideshow',
  imports: [],
  templateUrl: './slideshow.html',
  styleUrl: './slideshow.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Slideshow {}
