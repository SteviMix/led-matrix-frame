import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { Status } from './models/status';

// Minimal /api/status response - only the fields the shell renders matter.
const FAKE_STATUS: Status = {
  rendererConnected: true,
  uptimeSeconds: 1,
  database: { connected: true, rowCounts: {} },
  mode: { mode: 'slideshow' }
};

describe('App', () => {
  // The fake HTTP backend: requests are recorded instead of sent, so the test
  // never depends on a running backend (CI has none).
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Fails the test if the component made a request the test did not expect.
    httpTesting.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/status');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show loading, then the mode from /api/status', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Loading status…');

    httpTesting.expectOne('/api/status').flush(FAKE_STATUS);
    await fixture.whenStable();

    expect(compiled.textContent).toContain('Mode: slideshow');
  });

  it('should render the nav links', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/status');

    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('nav a'),
      (link) => link.textContent?.trim()
    );
    expect(links).toEqual(['Viewer', 'Slideshow', 'Draw', 'Paint-by-number', 'Admin']);
  });
});
