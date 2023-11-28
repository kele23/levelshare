import {
    AbstractBatchDelOperation,
    AbstractBatchPutOperation,
    AbstractClearOptions,
    AbstractIterator,
    AbstractIteratorOptions,
    AbstractLevel,
    AbstractSublevel,
    AbstractSublevelOptions,
    NodeCallback,
} from 'abstract-level';
import {
    BatchOptions,
    DatabaseOptions,
    DelOptions,
    GetManyOptions,
    GetOptions,
    Level,
    OpenOptions,
    PutOptions,
} from 'level';
import UUID from 'pure-uuid';
import { Feed, Friend } from '../interfaces/db.js';
import { getSequence } from '../utils/sequence.js';
import { ShareIterator } from './share-iterator.js';
import { logger } from '../utils/logger.js';
import { base64Encode } from '../utils/base64.js';

export class ShareLevel<V = string> extends AbstractLevel<any, string, V> {
    private _id: string;
    private _location: string;

    private _db!: Level<string, any>;
    private _meta!: AbstractSublevel<Level<string, any>, any, string, string>;
    private _feed!: AbstractSublevel<Level<string, any>, any, string, Feed>;
    private _data!: AbstractSublevel<Level<string, any>, any, string, V>;
    private _friends!: AbstractSublevel<Level<string, any>, any, string, Friend>;
    private _index!: AbstractSublevel<Level<string, any>, any, string, string>;
    private _sequence: string;
    private _options: DatabaseOptions<string, V> | undefined;

    constructor(location: string, options?: DatabaseOptions<string, V> | undefined) {
        super(
            {
                encodings: {
                    utf8: true,
                    buffer: true,
                    view: true,
                },
                seek: false,
            },
            options,
        );
        this._options = options;
        this._location = location;
        this._id = new UUID(4).format('std'); // default id
        this._sequence = getSequence(); // zero
    }

    ////////////////////////////////// LEVEL

    async _init(options: OpenOptions) {
        this._db = new Level<string, any>(this._location, options);
        this._meta = this._db.sublevel<string, string>('__meta', { keyEncoding: 'utf8', valueEncoding: 'json' });
        this._feed = this._db.sublevel<string, Feed>('__feed', { keyEncoding: 'utf8', valueEncoding: 'json' });
        this._index = this._db.sublevel<string, any>('__index', {
            valueEncoding: 'utf8',
            keyEncoding: 'utf8',
        });
        this._data = this._db.sublevel<string, V>('__data', {
            keyEncoding: 'utf8',
            valueEncoding: this._options?.valueEncoding,
        });
        this._friends = this._db.sublevel<string, Friend>('__friends', { keyEncoding: 'utf8', valueEncoding: 'json' });

        // load meta
        try {
            this._id = await this._meta.get('__id');
        } catch (error) {
            await this._meta.put('__id', this._id); // save id on db
        }

        // load starting sequence
        try {
            for await (const key of this._feed.keys({ limit: 1, reverse: true })) {
                this._sequence = key;
            }
        } catch (error) {
            logger.warn('Error', error);
        }
    }

    _open(_options: OpenOptions, callback: NodeCallback<void>): void {
        this._init(_options).then(() => {
            this.nextTick(callback);
        });
    }

    _close(callback: NodeCallback<void>) {
        this._db.close(callback);
    }

    ///////// GET
    _get(key: string, options: GetOptions<string, V>, callback: NodeCallback<V>) {
        this._internalGet(key, options)
            .then((result) => {
                this.nextTick(() => {
                    callback(null, result);
                });
            })
            .catch((error) => {
                this.nextTick(() => {
                    callback(error);
                });
            });
    }

    async _internalGet(key: string, options: GetOptions<string, V>) {
        const realKey = await this._index.get(key, {
            valueEncoding: 'utf8',
        });
        return await this._data.get(realKey, { ...options, keyEncoding: 'utf8' });
    }

    ///////// GET MANY
    _getMany(keys: string[], options: GetManyOptions<string, V>, callback: NodeCallback<(V | undefined)[]>) {
        this._internalGetMany(keys, options)
            .then((result) => {
                this.nextTick(() => callback(null, result));
            })
            .catch((error) => {
                this.nextTick(() => callback(error));
            });
    }

    async _internalGetMany(keys: string[], options: GetManyOptions<string, V>): Promise<(V | undefined)[]> {
        let realKeys = await this._index.getMany(keys, { valueEncoding: 'utf8' });
        const result: (V | undefined)[] = [];
        for (const key of realKeys) {
            if (!key) {
                result.push(undefined);
                continue;
            }
            try {
                result.push(await this._data.get(key, { ...options, keyEncoding: 'utf8' }));
            } catch (e) {
                //@ts-ignore
                if (e?.code == 'LEVEL_NOT_FOUND') result.push(undefined);
                else throw e;
            }
        }
        return result;
    }

    //////// CLEAR
    _clear(options: AbstractClearOptions<string>, callback: NodeCallback<void>) {
        this._internalClear(options)
            .then((result) => {
                this.nextTick(() => callback(null, result));
            })
            .catch((error) => {
                this.nextTick(() => callback(error));
            });
    }

    async _internalClear(options: AbstractClearOptions<string>) {
        for await (const key of this.keys(options)) {
            await this.del(key);
        }
    }

