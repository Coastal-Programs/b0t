import crypto from 'crypto';
import { logger } from './logger';

// Validate encryption key on module load (fail fast in production)
const validateEncryptionKey = (): void => {
  // Skip validation during build time
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const key = process.env.ENCRYPTION_KEY;
  const authSecret = process.env.AUTH_SECRET;

  // Production: ENCRYPTION_KEY is strictly required
  if (process.env.NODE_ENV === 'production') {
    if (!key) {
      throw new Error(
        'ENCRYPTION_KEY must be set in production. Generate with: openssl rand -base64 32'
      );
    }
    if (key === authSecret) {
      throw new Error(
        'ENCRYPTION_KEY and AUTH_SECRET must be different for security. Generate separate keys.'
      );
    }
  }

  // Development: Warn if using fallback
  if (!key && authSecret) {
    logger.warn(
      'ENCRYPTION_KEY not set, falling back to AUTH_SECRET. Set ENCRYPTION_KEY for production.'
    );
  }

  if (!key && !authSecret) {
    throw new Error(
      'Either ENCRYPTION_KEY or AUTH_SECRET must be set. Generate with: openssl rand -base64 32'
    );
  }
};

// Run validation on module load (but not during build)
validateEncryptionKey();

// Get encryption key from environment (fallback to AUTH_SECRET in development only)
const getEncryptionKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!key) {
    throw new Error('ENCRYPTION_KEY or AUTH_SECRET must be set for credential encryption');
  }
  // Derive a full 32-byte (256-bit) key via SHA-256
  return crypto.createHash('sha256').update(key).digest();
};

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12; // GCM recommended IV length
const CBC_ALGORITHM = 'aes-256-cbc';
const CBC_IV_LENGTH = 16;

/**
 * Encrypt a string value using AES-256-GCM (authenticated encryption)
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Return IV + encrypted data + auth tag (all in hex)
  return iv.toString('hex') + ':' + encrypted + ':' + authTag.toString('hex');
}

/**
 * Decrypt legacy AES-256-CBC encrypted data (2-part format: iv:ciphertext)
 */
function decryptCBC(parts: string[], key: Buffer): string {
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = crypto.createDecipheriv(CBC_ALGORITHM, key, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Decrypt AES-256-GCM encrypted data (3-part format: iv:ciphertext:authTag)
 */
function decryptGCM(parts: string[], key: Buffer): string {
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const authTag = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Decrypt an encrypted string. Supports both legacy CBC (2-part) and GCM (3-part) formats.
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');

  if (parts.length === 3) {
    return decryptGCM(parts, key);
  }

  if (parts.length === 2) {
    return decryptCBC(parts, key);
  }

  throw new Error('Invalid encrypted data format');
}
