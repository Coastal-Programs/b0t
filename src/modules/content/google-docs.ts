import { google } from 'googleapis';
import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

/**
 * Google Docs Module
 *
 * Create and manipulate Google Docs documents programmatically
 * - Create documents from templates
 * - Replace text placeholders
 * - Insert images at specific positions
 * - Export documents to PDF
 * - Built-in resilience
 *
 * Perfect for:
 * - Document automation from templates
 * - Contract and agreement generation
 * - Report creation with dynamic content
 * - PDF export workflows
 */

// Service Account credentials from environment
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  logger.warn(
    '⚠️  GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY not set. Google Docs features will not work.'
  );
}

// Initialize Google API clients
let docsClient: ReturnType<typeof google.docs> | null = null;
let driveClient: ReturnType<typeof google.drive> | null = null;

if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
      },
      scopes: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
      ],
    });

    docsClient = google.docs({ version: 'v1', auth });
    driveClient = google.drive({ version: 'v3', auth });
    logger.info({}, 'Google Docs client initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Google Docs client');
  }
}

// Rate limiter: Google Docs API allows 100 requests/minute
const googleDocsRateLimiter = createRateLimiter({
  maxConcurrent: 5,
  minTime: 600, // 600ms between requests ≈ 100/min
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60000,
  id: 'google-docs',
});

// Type definitions
export interface TextReplacement {
  find: string;
  replace: string;
}

export interface ImageInsertion {
  index: number;
  imageUrl: string;
  width?: number;
  height?: number;
}

interface InsertInlineImageRequest {
  insertInlineImage: {
    location: {
      index: number;
    };
    uri: string;
    objectSize?: {
      width?: { magnitude: number; unit: string };
      height?: { magnitude: number; unit: string };
    };
  };
}

export interface GoogleDocument {
  id: string;
  title: string;
  revisionId: string;
  documentLink: string;
}

/**
 * Create document from template (internal)
 */
async function createFromTemplateInternal(
  templateId: string,
  name: string,
  options: {
    folderId?: string;
    replacements?: TextReplacement[];
  } = {}
): Promise<GoogleDocument> {
  if (!driveClient || !docsClient) {
    throw new Error(
      'Google Docs client not initialized. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.'
    );
  }

  logger.info({ templateId, name }, 'Creating document from template');

  // Step 1: Copy template file
  const copyResponse = await driveClient.files.copy({
    fileId: templateId,
    requestBody: {
      name,
      parents: options.folderId ? [options.folderId] : undefined,
    },
    fields: 'id,name,webViewLink',
  });

  const documentId = copyResponse.data.id!;
  const documentLink = copyResponse.data.webViewLink!;

  logger.info({ documentId, name }, 'Template copied successfully');

  // Step 2: Apply text replacements if provided
  if (options.replacements && options.replacements.length > 0) {
    const requests = options.replacements.map((replacement) => ({
      replaceAllText: {
        containsText: {
          text: replacement.find,
          matchCase: false,
        },
        replaceText: replacement.replace,
      },
    }));

    await docsClient.documents.batchUpdate({
      documentId,
      requestBody: { requests },
    });

    logger.info(
      { documentId, replacementCount: options.replacements.length },
      'Text replacements applied'
    );
  }

  // Step 3: Get document metadata
  const docResponse = await docsClient.documents.get({ documentId });

  return {
    id: documentId,
    title: docResponse.data.title!,
    revisionId: docResponse.data.revisionId!,
    documentLink,
  };
}

/**
 * Create document from template
 *
 * Copy a Google Docs template and optionally replace text placeholders
 *
 * @param templateId - ID of the template document
 * @param name - Name for the new document
 * @param options - Configuration options (folderId, replacements)
 * @returns Document metadata
 * @example
 * const doc = await createFromTemplate(
 *   '1abc...xyz',
 *   'Contract for John Doe',
 *   {
 *     folderId: '1folder...id',
 *     replacements: [
 *       { find: '{{name}}', replace: 'John Doe' },
 *       { find: '{{date}}', replace: '2024-01-20' }
 *     ]
 *   }
 * );
 */
