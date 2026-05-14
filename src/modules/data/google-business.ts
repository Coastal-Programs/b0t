import { getValidOAuthToken } from '@/lib/oauth-token-manager';
import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

/**
 * Google Business Profile Module
 *
 * Manage Google Business Profile listings, reviews, and media.
 * - List accounts and locations
 * - Get and update business info
 * - Fetch and reply to reviews
 * - Upload media (photos/videos)
 *
 * Required OAuth Scope:
 * - https://www.googleapis.com/auth/business.manage
 *
 * Authentication:
 * - Uses Google OAuth token via getValidOAuthToken
 * - Automatic token refresh via oauth-token-manager
 */

const GBP_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const GBP_ACCOUNT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';

// Rate limiter: Google APIs allow ~10 req/sec per user
const gbpRateLimiter = createRateLimiter({
  maxConcurrent: 5,
  minTime: 200,
  reservoir: 10,
  reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 1000,
  id: 'google-business',
});

// --- Types ---

export interface GbpAccount {
  name: string;
  accountName: string;
  type: string;
  role: string;
  state: { status: string };
}

export interface GbpLocation {
  name: string;
  title: string;
  storeCode?: string;
  phoneNumbers?: { primaryPhone?: string };
  websiteUri?: string;
  storefrontAddress?: {
    addressLines: string[];
    locality: string;
    administrativeArea: string;
    postalCode: string;
    regionCode: string;
  };
  categories?: {
    primaryCategory?: { displayName: string };
    additionalCategories?: Array<{ displayName: string }>;
  };
  regularHours?: {
    periods: Array<{
      openDay: string;
      openTime: { hours: number; minutes?: number };
      closeDay: string;
      closeTime: { hours: number; minutes?: number };
    }>;
  };
  metadata?: {
    mapsUri?: string;
    newReviewUri?: string;
  };
}

export interface GbpReview {
  name: string;
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl?: string };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
}

export interface GbpMediaItem {
  name: string;
  mediaFormat: string;
  locationAssociation?: { category: string };
  googleUrl?: string;
  thumbnailUrl?: string;
  createTime: string;
  dimensions?: { widthPixels: number; heightPixels: number };
}

// --- Helpers ---

async function getAccessToken(userId: string, accessToken?: string): Promise<string> {
  const token = accessToken || (await getValidOAuthToken(userId, 'google'));
  if (!token) {
    throw new Error('Google OAuth token not found. Connect Google Business Profile in Settings.');
  }
  return token;
}

async function gbpFetch<T>(url: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, url, error: errorText }, 'Google Business API error');
    throw new Error(`Google Business API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// --- Functions ---

/**
 * List all Google Business Profile accounts
 * @example
 * const accounts = await listAccounts({ userId: 'user-123' });
 */
async function listAccountsInternal(input: {
  userId: string;
  accessToken?: string;
}): Promise<GbpAccount[]> {
  const token = await getAccessToken(input.userId, input.accessToken);
  logger.info({ userId: input.userId }, 'Listing Google Business Profile accounts');

  const data = await gbpFetch<{ accounts?: GbpAccount[] }>(`${GBP_ACCOUNT_API}/accounts`, token);

  return data.accounts || [];
}

/**
 * List locations for a Google Business Profile account
 * @example
 * const locations = await listLocations({ userId: 'user-123', accountId: 'accounts/123' });
 */
async function listLocationsInternal(input: {
  userId: string;
  accountId: string;
  pageSize?: number;
  accessToken?: string;
}): Promise<GbpLocation[]> {
  const token = await getAccessToken(input.userId, input.accessToken);
  const pageSize = input.pageSize || 100;

  logger.info({ userId: input.userId, accountId: input.accountId }, 'Listing GBP locations');

  const data = await gbpFetch<{ locations?: GbpLocation[] }>(
    `${GBP_API_BASE}/${input.accountId}/locations?readMask=name,title,storeCode,phoneNumbers,websiteUri,storefrontAddress,categories,regularHours,metadata&pageSize=${pageSize}`,
    token
  );

  return data.locations || [];
}

/**
 * Get a single location's details
 * @example
 * const location = await getLocation({ userId: 'user-123', locationName: 'locations/456' });
 */
async function getLocationInternal(input: {
  userId: string;
  locationName: string;
  accessToken?: string;
}): Promise<GbpLocation> {
  const token = await getAccessToken(input.userId, input.accessToken);

  logger.info({ locationName: input.locationName }, 'Fetching GBP location details');

  return gbpFetch<GbpLocation>(
    `${GBP_API_BASE}/${input.locationName}?readMask=name,title,storeCode,phoneNumbers,websiteUri,storefrontAddress,categories,regularHours,metadata`,
    token
  );
}

/**
 * Update a location's business information
 * @example
 * const updated = await updateLocation({
 *   userId: 'user-123',
 *   locationName: 'locations/456',
 *   updateMask: 'title,phoneNumbers.primaryPhone',
 *   location: { title: 'New Name', phoneNumbers: { primaryPhone: '+1234567890' } }
 * });
 */
async function updateLocationInternal(input: {
  userId: string;
  locationName: string;
  updateMask: string;
  location: Partial<GbpLocation>;
  accessToken?: string;
}): Promise<GbpLocation> {
  const token = await getAccessToken(input.userId, input.accessToken);

  logger.info(
    { locationName: input.locationName, updateMask: input.updateMask },
    'Updating GBP location'
  );

  return gbpFetch<GbpLocation>(
    `${GBP_API_BASE}/${input.locationName}?updateMask=${input.updateMask}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify(input.location),
    }
  );
}

