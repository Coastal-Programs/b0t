import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { z } from 'zod';

/**
 * Dropbox Module
 *
 * Native Dropbox integration using the HTTP API v2.
 * Provides file upload/download, folder management, and sharing.
 *
 * Auth: OAuth 2.0 access token (short-lived) or long-lived via refresh.
 *
 * @see https://www.dropbox.com/developers/documentation/http/documentation
 */

const DROPBOX_API = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_API = 'https://content.dropboxapi.com/2';

const dropboxRateLimiter = createRateLimiter({
  maxConcurrent: 5,
  minTime: 200,
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
  id: 'dropbox',
});

// --- Types ---

export interface DropboxFileMetadata {
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  is_downloadable?: boolean;
  client_modified?: string;
  server_modified?: string;
  rev?: string;
  content_hash?: string;
  '.tag': 'file' | 'folder' | 'deleted';
}

export interface DropboxListResult {
  entries: DropboxFileMetadata[];
  cursor: string;
  has_more: boolean;
}

export interface DropboxSharedLink {
  url: string;
  name: string;
  path_lower: string;
}

// --- Schemas ---

const authSchema = z.object({
  accessToken: z.string(),
});

const uploadFileSchema = authSchema.extend({
  path: z.string(),
  content: z.string(),
  mode: z.enum(['add', 'overwrite', 'update']).optional().default('overwrite'),
  autorename: z.boolean().optional().default(false),
  mute: z.boolean().optional().default(false),
});

const downloadFileSchema = authSchema.extend({
  path: z.string(),
});

const deleteSchema = authSchema.extend({
  path: z.string(),
});

const listFolderSchema = authSchema.extend({
  path: z.string().default(''),
  recursive: z.boolean().optional().default(false),
  limit: z.number().optional(),
});

const createFolderSchema = authSchema.extend({
  path: z.string(),
  autorename: z.boolean().optional().default(false),
});

const moveSchema = authSchema.extend({
  fromPath: z.string(),
  toPath: z.string(),
  autorename: z.boolean().optional().default(false),
});

const copySchema = authSchema.extend({
  fromPath: z.string(),
  toPath: z.string(),
  autorename: z.boolean().optional().default(false),
});

const createSharedLinkSchema = authSchema.extend({
  path: z.string(),
  settings: z
    .object({
      requested_visibility: z.enum(['public', 'team_only', 'password']).optional(),
      audience: z.enum(['public', 'team', 'no_one']).optional(),
    })
    .optional(),
});

const listSharedLinksSchema = authSchema.extend({
  path: z.string().optional(),
  cursor: z.string().optional(),
});

const searchSchema = authSchema.extend({
  query: z.string(),
  path: z.string().optional(),
  maxResults: z.number().optional().default(100),
});

const getMetadataSchema = authSchema.extend({
  path: z.string(),
});

// --- Helpers ---

function headers(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function dropboxRPC<T>(
  endpoint: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${DROPBOX_API}/${endpoint}`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dropbox API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// --- uploadFile ---

/**
 * Upload a file to Dropbox
 * @example
 * const result = await uploadFile({
 *   accessToken: 'sl.xxx',
 *   path: '/reports/q1-summary.txt',
 *   content: 'Q1 revenue increased 15%...',
 *   mode: 'overwrite'
 * });
 */
async function uploadFileInternal(
  input: z.infer<typeof uploadFileSchema>
): Promise<DropboxFileMetadata> {
  const validated = uploadFileSchema.parse(input);

  logger.info(
    { path: validated.path, mode: validated.mode, provider: 'dropbox' },
    'Dropbox uploadFile'
  );

  const response = await fetch(`${DROPBOX_CONTENT_API}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: validated.path,
        mode: validated.mode,
        autorename: validated.autorename,
        mute: validated.mute,
      }),
    },
    body: validated.content,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dropbox upload error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<DropboxFileMetadata>;
}

const uploadFileWithBreaker = createCircuitBreaker(uploadFileInternal, {
  timeout: 120000,
  name: 'dropbox-upload-file',
});

