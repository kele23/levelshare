import { Feed } from '../interfaces/db.js';
import { ShareLevel } from '../level/share-level.js';
import { msgDecode, msgEncode } from '../utils/msgpack.js';
import {
    DiscoverySyncRequest,
    DiscoverySyncResponse,
    FeedSyncRequest,
    FeedSyncResponse,
    PullSyncRequest,
    PullSyncResponse,
    SyncRequest,
    SyncResponse,
} from '../interfaces/sync.js';

export abstract class AbstractSyncServer {
    protected _db: ShareLevel<any>;

    constructor(db: ShareLevel<any>) {
        this._db = db;
    }

    public async receive(data: Uint8Array): Promise<Uint8Array> {
        const request = msgDecode<SyncRequest>(data);

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
                default: {
                    response = {
                        transaction: request.transaction,
                        ok: false,
                        message: 'Unknown type',
                    };
                }
            }
        } catch (e) {
            console.warn(e);
            response = {
                transaction: request.transaction,
                ok: false,
                message: 'Exception occurred',
            };
        }

        return new Promise((resolve) => {
            this._db.nextTick(() => resolve(msgEncode(response)));
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
        return { values, ok: true, transaction: request.transaction };
    }
}
