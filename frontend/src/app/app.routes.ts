import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/viewer/viewer').then(m => m.Viewer) },
  { path: 'slideshow', loadComponent: () => import('./pages/slideshow/slideshow').then(m => m.Slideshow) },
  { path: 'draw', loadComponent: () => import('./pages/draw/draw').then(m => m.Draw) },
  { path: 'pbn', loadComponent: () => import('./pages/pbn/pbn').then(m => m.Pbn) },
  { path: 'admin', loadComponent: () => import('./pages/admin/admin').then(m => m.Admin) },
  { path: '**', redirectTo: '' },
];