    //////// PUT & DEL
    _put(key: string, value: V, options: PutOptions<string, V>, callback: NodeCallback<void>) {
        // use batch for put
        let op = { type: 'put', key: key, value: value } as AbstractBatchPutOperation<this, string, V>;
        if (options.keyEncoding) op.keyEncoding = options.keyEncoding;
        if (options.valueEncoding) op.valueEncoding = options.valueEncoding;
        this.batch([op], callback);
    }

    _del(key: string, options: DelOptions<string>, callback: NodeCallback<void>) {
        // use batch for del
        let op = { type: 'del', key: key } as AbstractBatchDelOperation<this, string>;
        if (options.keyEncoding) op.keyEncoding = options.keyEncoding;
        this.batch([op], callback);
    }

    _batch(
        operations: (
            | AbstractBatchPutOperation<Level<string, V>, string, V>
            | AbstractBatchDelOperation<Level<string, V>, string>
        )[],
        options: BatchOptions<string, V>,
        callback: NodeCallback<void>,
    ) {
        this._getOperations(operations)
            .then((newOperations) => {
                this._db.batch<string, any>(newOperations, options, callback);
            })
            .catch((error) => {
                this.nextTick(() => {
                    callback(error);
                });
            });
    }

    async _getOperations(
        operations: (
            | AbstractBatchPutOperation<Level<string, V>, string, V>
            | AbstractBatchDelOperation<Level<string, V>, string>
        )[],
    ): Promise<
        (
            | AbstractBatchPutOperation<Level<string, V>, string, any>
            | AbstractBatchDelOperation<Level<string, V>, string>
        )[]
    > {
        const newOperations = [] as (
            | AbstractBatchPutOperation<Level<string, any>, string, any>
            | AbstractBatchDelOperation<Level<string, any>, string>
        )[];

        for (const operation of operations) {
            const type = operation.type;
            const key = operation.key;

            this._sequence = getSequence(this._sequence);
            let seq = getSequence();
            try {
                const dataIt = this._data.keys({ reverse: true, limit: 1 });
                const key = await dataIt.next();
                if (key) {
                    const split = key.split('#', 2);
                    seq = getSequence(split[1]);
                }
            } catch (e) {
                // do nothing
            }

            // add operations
            if (operation.type == 'put') {
                newOperations.push({
                    type: 'put',
                    key: key,
                    value: `${key}#${seq}`,
                    keyEncoding: 'utf8',
                    valueEncoding: 'utf8',
                    sublevel: this._index,
                });
            } else {
                newOperations.push({
                    type: 'del',
                    key: key,
                    keyEncoding: 'utf8',
                    sublevel: this._index,
                });
            }

            newOperations.push({
                type: 'put',
                key: this._sequence,
                value: {
                    key,
                    seq,
                    type,
                },
                sublevel: this._feed,
            });

            newOperations.push({
                type: 'put',
                key: `${key}#${seq}`,
                value: operation.type == 'put' ? operation.value : '__del__',
                keyEncoding: 'utf8',
                valueEncoding: operation.type == 'put' ? operation.valueEncoding : 'utf8',
                sublevel: this._data,
            });
        }

        return newOperations;
    }

    _iterator(options: AbstractIteratorOptions<string, V>) {
        return new ShareIterator<V>(this, options);
    }

    async importFeed({
        transaction,
        feed,
        endSeq,
        startSeq,
        otherId,
    }: {
        transaction: string;
        feed: [string, Feed][];
        startSeq?: string;
        endSeq: string;
        otherId: string;
    }): Promise<string[]> {
        const friendsLevel = this.friends;
        const dataLevel = this.data;
        const feedLevel = this.feed;
        const indexLevel = this.index;
        const realDb = this.realdb;

        // 1 - add friend
        let batch = realDb.batch();
        const friendItem: Friend = { seq: endSeq!, lastSeen: new Date() };
        batch = batch.put(otherId, friendItem, { sublevel: friendsLevel });
        const modKeys = feed.map((item) => item[1].key);
        const toFix = new Map<string, string>();

        // 2 - move current feed up
        const fUpOpt: any = { lte: endSeq };
        if (startSeq) {
            fUpOpt['gt'] = startSeq;
        }
        for await (const [_, value] of feedLevel.iterator(fUpOpt)) {
            const seq = this._getIncrementSequence();
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
        const toGet: Set<string> = new Set();
        for (const [key, value] of feed) {
            // 4 - add feed
            batch = batch.put(key, value, { sublevel: feedLevel });

            // 5 - add data with placeholder value
            const strKey = typeof value.key == 'string' ? value.key : base64Encode(value.key);
            const dataKey = `${strKey}#${value.seq}`;
            const dataValue = value.type ? `__${otherId}__` : '__del__';
            batch = batch.put(dataKey, dataValue, { sublevel: dataLevel, valueEncoding: 'utf8' });

            // 6 - add index  &  7 - add to download
            if (value.type == 'put') {
                batch = batch.put(value.key, dataKey, { sublevel: indexLevel });
                toGet.add(dataKey);
            } else {
                batch = batch.del(value.key, { sublevel: indexLevel });
                toGet.delete(dataKey);
            }
        }

        batch.write();
        return Array.from(toGet);
    }

    get realdb() {
        return this._db;
    }

    get index() {
        return this._index;
    }

    get data() {
        return this._data;
    }

    get feed() {
        return this._feed;
    }

    get friends() {
        return this._friends;
    }

    get id() {
        return this._id;
    }

    private _getIncrementSequence() {
        this._sequence = getSequence(this._sequence);
        return this._sequence;
    }
}