/**
 * List reviews for a location
 * @example
 * const reviews = await listReviews({ userId: 'user-123', locationName: 'accounts/123/locations/456' });
 */
async function listReviewsInternal(input: {
  userId: string;
  locationName: string;
  pageSize?: number;
  orderBy?: 'rating' | 'updateTime';
  accessToken?: string;
}): Promise<{ reviews: GbpReview[]; averageRating?: number; totalReviewCount?: number }> {
  const token = await getAccessToken(input.userId, input.accessToken);
  const pageSize = input.pageSize || 50;
  const orderBy = input.orderBy || 'updateTime';

  logger.info({ locationName: input.locationName, pageSize }, 'Fetching GBP reviews');

  const data = await gbpFetch<{
    reviews?: GbpReview[];
    averageRating?: number;
    totalReviewCount?: number;
  }>(
    `https://mybusiness.googleapis.com/v4/${input.locationName}/reviews?pageSize=${pageSize}&orderBy=${orderBy}`,
    token
  );

  return {
    reviews: data.reviews || [],
    averageRating: data.averageRating,
    totalReviewCount: data.totalReviewCount,
  };
}

/**
 * Reply to a review
 * @example
 * const reply = await replyToReview({
 *   userId: 'user-123',
 *   reviewName: 'accounts/123/locations/456/reviews/789',
 *   comment: 'Thank you for your feedback!'
 * });
 */
async function replyToReviewInternal(input: {
  userId: string;
  reviewName: string;
  comment: string;
  accessToken?: string;
}): Promise<{ comment: string; updateTime: string }> {
  const token = await getAccessToken(input.userId, input.accessToken);

  logger.info({ reviewName: input.reviewName }, 'Replying to GBP review');

  return gbpFetch<{ comment: string; updateTime: string }>(
    `https://mybusiness.googleapis.com/v4/${input.reviewName}/reply`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ comment: input.comment }),
    }
  );
}

/**
 * Delete a review reply
 * @example
 * await deleteReviewReply({ userId: 'user-123', reviewName: 'accounts/123/locations/456/reviews/789' });
 */
async function deleteReviewReplyInternal(input: {
  userId: string;
  reviewName: string;
  accessToken?: string;
}): Promise<void> {
  const token = await getAccessToken(input.userId, input.accessToken);

  logger.info({ reviewName: input.reviewName }, 'Deleting GBP review reply');

  await gbpFetch<Record<string, never>>(
    `https://mybusiness.googleapis.com/v4/${input.reviewName}/reply`,
    token,
    { method: 'DELETE' }
  );
}

/**
 * List media items for a location
 * @example
 * const media = await listMedia({ userId: 'user-123', locationName: 'accounts/123/locations/456' });
 */
async function listMediaInternal(input: {
  userId: string;
  locationName: string;
  pageSize?: number;
  accessToken?: string;
}): Promise<GbpMediaItem[]> {
  const token = await getAccessToken(input.userId, input.accessToken);
  const pageSize = input.pageSize || 50;

  logger.info({ locationName: input.locationName }, 'Listing GBP media');

  const data = await gbpFetch<{ mediaItems?: GbpMediaItem[] }>(
    `https://mybusiness.googleapis.com/v4/${input.locationName}/media?pageSize=${pageSize}`,
    token
  );

  return data.mediaItems || [];
}

/**
 * Upload a photo to a location
 * @example
 * const media = await uploadMedia({
 *   userId: 'user-123',
 *   locationName: 'accounts/123/locations/456',
 *   mediaFormat: 'PHOTO',
 *   sourceUrl: 'https://example.com/photo.jpg',
 *   category: 'EXTERIOR'
 * });
 */
