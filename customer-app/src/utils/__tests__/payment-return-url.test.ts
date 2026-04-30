import {
  getSafeConfiguredReturnBaseUrl,
  isAllowedLocalPaymentReturnOrigin,
  isPrivateOrLoopbackHostname,
  isUnsafePaymentReturnOrigin,
} from '../payment-return-url';

describe('payment return URL safety', () => {
  test('marks private and loopback hosts as unsafe', () => {
    expect(isPrivateOrLoopbackHostname('localhost')).toBe(true);
    expect(isPrivateOrLoopbackHostname('10.23.152.231')).toBe(true);
    expect(isPrivateOrLoopbackHostname('192.168.1.24')).toBe(true);
    expect(isPrivateOrLoopbackHostname('172.16.0.25')).toBe(true);
    expect(isPrivateOrLoopbackHostname('172.31.255.9')).toBe(true);
    expect(isPrivateOrLoopbackHostname('example.com')).toBe(false);
  });

  test('rejects private payment return origins', () => {
    expect(isUnsafePaymentReturnOrigin('http://10.23.152.231:5173')).toBe(true);
    expect(isUnsafePaymentReturnOrigin('http://localhost:5173')).toBe(true);
    expect(isUnsafePaymentReturnOrigin('https://roomfindr.example.com')).toBe(false);
  });

  test('allows loopback return origins for local development redirects', () => {
    expect(isAllowedLocalPaymentReturnOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedLocalPaymentReturnOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedLocalPaymentReturnOrigin('http://10.23.152.231:5173')).toBe(false);
  });

  test('prefers safe configured URLs over a private browser origin', () => {
    expect(getSafeConfiguredReturnBaseUrl([
      'https://roomfindr.example.com',
    ], 'http://10.23.152.231:5173')).toBe('https://roomfindr.example.com');
  });

  test('falls back to empty when only private origins are available', () => {
    expect(getSafeConfiguredReturnBaseUrl([], 'http://10.23.152.231:5173')).toBe('');
  });

  test('allows the current loopback origin when running the app locally', () => {
    expect(getSafeConfiguredReturnBaseUrl([], 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
  });
});
