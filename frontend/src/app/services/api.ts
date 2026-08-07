import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Status } from '../models/status';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getStatus(): Observable<Status> {
    return this.http.get<Status>('/api/status');
  }
}
