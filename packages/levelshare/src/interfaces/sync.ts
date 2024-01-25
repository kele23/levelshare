import { Feed } from './db.js';

////////////////////////////////// OPTIONS

export type Range = {
    gt?: string;
    lt?: string;
    gte?: string;
    lte?: string;
};

////////////////////////////////// REQUEST
export type SyncRequest = {
    transaction: string;
    type: 'discovery' | 'feed' | 'pull' | 'offer' | 'push';
};

export type DiscoverySyncRequest = SyncRequest & {
    id: string;
};

export type FeedSyncRequest = SyncRequest & Range;

export type PullSyncRequest = SyncRequest & {
    keys: string[];
};

export type OfferSyncRequest = SyncRequest & {
    id: string;
    feed: [string, Feed][];
    startSeq?: string;
    endSeq: string;
};

export type PushSyncRequest = SyncRequest & {
    values: string[]; // base64 string
    keys: string[];
};

//////////////////////////////////// RESPONSE
export type SyncResponse = {
    transaction: string;
    ok: boolean;
    message?: string;
};

export type DiscoverySyncResponse = SyncResponse & {
    id: string; // id
    startSeq?: string;
    endSeq?: string;
};

export type FeedSyncResponse = SyncResponse & {
    feed: [string, Feed][];
};

export type OfferSyncResponse = SyncResponse & {
    keys: string[];
};

export type PullSyncResponse = SyncResponse & {
    values: string[];
};

export type PushSyncResponse = SyncResponse & {};
