import { z } from 'zod';
import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

/**
 * OneDrive Module
 *
 * Read, write, and manage files on Microsoft OneDrive
 * - List files and folders
 * - Upload files
 * - Download files
 * - Delete files
 * - Built-in resilience and rate limiting
 *
 * Perfect for:
 * - Document management
 * - File sharing workflows
 * - Backup automation
 * - Integration with Microsoft 365
 *
 * @example
 * const files = await listFiles({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   folderId: 'root',
 *   limit: 10
 * });
 *
 * @example
 * const file = await uploadFile({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   fileName: 'document.pdf',
 *   content: fileBuffer,
 *   folderId: 'root'
 * });
 */

// Rate limiter: Microsoft Graph API allows ~10 req/sec per user
const oneDriveRateLimiter = createRateLimiter({
  maxConcurrent: 10,
  minTime: 100, // 100ms between requests = 10/sec
  reservoir: 10,
  reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 1000,
  id: 'onedrive',
});

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export interface OneDriveFile {
  id: string;
  name: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  mimeType?: string;
  webUrl: string;
  downloadUrl?: string;
}

interface OneDriveApiItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  file?: { mimeType?: string };
  webUrl: string;
  '@microsoft.graph.downloadUrl'?: string;
}

// ============================================================================
// LIST FILES
// ============================================================================

const listFilesSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  folderId: z.string().optional().default('root'),
  limit: z.number().optional().default(100),
  searchQuery: z.string().optional(),
});

/**
 * List files from OneDrive (internal)
 */
async function listFilesInternal(
  input: z.infer<typeof listFilesSchema>
): Promise<OneDriveFile[]> {
  const validated = listFilesSchema.parse(input);
  const { accessToken, folderId, limit, searchQuery } = validated;

  logger.info(
    {
      folderId,
      limit,
      hasSearch: !!searchQuery,
    },
    'Listing OneDrive files'
  );

  let url = `${GRAPH_API_BASE}/me/drive/items/${folderId}/children`;
  if (searchQuery) {
    url = `${GRAPH_API_BASE}/me/drive/root/search(q='${encodeURIComponent(searchQuery)}')`;
  }

  const response = await fetch(`${url}?$top=${limit}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'OneDrive API error');
    throw new Error(`OneDrive API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as { value?: OneDriveApiItem[] };
  const files: OneDriveFile[] = (data.value || []).map((item) => ({
    id: item.id,
    name: item.name,
    size: item.size || 0,
    createdDateTime: item.createdDateTime,
    lastModifiedDateTime: item.lastModifiedDateTime,
    mimeType: item.file?.mimeType,
    webUrl: item.webUrl,
    downloadUrl: item['@microsoft.graph.downloadUrl'],
  }));

  logger.info({ fileCount: files.length }, 'OneDrive files listed');
  return files;
}

const listFilesWithBreaker = createCircuitBreaker(listFilesInternal, {
  timeout: 15000,
  name: 'onedrive-list-files',
});

/**
 * List files from OneDrive
 *
 * @example
 * const files = await listFiles({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   folderId: 'root',
 *   limit: 50
 * });
 */
export const listFiles = async (input: z.infer<typeof listFilesSchema>) => {
  return oneDriveRateLimiter.schedule(() => listFilesWithBreaker.fire(input));
};

// ============================================================================
// UPLOAD FILE
// ============================================================================

const uploadFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  content: z
    .instanceof(Buffer)
    .or(z.string())
    .transform((val) => (typeof val === 'string' ? Buffer.from(val) : val)),
  folderId: z.string().optional().default('root'),
  mimeType: z.string().optional().default('application/octet-stream'),
});

/**
 * Upload file to OneDrive (internal)
 */
