import { Feed } from '../interfaces/db.js';
import {
    DiscoverySyncRequest,
    DiscoverySyncResponse,
    FeedSyncRequest,
    FeedSyncResponse,
    OfferSyncRequest,
    OfferSyncResponse,
    PullSyncRequest,
    PullSyncResponse,
    PushSyncRequest,
    PushSyncResponse,
    SyncRequest,
    SyncResponse,
} from '../interfaces/sync.js';
import { ShareLevel } from '../level/share-level.js';
import { base64ToBytes, bytesToBase64 } from '../utils/base64.js';
import { logger } from '../utils/logger.js';

export class SyncServer {
    protected _db: ShareLevel<any>;

    constructor(db: ShareLevel<any>) {
        this._db = db;
    }

    public async receive(request: SyncRequest): Promise<SyncResponse> {
        let response: SyncResponse;
        try {
            switch (request.type) {
                case 'discovery': {
                    response = await this._discoveryReceive(request as DiscoverySyncRequest);
                    break;
                }
                case 'feed': {
                    response = await this._feedReceive(request as FeedSyncRequest);
                    break;
                }
                case 'pull': {
                    response = await this._pullReceive(request as PullSyncRequest);
                    break;
                }
                case 'offer': {
                    response = await this._offerReceive(request as OfferSyncRequest);
                    break;
                }
                case 'push': {
                    response = await this._pushReceive(request as PushSyncRequest);
                    break;
                }
                default: {
                    response = {
                        transaction: request.transaction,
                        ok: false,
                        message: 'Unknown type',
                    };
                }
            }
        } catch (e) {
            let message = 'Exception occurred';
            if (e instanceof Error) message = e.message;

            logger.warn('Exception occurred', e);
            response = {
                transaction: request.transaction,
                ok: false,
                message,
            };
        }

        return new Promise((resolve) => {
            this._db.nextTick(() => resolve(response));
        });
    }

    protected async _discoveryReceive(request: DiscoverySyncRequest): Promise<DiscoverySyncResponse> {
        const friendsLevel = this._db.friends;
        const id = this._db.id;
        const feedLevel = this._db.feed;

        const friend = (await friendsLevel.getMany([request.id]))[0];
        let startSeq: string | undefined = undefined;
        if (friend) {
            startSeq = friend.seq;
        }

        let endSeq: string | undefined = undefined;
        for await (const key of feedLevel.keys({ reverse: true, limit: 1 })) {
            endSeq = key;
        }

        return {
            ok: true,
            transaction: request.transaction,
            id,
            startSeq,
            endSeq,
        };
    }

    protected async _feedReceive(request: FeedSyncRequest): Promise<FeedSyncResponse> {
        const feedLevel = this._db.feed;

        const feed: [string, Feed][] = [];
        for await (const [key, value] of feedLevel.iterator({ ...request })) {
            feed.push([key, value]);
        }

        return { feed, ok: true, transaction: request.transaction };
    }

    protected async _pullReceive(request: PullSyncRequest): Promise<PullSyncResponse> {
        const dataLevel = this._db.data;
        const values = await dataLevel.getMany<String, Uint8Array>(request.keys, { valueEncoding: 'buffer' });
        const base64Values = values.map((item) => bytesToBase64(item));
        return { values: base64Values, ok: true, transaction: request.transaction };
    }

    protected async _offerReceive(request: OfferSyncRequest): Promise<OfferSyncResponse> {
        const keys = await this._db.importFeed({
            feed: request.feed,
            startSeq: request.startSeq,
            endSeq: request.endSeq,
            otherId: request.id,
            direction: 'push',
        });

        return { keys, ok: true, transaction: request.transaction };
    }

    protected async _pushReceive(request: PushSyncRequest): Promise<PushSyncResponse> {
        const dataLevel = this._db.data;
        const keys = request.keys;
        const values = request.values;
        for (let i = 0; i < values.length; i++) {
            const key = keys[i];
            const value = values[i];
            const base64Value = base64ToBytes(value);
            await dataLevel.put(key, base64Value, { valueEncoding: 'buffer' });
        }

        return { ok: true, transaction: request.transaction };
    }
}