export async function uploadFile(
  input: z.infer<typeof uploadFileSchema>
): Promise<DropboxFileMetadata> {
  return (await withRateLimit(
    () => uploadFileWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxFileMetadata;
}

// --- downloadFile ---

/**
 * Download a file from Dropbox, returns content as text
 * @example
 * const result = await downloadFile({
 *   accessToken: 'sl.xxx',
 *   path: '/reports/q1-summary.txt'
 * });
 * // result.content — file text
 * // result.metadata — file metadata
 */
async function downloadFileInternal(
  input: z.infer<typeof downloadFileSchema>
): Promise<{ content: string; metadata: DropboxFileMetadata }> {
  const validated = downloadFileSchema.parse(input);

  logger.info({ path: validated.path, provider: 'dropbox' }, 'Dropbox downloadFile');

  const response = await fetch(`${DROPBOX_CONTENT_API}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: validated.path }),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dropbox download error (${response.status}): ${errorText}`);
  }

  const metadataHeader = response.headers.get('Dropbox-API-Result');
  const metadata: DropboxFileMetadata = metadataHeader
    ? JSON.parse(metadataHeader)
    : { id: '', name: '', path_lower: '', path_display: '', '.tag': 'file' as const };
  const content = await response.text();

  return { content, metadata };
}

const downloadFileWithBreaker = createCircuitBreaker(downloadFileInternal, {
  timeout: 120000,
  name: 'dropbox-download-file',
});

export async function downloadFile(
  input: z.infer<typeof downloadFileSchema>
): Promise<{ content: string; metadata: DropboxFileMetadata }> {
  return (await withRateLimit(
    () => downloadFileWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as { content: string; metadata: DropboxFileMetadata };
}

// --- deleteFile ---

/**
 * Delete a file or folder from Dropbox
 * @example
 * const result = await deleteFile({
 *   accessToken: 'sl.xxx',
 *   path: '/old-reports/draft.txt'
 * });
 */
async function deleteFileInternal(
  input: z.infer<typeof deleteSchema>
): Promise<DropboxFileMetadata> {
  const validated = deleteSchema.parse(input);

  logger.info({ path: validated.path, provider: 'dropbox' }, 'Dropbox deleteFile');

  return dropboxRPC<DropboxFileMetadata>('files/delete_v2', validated.accessToken, {
    path: validated.path,
  }).then((res) => (res as unknown as { metadata: DropboxFileMetadata }).metadata);
}

const deleteFileWithBreaker = createCircuitBreaker(deleteFileInternal, {
  timeout: 30000,
  name: 'dropbox-delete-file',
});

export async function deleteFile(
  input: z.infer<typeof deleteSchema>
): Promise<DropboxFileMetadata> {
  return (await withRateLimit(
    () => deleteFileWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxFileMetadata;
}

// --- listFolder ---

/**
 * List files and folders in a Dropbox directory
 * @example
 * const result = await listFolder({
 *   accessToken: 'sl.xxx',
 *   path: '/reports',
 *   recursive: false
 * });
 * // result.entries — array of file/folder metadata
 */
async function listFolderInternal(
  input: z.infer<typeof listFolderSchema>
): Promise<DropboxListResult> {
  const validated = listFolderSchema.parse(input);

  logger.info(
    { path: validated.path, recursive: validated.recursive, provider: 'dropbox' },
    'Dropbox listFolder'
  );

  const body: Record<string, unknown> = {
    path: validated.path,
    recursive: validated.recursive,
  };

  if (validated.limit) {
    body.limit = validated.limit;
  }

  return dropboxRPC<DropboxListResult>('files/list_folder', validated.accessToken, body);
}

const listFolderWithBreaker = createCircuitBreaker(listFolderInternal, {
  timeout: 30000,
  name: 'dropbox-list-folder',
});

export async function listFolder(
  input: z.infer<typeof listFolderSchema>
): Promise<DropboxListResult> {
  return (await withRateLimit(
    () => listFolderWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxListResult;
}

// --- createFolder ---

/**
 * Create a folder in Dropbox
 * @example
 * const result = await createFolder({
 *   accessToken: 'sl.xxx',
 *   path: '/reports/2026-q2'
 * });
 */
async function createFolderInternal(
  input: z.infer<typeof createFolderSchema>
): Promise<DropboxFileMetadata> {
  const validated = createFolderSchema.parse(input);

  logger.info({ path: validated.path, provider: 'dropbox' }, 'Dropbox createFolder');

  return dropboxRPC<{ metadata: DropboxFileMetadata }>(
    'files/create_folder_v2',
    validated.accessToken,
    {
      path: validated.path,
      autorename: validated.autorename,
    }
  ).then((res) => res.metadata);
}

const createFolderWithBreaker = createCircuitBreaker(createFolderInternal, {
  timeout: 30000,
  name: 'dropbox-create-folder',
});

export async function createFolder(
  input: z.infer<typeof createFolderSchema>
): Promise<DropboxFileMetadata> {
  return (await withRateLimit(
    () => createFolderWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxFileMetadata;
}

// --- moveFile ---

/**
 * Move a file or folder in Dropbox
 * @example
 * const result = await moveFile({
 *   accessToken: 'sl.xxx',
 *   fromPath: '/inbox/report.pdf',
 *   toPath: '/archive/report.pdf'
 * });
 */
async function moveFileInternal(input: z.infer<typeof moveSchema>): Promise<DropboxFileMetadata> {
  const validated = moveSchema.parse(input);

  logger.info(
    { from: validated.fromPath, to: validated.toPath, provider: 'dropbox' },
    'Dropbox moveFile'
  );

  return dropboxRPC<{ metadata: DropboxFileMetadata }>('files/move_v2', validated.accessToken, {
    from_path: validated.fromPath,
    to_path: validated.toPath,
    autorename: validated.autorename,
  }).then((res) => res.metadata);
}

const moveFileWithBreaker = createCircuitBreaker(moveFileInternal, {
  timeout: 30000,
  name: 'dropbox-move-file',
});

export async function moveFile(input: z.infer<typeof moveSchema>): Promise<DropboxFileMetadata> {
  return (await withRateLimit(
    () => moveFileWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxFileMetadata;
}

// --- copyFile ---

/**
 * Copy a file or folder in Dropbox
 * @example
 * const result = await copyFile({
 *   accessToken: 'sl.xxx',
 *   fromPath: '/templates/invoice.docx',
 *   toPath: '/invoices/2026-03.docx'
 * });
 */
async function copyFileInternal(input: z.infer<typeof copySchema>): Promise<DropboxFileMetadata> {
  const validated = copySchema.parse(input);

  logger.info(
    { from: validated.fromPath, to: validated.toPath, provider: 'dropbox' },
    'Dropbox copyFile'
  );

  return dropboxRPC<{ metadata: DropboxFileMetadata }>('files/copy_v2', validated.accessToken, {
    from_path: validated.fromPath,
    to_path: validated.toPath,
    autorename: validated.autorename,
  }).then((res) => res.metadata);
}

const copyFileWithBreaker = createCircuitBreaker(copyFileInternal, {
  timeout: 30000,
  name: 'dropbox-copy-file',
});

export async function copyFile(input: z.infer<typeof copySchema>): Promise<DropboxFileMetadata> {
  return (await withRateLimit(
    () => copyFileWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxFileMetadata;
}

// --- createSharedLink ---

/**
 * Create a shared link for a Dropbox file or folder
 * @example
 * const result = await createSharedLink({
 *   accessToken: 'sl.xxx',
 *   path: '/reports/q1-summary.pdf'
 * });
 * // result.url — the shared link URL
 */
async function createSharedLinkInternal(
  input: z.infer<typeof createSharedLinkSchema>
): Promise<DropboxSharedLink> {
  const validated = createSharedLinkSchema.parse(input);

  logger.info({ path: validated.path, provider: 'dropbox' }, 'Dropbox createSharedLink');

  const body: Record<string, unknown> = { path: validated.path };
  if (validated.settings) {
    body.settings = validated.settings;
  }

  return dropboxRPC<DropboxSharedLink>(
    'sharing/create_shared_link_with_settings',
    validated.accessToken,
    body
  );
}

const createSharedLinkWithBreaker = createCircuitBreaker(createSharedLinkInternal, {
  timeout: 30000,
  name: 'dropbox-create-shared-link',
});

export async function createSharedLink(
  input: z.infer<typeof createSharedLinkSchema>
): Promise<DropboxSharedLink> {
  return (await withRateLimit(
    () => createSharedLinkWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxSharedLink;
}

// --- listSharedLinks ---

/**
 * List shared links for a file or all shared links
 * @example
 * const result = await listSharedLinks({
 *   accessToken: 'sl.xxx',
 *   path: '/reports/q1-summary.pdf'
 * });
 */
async function listSharedLinksInternal(
  input: z.infer<typeof listSharedLinksSchema>
): Promise<{ links: DropboxSharedLink[]; has_more: boolean; cursor?: string }> {
  const validated = listSharedLinksSchema.parse(input);

  logger.info({ path: validated.path, provider: 'dropbox' }, 'Dropbox listSharedLinks');

  const body: Record<string, unknown> = {};
  if (validated.path) body.path = validated.path;
  if (validated.cursor) body.cursor = validated.cursor;

  return dropboxRPC<{ links: DropboxSharedLink[]; has_more: boolean; cursor?: string }>(
    'sharing/list_shared_links',
    validated.accessToken,
    body
  );
}

const listSharedLinksWithBreaker = createCircuitBreaker(listSharedLinksInternal, {
  timeout: 30000,
  name: 'dropbox-list-shared-links',
});

export async function listSharedLinks(
  input: z.infer<typeof listSharedLinksSchema>
): Promise<{ links: DropboxSharedLink[]; has_more: boolean; cursor?: string }> {
  return (await withRateLimit(
    () => listSharedLinksWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as { links: DropboxSharedLink[]; has_more: boolean; cursor?: string };
}

// --- search ---

/**
 * Search for files in Dropbox by name or content
 * @example
 * const result = await search({
 *   accessToken: 'sl.xxx',
 *   query: 'quarterly report',
 *   path: '/reports'
 * });
 */
async function searchInternal(
  input: z.infer<typeof searchSchema>
): Promise<{ matches: DropboxFileMetadata[]; has_more: boolean }> {
  const validated = searchSchema.parse(input);

  logger.info(
    { query: validated.query, path: validated.path, provider: 'dropbox' },
    'Dropbox search'
  );

  const body: Record<string, unknown> = {
    query: validated.query,
    options: {
      max_results: validated.maxResults,
      file_status: 'active',
    },
  };

  if (validated.path) {
    body.options = {
      ...(body.options as Record<string, unknown>),
      path: validated.path,
    };
  }

  const result = await dropboxRPC<{
    matches: { metadata: { metadata: DropboxFileMetadata } }[];
    has_more: boolean;
  }>('files/search_v2', validated.accessToken, body);

  return {
    matches: result.matches.map((m) => m.metadata.metadata),
    has_more: result.has_more,
  };
}

const searchWithBreaker = createCircuitBreaker(searchInternal, {
  timeout: 30000,
  name: 'dropbox-search',
});

export async function search(
  input: z.infer<typeof searchSchema>
): Promise<{ matches: DropboxFileMetadata[]; has_more: boolean }> {
  return (await withRateLimit(
    () => searchWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as { matches: DropboxFileMetadata[]; has_more: boolean };
}

// --- getMetadata ---

/**
 * Get metadata for a file or folder
 * @example
 * const result = await getMetadata({
 *   accessToken: 'sl.xxx',
 *   path: '/reports/q1-summary.pdf'
 * });
 */
async function getMetadataInternal(
  input: z.infer<typeof getMetadataSchema>
): Promise<DropboxFileMetadata> {
  const validated = getMetadataSchema.parse(input);

  logger.info({ path: validated.path, provider: 'dropbox' }, 'Dropbox getMetadata');

  return dropboxRPC<DropboxFileMetadata>('files/get_metadata', validated.accessToken, {
    path: validated.path,
  });
}

const getMetadataWithBreaker = createCircuitBreaker(getMetadataInternal, {
  timeout: 30000,
  name: 'dropbox-get-metadata',
});

export async function getMetadata(
  input: z.infer<typeof getMetadataSchema>
): Promise<DropboxFileMetadata> {
  return (await withRateLimit(
    () => getMetadataWithBreaker.fire(input),
    dropboxRateLimiter
  )()) as unknown as DropboxFileMetadata;
}