const createFromTemplateWithBreaker = createCircuitBreaker(createFromTemplateInternal, {
  timeout: 30000,
  name: 'google-docs-create-from-template',
});

export const createFromTemplate = withRateLimit(
  (
    templateId: string,
    name: string,
    options?: {
      folderId?: string;
      replacements?: TextReplacement[];
    }
  ) => createFromTemplateWithBreaker.fire(templateId, name, options),
  googleDocsRateLimiter
);

/**
 * Replace text in document (internal)
 */
async function replaceTextInternal(
  documentId: string,
  replacements: TextReplacement[]
): Promise<void> {
  if (!docsClient) {
    throw new Error(
      'Google Docs client not initialized. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.'
    );
  }

  logger.info({ documentId, replacementCount: replacements.length }, 'Replacing text in document');

  const requests = replacements.map((replacement) => ({
    replaceAllText: {
      containsText: {
        text: replacement.find,
        matchCase: false,
      },
      replaceText: replacement.replace,
    },
  }));

  await docsClient.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });

  logger.info({ documentId }, 'Text replacements applied');
}

/**
 * Replace text in document
 *
 * Replace all occurrences of text placeholders in a Google Doc
 *
 * @param documentId - ID of the document
 * @param replacements - Array of find/replace pairs
 * @example
 * await replaceText('1abc...xyz', [
 *   { find: '{{firstName}}', replace: 'John' },
 *   { find: '{{lastName}}', replace: 'Doe' },
 *   { find: '{{email}}', replace: 'john@example.com' }
 * ]);
 */
const replaceTextWithBreaker = createCircuitBreaker(replaceTextInternal, {
  timeout: 15000,
  name: 'google-docs-replace-text',
});

export const replaceText = withRateLimit(
  (documentId: string, replacements: TextReplacement[]) =>
    replaceTextWithBreaker.fire(documentId, replacements),
  googleDocsRateLimiter
);

/**
 * Insert image in document (internal)
 */
async function insertImageInternal(
  documentId: string,
  imageUrl: string,
  index: number,
  options: {
    width?: number;
    height?: number;
  } = {}
): Promise<void> {
  if (!docsClient) {
    throw new Error(
      'Google Docs client not initialized. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.'
    );
  }

  logger.info({ documentId, imageUrl, index }, 'Inserting image into document');

  const request: InsertInlineImageRequest = {
    insertInlineImage: {
      location: {
        index,
      },
      uri: imageUrl,
      objectSize:
        options.width || options.height
          ? {
              width: options.width ? { magnitude: options.width, unit: 'PT' } : undefined,
              height: options.height ? { magnitude: options.height, unit: 'PT' } : undefined,
            }
          : undefined,
    },
  };

  await docsClient.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [request],
    },
  });

  logger.info({ documentId, index }, 'Image inserted successfully');
}

/**
 * Insert image in document
 *
 * Insert an image at a specific position in a Google Doc
 *
 * @param documentId - ID of the document
 * @param imageUrl - URL of the image to insert
 * @param index - Character position where to insert (0-based)
 * @param options - Optional width and height in points
 * @example
 * await insertImage(
 *   '1abc...xyz',
 *   'https://example.com/signature.png',
 *   8552,
 *   { width: 256, height: 108 }
 * );
 */
const insertImageWithBreaker = createCircuitBreaker(insertImageInternal, {
  timeout: 15000,
  name: 'google-docs-insert-image',
});

export const insertImage = withRateLimit(
  (
    documentId: string,
    imageUrl: string,
    index: number,
    options?: {
      width?: number;
      height?: number;
    }
  ) => insertImageWithBreaker.fire(documentId, imageUrl, index, options),
  googleDocsRateLimiter
);

/**
 * Insert multiple images in document (internal)
 */
