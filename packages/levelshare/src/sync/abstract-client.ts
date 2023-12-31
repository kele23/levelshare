import UUID from 'pure-uuid';
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
    Range,
    SyncOptions,
} from '../interfaces/sync.js';
import { ShareLevel } from '../level/share-level.js';
import { logger } from '../utils/logger.js';
import { msgDecode, msgEncode } from '../utils/msgpack.js';
import EventEmitter from 'events';

export abstract class AbstractSyncClient extends EventEmitter {
    protected _db: ShareLevel<any>;
    protected _syncing = false;
    protected _syncOptions: SyncOptions | null = null;
    protected _nextSync: any;

    constructor(db: ShareLevel<any>) {
        super();
        this._db = db;

        // events
        this._db.on('put', () => {
            this._changed();
        });
        this._db.on('del', () => {
            this._changed();
        });
        this._db.on('batch', () => {
            this._changed();
        });
        this._db.on('clear', () => {
            this._changed();
        });
    }

    protected abstract send(data: Uint8Array): Promise<Uint8Array>;

    protected _changed() {
        if (!this._syncOptions?.continuous) return;
        if (this._syncOptions.type != 'change') return;

        // not run if syncing
        if (this.syncing) {
            return;
        }

        // stop timeout
        if (this._nextSync) {
            clearTimeout(this._nextSync);
        }

        // run timeout
        this._nextSync = setTimeout(() => {
            this._doSync();
        }, 2000);
    }

    async sync(options: SyncOptions) {
        if (this._syncOptions) {
            throw 'A running sync task is configured; please stop it before syncing';
        }

        this._syncOptions = options;

        // if not continuos, than one shot now
        if (!options.continuous) {
            await this._doSync();
            this._syncOptions = null;
            return;
        }

        if (this._syncOptions.type != 'polling') return;

        const fn = async () => {
            await this._doSync();
            this._nextSync = setTimeout(fn, options.pollingTime || 30 * 1000);
        };
        this._nextSync = setTimeout(fn, options.pollingTime || 30 * 1000);
    }

    public get syncing() {
        return this._syncing;
    }

    public async stopSync() {
        if (this.syncing) {
            await new Promise<void>((resolve) => {
                this.once('sync-completed', () => {
                    resolve();
                });
            });
        }

        this._syncOptions = null;
        if (this._nextSync) clearTimeout(this._nextSync);
    }

    protected async _doSync() {
        this._syncing = true;
        this.emit('sync-start');
        const transaction = new UUID(4).format('std');
        await this.pull(transaction);
        await this.push(transaction);
        this._syncing = false;
        this.emit('sync-completed');
    }

    protected async pull(transaction: string) {
        const id = this._db.id;

        logger.debug('>>>>> ', 'PULL');

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest: DiscoverySyncRequest = {
            transaction,
            id,
            type: 'discovery',
        };

        logger.debug('>>>>> ', discoveryRequest);

        const discoveryResponse = msgDecode<DiscoverySyncResponse>(await this.send(msgEncode(discoveryRequest)));
        if (!discoveryResponse.ok) {
            throw 'Cannot discovery due to an error: ' + discoveryResponse.message;
        }

        logger.debug('<<<<< ', discoveryResponse);

        const startSeq = discoveryResponse.startSeq;
        const endSeq = discoveryResponse.endSeq;

        // exit if nothing to sync
        if (!endSeq) {
            return;
        }

        /////////////////////////////////////////////////////////// FEED
        const feedRequest: FeedSyncRequest = {
            transaction,
            lte: endSeq,
            type: 'feed',
        };
        if (startSeq) {
            feedRequest['gt'] = startSeq;
        }

        logger.debug('>>>>> ', feedRequest);

        const feedResponse = msgDecode<FeedSyncResponse>(await this.send(msgEncode(feedRequest)));
        if (!feedResponse.ok) {
            throw 'Cannot get feeed due to an error: ' + feedResponse.message;
        }

        logger.debug('<<<<< ', feedResponse);

        /////////////////////////////////////////////////////////// BATCH
        const toPull = await this._db.importFeed({
            transaction,
            feed: feedResponse.feed,
            startSeq: startSeq,
            endSeq: endSeq,
            otherId: discoveryResponse.id,
        });

        // /////////////////////////////////////////////////////////// FETCH
        const dataLevel = this._db.data;

        const pullRequest: PullSyncRequest = {
            transaction,
            keys: toPull,
            type: 'pull',
        };

        logger.debug('>>>>> ', pullRequest);

        const pullResponse = msgDecode<PullSyncResponse>(await this.send(msgEncode(pullRequest)));
        if (!pullResponse.ok) {
            throw 'Cannot get pull due to an error: ' + pullResponse.message;
        }

        logger.debug('<<<<< ', pullResponse);

        for (let i = 0; i < toPull.length; i++) {
            const key = toPull[i];
            const value = pullResponse.values[i];
            await dataLevel.put(key, value, { valueEncoding: 'buffer' });
        }
    }

    protected async push(transaction: string) {
        const id = this._db.id;

        logger.debug('>>>>> ', 'PUSH');

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest: DiscoverySyncRequest = {
            transaction,
            id,
            type: 'discovery',
        };

        logger.debug('>>>>> ', discoveryRequest);

        const discoveryResponse = msgDecode<DiscoverySyncResponse>(await this.send(msgEncode(discoveryRequest)));
        if (!discoveryResponse.ok) {
            throw 'Cannot discovery due to an error: ' + discoveryResponse.message;
        }

        logger.debug('<<<<< ', discoveryResponse);

        /////////////////////////////////////////////////////////// OFFER
        const friendsLevel = this._db.friends;
        const feedLevel = this._db.feed;

        const friend = (await friendsLevel.getMany([discoveryResponse.id]))[0];
        let startSeq: string | undefined = undefined;
        if (friend) {
            startSeq = friend.seq;
        }

        let endSeq: string | undefined = undefined;
        for await (const key of feedLevel.keys({ reverse: true, limit: 1 })) {
            endSeq = key;
        }

        // exit if nothing to sync
        if (!endSeq) {
            return;
        }

        const search: Range = {
            lte: endSeq,
        };
        if (startSeq) {
            search['gt'] = startSeq;
        }

        const feed: [string, Feed][] = [];
        for await (const [key, value] of feedLevel.iterator({ ...search })) {
            feed.push([key, value]);
        }

        const offerRequest: OfferSyncRequest = {
            id,
            transaction,
            feed,
            startSeq,
            endSeq,
            type: 'offer',
        };

        logger.debug('>>>>> ', offerRequest);

        const offerResponse = msgDecode<OfferSyncResponse>(await this.send(msgEncode(offerRequest)));
        if (!offerResponse.ok) {
            throw 'Cannot get feeed due to an error: ' + offerResponse.message;
        }

        logger.debug('<<<<< ', offerResponse);

        /////////////////////////////////////////////////////////// PUSH
        const dataLevel = this._db.data;
        const values = await dataLevel.getMany<String, Uint8Array>(offerResponse.keys, { valueEncoding: 'buffer' });

        const pushRequest: PushSyncRequest = {
            transaction,
            values,
            keys: offerResponse.keys,
            type: 'push',
        };

        logger.debug('>>>>> ', pushRequest);

        const pushResponse = msgDecode<PushSyncResponse>(await this.send(msgEncode(pushRequest)));
        if (!pushResponse.ok) {
            throw 'Cannot get push due to an error: ' + pushResponse.message;
        }

        logger.debug('<<<<< ', pushResponse);
    }
}
