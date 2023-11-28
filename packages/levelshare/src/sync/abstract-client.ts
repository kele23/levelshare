import UUID from 'pure-uuid';
import { ShareLevel } from '../index.js';
import { Friend } from '../interfaces/db.js';
import { base64Encode } from '../utils/base64.js';
import { msgDecode, msgEncode } from '../utils/msgpack.js';
import {
    DiscoverySyncRequest,
    DiscoverySyncResponse,
    FeedSyncRequest,
    FeedSyncResponse,
    PullSyncRequest,
    PullSyncResponse,
} from '../interfaces/sync.js';

export type SyncOptions = {
    continuous: boolean;
    iterval: number;
};

export abstract class AbstractSyncClient {
    protected _db: ShareLevel<any>;
    protected _syncing = false;

    constructor(db: ShareLevel<any>) {
        this._db = db;
    }

    protected abstract send(data: Uint8Array): Promise<Uint8Array>;

    async sync(_options?: SyncOptions) {
        if (this._syncing) {
            throw 'Another sync process is in progress';
        }

        this._syncing = true;
        const transaction = new UUID(4).format('std');
        const id = this._db.id;

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest: DiscoverySyncRequest = {
            transaction,
            id,
            type: 'discovery',
        };

        console.debug('>>>>> ', discoveryRequest);

        const discoveryResponse = msgDecode<DiscoverySyncResponse>(await this.send(msgEncode(discoveryRequest)));
        if (!discoveryResponse.ok) {
            throw 'Cannot discovery due to an error: ' + discoveryResponse.message;
        }

        console.debug('<<<<< ', discoveryResponse);

        const startSeq = discoveryResponse.startSeq;
        const endSeq = discoveryResponse.endSeq;

        /////////////////////////////////////////////////////////// FEED
        const feedRequest: FeedSyncRequest = {
            transaction,
            lte: endSeq,
            type: 'feed',
        };
        if (startSeq) {
            feedRequest['gt'] = startSeq;
        }

        console.debug('>>>>> ', feedRequest);

        const feedResponse = msgDecode<FeedSyncResponse>(await this.send(msgEncode(feedRequest)));
        if (!feedResponse.ok) {
            throw 'Cannot get feeed due to an error: ' + feedResponse.message;
        }

        console.debug('<<<<< ', feedResponse);

        /////////////////////////////////////////////////////////// BATCH
        const friendsLevel = this._db.friends;
        const dataLevel = this._db.data;
        const feedLevel = this._db.feed;
        const indexLevel = this._db.index;
        const realDb = this._db.realdb;

        // 1 - add friend
        let batch = realDb.batch();
        const friendItem: Friend = { seq: discoveryResponse.endSeq!, lastSeen: new Date() };
        batch = batch.put(discoveryResponse.id, friendItem, { sublevel: friendsLevel });
        const modKeys = feedResponse.feed.map((item) => item[1].key);
        const toFix = new Map<string, string>();

        // 2 - move current feed up
        const fUpOpt: any = { lte: endSeq };
        if (startSeq) {
            fUpOpt['gt'] = startSeq;
        }
        for await (const [_, value] of feedLevel.iterator(fUpOpt)) {
            const seq = this._db.getIncrementSequence();
            const feed = value;
            const oldKey = feed.key;
            if (modKeys.includes(oldKey)) {
                feed.key = oldKey + '_' + transaction;
                toFix.set(oldKey, feed.key);
            }
            batch.put(seq, feed, { sublevel: feedLevel });
        }

        // 3 - fix conflicts data if presents
        for (const [oldKey, newKey] of toFix.entries()) {
            for await (const [dataKey, dataValue] of dataLevel.iterator({ gte: oldKey + '#', lte: oldKey + '~' })) {
                const dataNewKey = dataKey.replace(oldKey, newKey);
                batch.del(dataKey, { sublevel: dataLevel });
                batch.put(dataNewKey, dataValue, { sublevel: dataLevel });
            }
        }

        // iterate over feed result and
        const toPullS: Set<string> = new Set();
        for (const [key, value] of feedResponse.feed) {
            // 4 - add feed
            batch = batch.put(key, value, { sublevel: feedLevel });

            // 5 - add data with placeholder value
            const strKey = typeof value.key == 'string' ? value.key : base64Encode(value.key);
            const dataKey = `${strKey}#${value.seq}`;
            const dataValue = value.type ? `__${discoveryResponse.id}__` : '__del__';
            batch = batch.put(dataKey, dataValue, { sublevel: dataLevel, valueEncoding: 'utf8' });

            // 6 - add index  &  7 - add to download
            if (value.type == 'put') {
                batch = batch.put(value.key, dataKey, { sublevel: indexLevel });
                toPullS.add(dataKey);
            } else {
                batch = batch.del(value.key, { sublevel: indexLevel });
                toPullS.delete(dataKey);
            }
        }

        batch.write();

        const toPull = Array.from(toPullS.values());

        // /////////////////////////////////////////////////////////// FETCH
        const pullRequest: PullSyncRequest = {
            transaction,
            keys: Array.from(toPull.values()),
            type: 'pull',
        };

        console.debug('>>>>> ', pullRequest);

        const pullResponse = msgDecode<PullSyncResponse>(await this.send(msgEncode(pullRequest)));
        if (!pullResponse.ok) {
            throw 'Cannot get pull due to an error: ' + pullResponse.message;
        }

        console.debug('<<<<< ', pullResponse);

        for (let i = 0; i < toPull.length; i++) {
            const key = toPull[i];
            const value = pullResponse.values[i];
            await dataLevel.put(key, value, { valueEncoding: 'buffer' });
        }
        this._syncing = false;
    }
}