async function uploadFileInternal(
  input: z.infer<typeof uploadFileSchema>
): Promise<OneDriveFile> {
  const validated = uploadFileSchema.parse(input);
  const { accessToken, fileName, content, folderId, mimeType } = validated;

  logger.info(
    {
      fileName,
      size: content.length,
      folderId,
    },
    'Uploading file to OneDrive'
  );

  // For files < 4MB, use simple upload
  // For larger files, use resumable upload (not implemented here)
  const url = `${GRAPH_API_BASE}/me/drive/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
    },
    body: content as unknown as BodyInit,
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'OneDrive upload error');
    throw new Error(`OneDrive upload error: ${response.status} ${error}`);
  }

  const data = await response.json();
  const file: OneDriveFile = {
    id: data.id,
    name: data.name,
    size: data.size || 0,
    createdDateTime: data.createdDateTime,
    lastModifiedDateTime: data.lastModifiedDateTime,
    mimeType: data.file?.mimeType,
    webUrl: data.webUrl,
    downloadUrl: data['@microsoft.graph.downloadUrl'],
  };

  logger.info({ fileId: file.id, fileName }, 'File uploaded to OneDrive');
  return file;
}

const uploadFileWithBreaker = createCircuitBreaker(uploadFileInternal, {
  timeout: 60000, // 60s for large files
  name: 'onedrive-upload-file',
});

/**
 * Upload file to OneDrive
 *
 * @example
 * const file = await uploadFile({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   fileName: 'report.pdf',
 *   content: fileBuffer,
 *   folderId: 'root'
 * });
 */
export const uploadFile = async (input: z.infer<typeof uploadFileSchema>) => {
  return oneDriveRateLimiter.schedule(() => uploadFileWithBreaker.fire(input));
};

// ============================================================================
// DELETE FILE
// ============================================================================

const deleteFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
});

/**
 * Delete file from OneDrive (internal)
 */
async function deleteFileInternal(
  input: z.infer<typeof deleteFileSchema>
): Promise<void> {
  const validated = deleteFileSchema.parse(input);
  const { accessToken, fileId } = validated;

  logger.info({ fileId }, 'Deleting file from OneDrive');

  const url = `${GRAPH_API_BASE}/me/drive/items/${fileId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'OneDrive delete error');
    throw new Error(`OneDrive delete error: ${response.status} ${error}`);
  }

  logger.info({ fileId }, 'File deleted from OneDrive');
}

const deleteFileWithBreaker = createCircuitBreaker(deleteFileInternal, {
  timeout: 10000,
  name: 'onedrive-delete-file',
});

/**
 * Delete file from OneDrive
 *
 * @example
 * await deleteFile({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   fileId: '01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K'
 * });
 */
export const deleteFile = async (input: z.infer<typeof deleteFileSchema>) => {
  return oneDriveRateLimiter.schedule(() => deleteFileWithBreaker.fire(input));
};

// ============================================================================
// GET FILE METADATA
// ============================================================================

const getFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
});

/**
 * Get file metadata from OneDrive (internal)
 */
async function getFileInternal(
  input: z.infer<typeof getFileSchema>
): Promise<OneDriveFile> {
  const validated = getFileSchema.parse(input);
  const { accessToken, fileId } = validated;

  logger.info({ fileId }, 'Fetching OneDrive file metadata');

  const url = `${GRAPH_API_BASE}/me/drive/items/${fileId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'OneDrive API error');
    throw new Error(`OneDrive API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  const file: OneDriveFile = {
    id: data.id,
    name: data.name,
    size: data.size || 0,
    createdDateTime: data.createdDateTime,
    lastModifiedDateTime: data.lastModifiedDateTime,
    mimeType: data.file?.mimeType,
    webUrl: data.webUrl,
    downloadUrl: data['@microsoft.graph.downloadUrl'],
  };

  logger.info({ fileId, fileName: file.name }, 'File metadata fetched');
  return file;
}

const getFileWithBreaker = createCircuitBreaker(getFileInternal, {
  timeout: 10000,
  name: 'onedrive-get-file',
});

/**
 * Get file metadata from OneDrive
 *
 * @example
 * const file = await getFile({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   fileId: '01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K'
 * });
 */
export const getFile = async (input: z.infer<typeof getFileSchema>) => {
  return oneDriveRateLimiter.schedule(() => getFileWithBreaker.fire(input));
};

// ============================================================================
// DOWNLOAD FILE
// ============================================================================

const downloadFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
});

/**
 * Download file content from OneDrive (internal)
 */
async function downloadFileInternal(
  input: z.infer<typeof downloadFileSchema>
): Promise<Buffer> {
  const validated = downloadFileSchema.parse(input);
  const { accessToken, fileId } = validated;

  logger.info({ fileId }, 'Downloading file from OneDrive');

  const url = `${GRAPH_API_BASE}/me/drive/items/${fileId}/content`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'OneDrive download error');
    throw new Error(`OneDrive download error: ${response.status} ${error}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  logger.info({ fileId, size: buffer.length }, 'File downloaded from OneDrive');
  return buffer;
}

const downloadFileWithBreaker = createCircuitBreaker(downloadFileInternal, {
  timeout: 60000, // 60s for large files
  name: 'onedrive-download-file',
});

/**
 * Download file content from OneDrive
 *
 * @example
 * const content = await downloadFile({
 *   accessToken: '{{credential.microsoft_onedrive}}',
 *   fileId: '01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K'
 * });
 */
export const downloadFile = async (input: z.infer<typeof downloadFileSchema>) => {
  return oneDriveRateLimiter.schedule(() => downloadFileWithBreaker.fire(input));
};
