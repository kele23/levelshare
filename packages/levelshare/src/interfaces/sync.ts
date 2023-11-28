import { Feed } from './db.js';

////////////////////////////////// REQUEST
export type SyncRequest = {
    transaction: string;
    type: 'discovery' | 'feed' | 'pull';
};

export type DiscoverySyncRequest = SyncRequest & {
    id: string;
};

export type FeedSyncRequest = SyncRequest & {
    gt?: string;
    lt?: string;
    gte?: string;
    lte?: string;
};

export type PullSyncRequest = SyncRequest & {
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

export type PullSyncResponse = SyncResponse & {
    values: any[];
};
