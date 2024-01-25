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
    SyncRequest,
    SyncResponse,
} from '../interfaces/sync.js';
import { ShareLevel } from '../level/share-level.js';
import { base64ToBytes, bytesToBase64 } from '../utils/base64.js';
import { logger } from '../utils/logger.js';

export class SyncClient {
    protected _db: ShareLevel<any>;
    protected _syncing = false;
    protected _nextSync: any;
    protected _transporter?: (data: SyncRequest) => Promise<SyncResponse>;

    constructor(db: ShareLevel<any>) {
        this._db = db;
    }

    public setTransporter(fn: (data: SyncRequest) => Promise<SyncResponse>) {
        this._transporter = fn;
    }

    public async sync() {
        if (this._syncing) throw new Error('Sync in progress... retry later');
        try {
            this._syncing = true;
            const transaction = new UUID(4).format('std');
            await this._pull(transaction);
            await this._push(transaction);
        } finally {
            this._syncing = false; // remember to stop syncing also on errors
        }
    }

    protected async _send(data: SyncRequest): Promise<SyncResponse> {
        if (this._transporter) return await this._transporter(data);
        throw new Error('Missing transporter');
    }

    protected async _pull(transaction: string) {
        const id = this._db.id;

        logger.debug('>>>>> ', 'PULL');

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest: DiscoverySyncRequest = {
            transaction,
            id,
            type: 'discovery',
        };

        logger.debug('>>>>> ', discoveryRequest);

        const discoveryResponse = await this._send(discoveryRequest) as DiscoverySyncResponse;
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

        const feedResponse = await this._send(feedRequest) as FeedSyncResponse;
        if (!feedResponse.ok) {
            throw 'Cannot get feeed due to an error: ' + feedResponse.message;
        }

        logger.debug('<<<<< ', feedResponse);

        /////////////////////////////////////////////////////////// BATCH
        const toPull = await this._db.importFeed({
            feed: feedResponse.feed,
            startSeq: startSeq,
            endSeq: endSeq,
            otherId: discoveryResponse.id,
            direction: 'pull',
        });

        // /////////////////////////////////////////////////////////// FETCH
        const dataLevel = this._db.data;

        const pullRequest: PullSyncRequest = {
            transaction,
            keys: toPull,
            type: 'pull',
        };

        logger.debug('>>>>> ', pullRequest);

        const pullResponse = await this._send(pullRequest) as PullSyncResponse;
        if (!pullResponse.ok) {
            throw 'Cannot get pull due to an error: ' + pullResponse.message;
        }

        logger.debug('<<<<< ', pullResponse);

        for (let i = 0; i < toPull.length; i++) {
            const key = toPull[i];
            const value = pullResponse.values[i];
            const base64Value = base64ToBytes(value);
            await dataLevel.put(key, base64Value, { valueEncoding: 'buffer' });
        }
    }

    protected async _push(transaction: string) {
        const id = this._db.id;

        logger.debug('>>>>> ', 'PUSH');

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest: DiscoverySyncRequest = {
            transaction,
            id,
            type: 'discovery',
        };

        logger.debug('>>>>> ', discoveryRequest);

        const discoveryResponse = await this._send(discoveryRequest) as DiscoverySyncResponse;
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

        const offerResponse = await this._send(offerRequest) as OfferSyncResponse;
        if (!offerResponse.ok) {
            throw 'Cannot get feeed due to an error: ' + offerResponse.message;
        }

        logger.debug('<<<<< ', offerResponse);

        /////////////////////////////////////////////////////////// PUSH
        const dataLevel = this._db.data;
        const values = await dataLevel.getMany<String, Uint8Array>(offerResponse.keys, { valueEncoding: 'buffer' });

        const pushRequest: PushSyncRequest = {
            transaction,
            values: values.map((item) => bytesToBase64(item)),
            keys: offerResponse.keys,
            type: 'push',
        };

        logger.debug('>>>>> ', pushRequest);

        const pushResponse = await this._send(pushRequest) as PushSyncResponse;
        if (!pushResponse.ok) {
            throw 'Cannot get push due to an error: ' + pushResponse.message;
        }

        logger.debug('<<<<< ', pushResponse);
    }
}
