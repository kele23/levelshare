import {
    AbstractBatchDelOperation,
    AbstractBatchPutOperation,
    AbstractClearOptions,
    AbstractIteratorOptions,
    AbstractLevel,
    AbstractSublevel,
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

export class ShareLevel<V = string> extends AbstractLevel<any, string, V> {
    private _id: string;
    private _location?: string;
    private _level?: Level<string, any>;

    private _db!: Level<string, any>;
    private _meta!: AbstractSublevel<Level<string, any>, any, string, string>;
    private _feed!: AbstractSublevel<Level<string, any>, any, string, Feed>;
    private _data!: AbstractSublevel<Level<string, any>, any, string, V>;
    private _local!: AbstractSublevel<Level<string, any>, any, string, V>;
    private _friends!: AbstractSublevel<Level<string, any>, any, string, Friend>;
    private _index!: AbstractSublevel<Level<string, any>, any, string, string>;
    private _sequence: string;
    private _options: DatabaseOptions<string, V> | undefined;

    constructor(
        { location, level, id }: { location?: string; level?: Level<string, any>; id?: string },
        options?: DatabaseOptions<string, V> | undefined,
    ) {
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
        this._level = level;
        this._id = id ? id : new UUID(4).format('std'); // default id
        this._sequence = getSequence(); // zero
    }

    ////////////////////////////////// LEVEL

    async _init(options: OpenOptions) {
        if (this._level) this._db = this._level;
        else this._db = new Level<string, any>(this._location || 'db', options);
        this._meta = this._db.sublevel<string, string>('__meta', { keyEncoding: 'utf8', valueEncoding: 'json' });
        this._feed = this._db.sublevel<string, Feed>('__feed', { keyEncoding: 'utf8', valueEncoding: 'json' });
        this._index = this._db.sublevel<string, string>('__index', {
            valueEncoding: 'utf8',
            keyEncoding: 'utf8',
        });
        this._local = this._db.sublevel<string, V>('__local', {
            keyEncoding: 'utf8',
            valueEncoding: this._options?.valueEncoding,
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
        const newOperations = this._getOperations(operations);
        this._db.batch<string, any>(newOperations, options, callback);
    }

    _getOperations(
        operations: (
            | AbstractBatchPutOperation<Level<string, V>, string, V>
            | AbstractBatchDelOperation<Level<string, V>, string>
        )[],
    ): (
        | AbstractBatchPutOperation<Level<string, V>, string, any>
        | AbstractBatchDelOperation<Level<string, V>, string>
    )[] {
        const newOperations = [] as (
            | AbstractBatchPutOperation<Level<string, any>, string, any>
            | AbstractBatchDelOperation<Level<string, any>, string>
        )[];

        for (const operation of operations) {
            const type = operation.type;
            const key = operation.key;

            const seq = this._getIncrementSequence();

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
                key: seq,
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

    /**
     * Import a Feed from another ShareLevel
     * @param param0
     * @returns A list of elements to download from the other ShareLevel
     */
    async importFeed({
        feed,
        endSeq,
        startSeq,
        otherId,
        direction,
    }: {
        feed: [string, Feed][];
        startSeq?: string;
        endSeq: string;
        otherId: string;
        direction: 'pull' | 'push';
    }): Promise<string[]> {
        const friendsLevel = this._friends;
        const dataLevel = this._data;
        const feedLevel = this._feed;
        const indexLevel = this._index;
        const realDb = this._db;

        // 1 - add friend
        let batch = realDb.batch();
        const friendItem: Friend = { seq: endSeq!, lastSeen: new Date() };
        batch = batch.put(otherId, friendItem, { sublevel: friendsLevel });
        const modKeys = feed.map((item) => item[1].key);

        // pull ( rebase my feed on top of remote feed )
        // push ( put remote feed on top of my feed )
        if (direction == 'pull') {
            // 2 - move current feed on top of endSeq
            const currSeq = this._sequence;
            this._sequence = endSeq; // TODO: Calculate and set last sequence value directly 
            
            // 3 - move current feed up, over imported feed
            const fUpOpt: any = { lte: currSeq };
            if (startSeq) {
                fUpOpt['gt'] = startSeq;
            }
            for await (const [_, value] of feedLevel.iterator(fUpOpt)) {
                const seq = this._getIncrementSequence();
                const feed = value;
                const oldKey = feed.key;

                if (!modKeys.includes(oldKey)) {
                    // 3a - add feed if not in conflict
                    batch.put(seq, feed, { sublevel: feedLevel });
                } else {
                    // 3b - remove data associated to feed if in conflict
                    const dataKey = `${value.key}#${value.seq}`;
                    batch.del(dataKey, { sublevel: dataLevel });
                }
            }
        } else {
            const tmpStart = startSeq ?? getSequence();
            // check status of current feed, if not expected throw error
            if (this._sequence.localeCompare(tmpStart) < 0) {
                throw new Error('Cannot push on top of modified feed');
            }

            this._sequence = endSeq;
        }

        // iterate over feed result and
        const toGet: Set<string> = new Set();
        for (const [key, value] of feed) {
            // 4 - add feed
            batch = batch.put(key, value, { sublevel: feedLevel });

            // 5 - add data with placeholder value
            const dataKey = `${value.key}#${value.seq}`;
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

        await batch.write();
        return Array.from(toGet);
    }

    /**
     * The real levelDB used by ShareLevel
     */
    get realdb() {
        return this._db;
    }

    /**
     * Index sublevel, key => intKey
     */
    get index() {
        return this._index;
    }

    /**
     * Data sublevel, intKey => value
     */
    get data() {
        return this._data;
    }

    /**
     * Feed sublevel [Feed] - logs of all events happened on shareLevel
     */
    get feed() {
        return this._feed;
    }

    /**
     * level for mantaining friends feed references
     */
    get friends() {
        return this._friends;
    }

    /**
     * Current shareLevel uniqueId
     */
    get id() {
        return this._id;
    }

    /**
     * Utility level for data that not need be syncronized
     */
    get local() {
        return this._local;
    }

    private _getIncrementSequence() {
        this._sequence = getSequence(this._sequence);
        return this._sequence;
    }
}
