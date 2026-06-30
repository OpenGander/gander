import { describe, it, expect } from 'vitest';
import {
  verifyCodeChallenge,
  generateCodeChallenge,
  isValidCodeVerifier,
} from './pkce';

describe('PKCE Utilities', () => {
  describe('generateCodeChallenge', () => {
    it('should generate a base64url-encoded SHA256 hash', () => {
      // Known test vector from RFC 7636 Appendix B
      // code_verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
      // code_challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const challenge = generateCodeChallenge(verifier);
      expect(challenge).toBe(expectedChallenge);
    });

    it('should produce consistent output for same input', () => {
      const verifier = 'test-verifier-1234567890-abcdefghijklmnop';
      const challenge1 = generateCodeChallenge(verifier);
      const challenge2 = generateCodeChallenge(verifier);

      expect(challenge1).toBe(challenge2);
    });

    it('should produce different output for different inputs', () => {
      const verifier1 = 'test-verifier-1234567890-abcdefghijklmnop';
      const verifier2 = 'test-verifier-1234567890-abcdefghijklmnoq';

      const challenge1 = generateCodeChallenge(verifier1);
      const challenge2 = generateCodeChallenge(verifier2);

      expect(challenge1).not.toBe(challenge2);
    });

    it('should not contain base64 special characters', () => {
      // Generate challenges with various inputs to verify base64url encoding
      const verifiers = [
        'abc123def456ghij789klmnop012345qrstuv67890',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      ];

      for (const verifier of verifiers) {
        const challenge = generateCodeChallenge(verifier);
        // base64url should not have +, /, or = characters
        expect(challenge).not.toMatch(/[+/=]/);
        // Should only have base64url characters
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });
  });

  describe('verifyCodeChallenge', () => {
    it('should return true for valid verifier/challenge pair', () => {
      // RFC 7636 Appendix B test vector
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
    });

    it('should return true for self-generated pairs', () => {
      const verifier = 'test-verifier-1234567890-abcdefghijklmnop';
      const challenge = generateCodeChallenge(verifier);

      expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
    });

    it('should return false for wrong verifier', () => {
      const correctVerifier = 'correct-verifier-12345678901234567890';
      const wrongVerifier = 'wrong-verifier-123456789012345678901';
      const challenge = generateCodeChallenge(correctVerifier);

      expect(verifyCodeChallenge(wrongVerifier, challenge)).toBe(false);
    });

    it('should return false for tampered challenge', () => {
      const verifier = 'test-verifier-1234567890-abcdefghijklmnop';
      const correctChallenge = generateCodeChallenge(verifier);
      const tamperedChallenge = correctChallenge.slice(0, -1) + 'X';

      expect(verifyCodeChallenge(verifier, tamperedChallenge)).toBe(false);
    });

    it('should return false for empty challenge', () => {
      const verifier = 'test-verifier-1234567890-abcdefghijklmnop';
      expect(verifyCodeChallenge(verifier, '')).toBe(false);
    });

    it('should return false for empty verifier', () => {
      const verifier = 'test-verifier-1234567890-abcdefghijklmnop';
      const challenge = generateCodeChallenge(verifier);
      expect(verifyCodeChallenge('', challenge)).toBe(false);
    });

    it('should be case-sensitive', () => {
      const verifier = 'Test-Verifier-1234567890-abcdefghijklmnop';
      const challenge = generateCodeChallenge(verifier);

      // Lowercase version should not match
      expect(verifyCodeChallenge(verifier.toLowerCase(), challenge)).toBe(false);
    });
  });

  describe('isValidCodeVerifier', () => {
    describe('length validation', () => {
      it('should reject verifiers shorter than 43 characters', () => {
        expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
        expect(isValidCodeVerifier('a'.repeat(10))).toBe(false);
        expect(isValidCodeVerifier('')).toBe(false);
      });

      it('should accept verifiers exactly 43 characters', () => {
        expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
      });

      it('should accept verifiers between 43-128 characters', () => {
        expect(isValidCodeVerifier('a'.repeat(64))).toBe(true);
        expect(isValidCodeVerifier('a'.repeat(100))).toBe(true);
        expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
      });

      it('should reject verifiers longer than 128 characters', () => {
        expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
        expect(isValidCodeVerifier('a'.repeat(200))).toBe(false);
      });
    });

    describe('character validation', () => {
      it('should accept valid unreserved characters', () => {
        // All letters
        expect(isValidCodeVerifier('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')).toBe(true);
        // All digits
        expect(isValidCodeVerifier('0123456789012345678901234567890123456789012')).toBe(true);
        // Mixed with allowed special chars
        expect(isValidCodeVerifier('abc-123_456.789~ABC_DEF-GHI.JKL~MNO_PQR-STU')).toBe(true);
      });

      it('should accept dash (-)', () => {
        expect(isValidCodeVerifier('a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v')).toBe(true);
      });

      it('should accept period (.)', () => {
        expect(isValidCodeVerifier('a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v')).toBe(true);
      });

      it('should accept underscore (_)', () => {
        expect(isValidCodeVerifier('a_b_c_d_e_f_g_h_i_j_k_l_m_n_o_p_q_r_s_t_u_v')).toBe(true);
      });

      it('should accept tilde (~)', () => {
        expect(isValidCodeVerifier('a~b~c~d~e~f~g~h~i~j~k~l~m~n~o~p~q~r~s~t~u~v')).toBe(true);
      });

      it('should reject spaces', () => {
        expect(isValidCodeVerifier('abcdefghij klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
      });

      it('should reject plus sign (+)', () => {
        expect(isValidCodeVerifier('abcdefghij+klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
      });

      it('should reject forward slash (/)', () => {
        expect(isValidCodeVerifier('abcdefghij/klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
      });

      it('should reject equals sign (=)', () => {
        expect(isValidCodeVerifier('abcdefghij=klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
      });

      it('should reject special characters not in unreserved set', () => {
        expect(isValidCodeVerifier('abcdefghij@klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
        expect(isValidCodeVerifier('abcdefghij#klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
        expect(isValidCodeVerifier('abcdefghij$klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
        expect(isValidCodeVerifier('abcdefghij&klmnopqrstuvwxyzABCDEFGHIJKLMNOP')).toBe(false);
      });
    });

    describe('real-world examples', () => {
      it('should accept RFC 7636 example verifier', () => {
        expect(isValidCodeVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(true);
      });

      it('should accept typical client-generated verifiers', () => {
        // These simulate what Claude Desktop or Cursor might generate
        expect(isValidCodeVerifier('xyzABC123_-~.xyzABC123_-~.xyzABC123_-~.xyzABC')).toBe(true);
        expect(isValidCodeVerifier('aB3dEf6hIj1lMn4pQr7tUv0wXy2zA5bC8dEf1gHi4jK')).toBe(true);
      });
    });
  });
});