async function uploadMediaInternal(input: {
  userId: string;
  locationName: string;
  mediaFormat: 'PHOTO' | 'VIDEO';
  sourceUrl: string;
  category?:
    | 'COVER'
    | 'PROFILE'
    | 'EXTERIOR'
    | 'INTERIOR'
    | 'PRODUCT'
    | 'AT_WORK'
    | 'FOOD_AND_DRINK'
    | 'MENU'
    | 'COMMON_AREA'
    | 'ROOMS'
    | 'TEAMS'
    | 'ADDITIONAL';
  accessToken?: string;
}): Promise<GbpMediaItem> {
  const token = await getAccessToken(input.userId, input.accessToken);

  logger.info(
    { locationName: input.locationName, category: input.category },
    'Uploading GBP media'
  );

  return gbpFetch<GbpMediaItem>(
    `https://mybusiness.googleapis.com/v4/${input.locationName}/media`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        mediaFormat: input.mediaFormat,
        sourceUrl: input.sourceUrl,
        locationAssociation: input.category ? { category: input.category } : undefined,
      }),
    }
  );
}

/**
 * Delete a media item
 * @example
 * await deleteMedia({ userId: 'user-123', mediaName: 'accounts/123/locations/456/media/789' });
 */
async function deleteMediaInternal(input: {
  userId: string;
  mediaName: string;
  accessToken?: string;
}): Promise<void> {
  const token = await getAccessToken(input.userId, input.accessToken);

  logger.info({ mediaName: input.mediaName }, 'Deleting GBP media');

  await gbpFetch<Record<string, never>>(
    `https://mybusiness.googleapis.com/v4/${input.mediaName}`,
    token,
    { method: 'DELETE' }
  );
}

// --- Circuit breakers + rate limiting ---

const listAccountsBreaker = createCircuitBreaker(listAccountsInternal, {
  timeout: 15000,
  name: 'gbp-list-accounts',
});
const listLocationsBreaker = createCircuitBreaker(listLocationsInternal, {
  timeout: 15000,
  name: 'gbp-list-locations',
});
const getLocationBreaker = createCircuitBreaker(getLocationInternal, {
  timeout: 10000,
  name: 'gbp-get-location',
});
const updateLocationBreaker = createCircuitBreaker(updateLocationInternal, {
  timeout: 10000,
  name: 'gbp-update-location',
});
const listReviewsBreaker = createCircuitBreaker(listReviewsInternal, {
  timeout: 15000,
  name: 'gbp-list-reviews',
});
const replyToReviewBreaker = createCircuitBreaker(replyToReviewInternal, {
  timeout: 10000,
  name: 'gbp-reply-review',
});
const deleteReviewReplyBreaker = createCircuitBreaker(deleteReviewReplyInternal, {
  timeout: 10000,
  name: 'gbp-delete-reply',
});
const listMediaBreaker = createCircuitBreaker(listMediaInternal, {
  timeout: 15000,
  name: 'gbp-list-media',
});
const uploadMediaBreaker = createCircuitBreaker(uploadMediaInternal, {
  timeout: 30000,
  name: 'gbp-upload-media',
});
const deleteMediaBreaker = createCircuitBreaker(deleteMediaInternal, {
  timeout: 10000,
  name: 'gbp-delete-media',
});

export const gbpListAccounts = withRateLimit(
  (input: Parameters<typeof listAccountsInternal>[0]) => listAccountsBreaker.fire(input),
  gbpRateLimiter
);

export const gbpListLocations = withRateLimit(
  (input: Parameters<typeof listLocationsInternal>[0]) => listLocationsBreaker.fire(input),
  gbpRateLimiter
);

export const gbpGetLocation = withRateLimit(
  (input: Parameters<typeof getLocationInternal>[0]) => getLocationBreaker.fire(input),
  gbpRateLimiter
);

export const gbpUpdateLocation = withRateLimit(
  (input: Parameters<typeof updateLocationInternal>[0]) => updateLocationBreaker.fire(input),
  gbpRateLimiter
);

export const gbpListReviews = withRateLimit(
  (input: Parameters<typeof listReviewsInternal>[0]) => listReviewsBreaker.fire(input),
  gbpRateLimiter
);

export const gbpReplyToReview = withRateLimit(
  (input: Parameters<typeof replyToReviewInternal>[0]) => replyToReviewBreaker.fire(input),
  gbpRateLimiter
);

export const gbpDeleteReviewReply = withRateLimit(
  (input: Parameters<typeof deleteReviewReplyInternal>[0]) => deleteReviewReplyBreaker.fire(input),
  gbpRateLimiter
);

export const gbpListMedia = withRateLimit(
  (input: Parameters<typeof listMediaInternal>[0]) => listMediaBreaker.fire(input),
  gbpRateLimiter
);

export const gbpUploadMedia = withRateLimit(
  (input: Parameters<typeof uploadMediaInternal>[0]) => uploadMediaBreaker.fire(input),
  gbpRateLimiter
);

export const gbpDeleteMedia = withRateLimit(
  (input: Parameters<typeof deleteMediaInternal>[0]) => deleteMediaBreaker.fire(input),
  gbpRateLimiter
);