async function insertImagesInternal(
  documentId: string,
  images: ImageInsertion[]
): Promise<void> {
  if (!docsClient) {
    throw new Error(
      'Google Docs client not initialized. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.'
    );
  }

  logger.info({ documentId, imageCount: images.length }, 'Inserting multiple images into document');

  // Sort images by index in descending order to avoid index shifting
  const sortedImages = [...images].sort((a, b) => b.index - a.index);

  const requests = sortedImages.map((image): InsertInlineImageRequest => ({
    insertInlineImage: {
      location: {
        index: image.index,
      },
      uri: image.imageUrl,
      objectSize:
        image.width || image.height
          ? {
              width: image.width ? { magnitude: image.width, unit: 'PT' } : undefined,
              height: image.height ? { magnitude: image.height, unit: 'PT' } : undefined,
            }
          : undefined,
    },
  }));

  await docsClient.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });

  logger.info({ documentId, imageCount: images.length }, 'Images inserted successfully');
}

/**
 * Insert multiple images in document
 *
 * Insert multiple images at specific positions in a Google Doc
 *
 * @param documentId - ID of the document
 * @param images - Array of image insertions with position and URL
 * @example
 * await insertImages('1abc...xyz', [
 *   { index: 8552, imageUrl: 'https://example.com/signature.png', width: 256, height: 108 },
 *   { index: 1200, imageUrl: 'https://example.com/logo.png', width: 200 }
 * ]);
 */
const insertImagesWithBreaker = createCircuitBreaker(insertImagesInternal, {
  timeout: 20000,
  name: 'google-docs-insert-images',
});

export const insertImages = withRateLimit(
  (documentId: string, images: ImageInsertion[]) =>
    insertImagesWithBreaker.fire(documentId, images),
  googleDocsRateLimiter
);

/**
 * Export document to PDF (internal)
 */
async function exportToPDFInternal(documentId: string): Promise<Buffer> {
  if (!driveClient) {
    throw new Error(
      'Google Docs client not initialized. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.'
    );
  }

  logger.info({ documentId }, 'Exporting document to PDF');

  const response = await driveClient.files.export(
    {
      fileId: documentId,
      mimeType: 'application/pdf',
    },
    { responseType: 'arraybuffer' }
  );

  const pdfBuffer = Buffer.from(response.data as ArrayBuffer);

  logger.info({ documentId, pdfSize: pdfBuffer.length }, 'Document exported to PDF');

  return pdfBuffer;
}

/**
 * Export document to PDF
 *
 * Export a Google Doc as a PDF file
 *
 * @param documentId - ID of the document
 * @returns PDF file as Buffer
 * @example
 * const pdfBuffer = await exportToPDF('1abc...xyz');
 * // Use pdfBuffer for email attachment, file upload, etc.
 */
const exportToPDFWithBreaker = createCircuitBreaker(exportToPDFInternal, {
  timeout: 30000,
  name: 'google-docs-export-to-pdf',
});

export const exportToPDF = withRateLimit(
  (documentId: string) => exportToPDFWithBreaker.fire(documentId),
  googleDocsRateLimiter
);

/**
 * Get document content (internal)
 */
async function getDocumentInternal(documentId: string): Promise<GoogleDocument> {
  if (!docsClient) {
    throw new Error(
      'Google Docs client not initialized. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.'
    );
  }

  logger.info({ documentId }, 'Fetching document');

  const response = await docsClient.documents.get({ documentId });

  // Get document link from Drive
  let documentLink = '';
  if (driveClient) {
    const driveResponse = await driveClient.files.get({
      fileId: documentId,
      fields: 'webViewLink',
    });
    documentLink = driveResponse.data.webViewLink!;
  }

  logger.info({ documentId }, 'Document fetched');

  return {
    id: documentId,
    title: response.data.title!,
    revisionId: response.data.revisionId!,
    documentLink,
  };
}

/**
 * Get document
 *
 * Get Google Doc metadata and information
 *
 * @param documentId - ID of the document
 * @returns Document metadata
 * @example
 * const doc = await getDocument('1abc...xyz');
 * console.log(doc.title, doc.documentLink);
 */
const getDocumentWithBreaker = createCircuitBreaker(getDocumentInternal, {
  timeout: 10000,
  name: 'google-docs-get-document',
});

export const getDocument = withRateLimit(
  (documentId: string) => getDocumentWithBreaker.fire(documentId),
  googleDocsRateLimiter
);
