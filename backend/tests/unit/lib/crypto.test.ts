import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../../src/lib/crypto.js';

describe('crypto (AES-256-GCM refresh token encryption)', () => {
  const plaintext = 'refresh-token-abc123';

  it('encrypts then decrypts back to original plaintext', () => {
    const ciphertext = encrypt(plaintext);
    const result = decrypt(ciphertext);

    expect(result).toBe(plaintext);
  });

  it('produces different ciphertext on repeat encryption (random IV)', () => {
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);

    expect(a).not.toBe(b);
  });

  it('fails to decrypt tampered ciphertext (GCM tag)', () => {
    const ciphertext = encrypt(plaintext);
    const buf = Buffer.from(ciphertext, 'base64');
    // Flip a byte in the encrypted portion (after IV + auth tag = 28 bytes)
    if (buf.length > 29) buf[29] ^= 0xff;
    const tampered = buf.toString('base64');

    expect(() => decrypt(tampered)).toThrow();
  });

  it('output is valid base64 and contains IV + tag + ciphertext', () => {
    const ciphertext = encrypt(plaintext);
    const buf = Buffer.from(ciphertext, 'base64');

    // IV (12) + Auth Tag (16) + at least 1 byte of encrypted data
    expect(buf.length).toBeGreaterThanOrEqual(29);
  });

  it('handles empty string encryption', () => {
    const ciphertext = encrypt('');
    const result = decrypt(ciphertext);

    expect(result).toBe('');
  });

  it('handles unicode plaintext', () => {
    const unicodeText = '🎬 Mon film préféré — ñ';
    const ciphertext = encrypt(unicodeText);
    const result = decrypt(ciphertext);

    expect(result).toBe(unicodeText);
  });
});
