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
import { Feed, Friend } from '../type.js';
import { logger } from '../utils/logger.js';
import { nextSequence } from '../utils/sequence.js';
import { ShareIterator } from './share-iterator.js';

export class ShareLevel<V = string> extends AbstractLevel<any, string, V> {
    protected _id: string;
    protected _location?: string;
    protected _level?: Level<string, any>;

    protected _db!: Level<string, any>;
    protected _feed!: AbstractSublevel<Level<string, any>, any, string, Feed>;
    protected _data!: AbstractSublevel<Level<string, any>, any, string, V>;
    protected _friends!: AbstractSublevel<Level<string, any>, any, string, Friend>;
    protected _local!: AbstractSublevel<Level<string, any>, any, string, V>;
    protected _index!: AbstractSublevel<Level<string, any>, any, string, string>;
    protected _sequence: string;
    protected _options: DatabaseOptions<string, V> | undefined;

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
        this._sequence = nextSequence(); // zero
    }

    ////////////////////////////////// LEVEL

    async _init(options: OpenOptions) {
        if (this._level) this._db = this._level;
        else this._db = new Level<string, any>(this._location || 'db', options);
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
            this._id = await this._db.get('__id');
        } catch (error) {
            await this._db.put('__id', this._id); // save id on db
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
            const seq = this._sequence;

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

            // next
            this._sequence = nextSequence(this._sequence);
        }

        return newOperations;
    }

    _iterator(options: AbstractIteratorOptions<string, V>) {
        return new ShareIterator<V>(this, options);
    }

    /**
     * @returns The current sequence
     */
    async getSequence() {
        if (this.status === 'opening') {
            await new Promise((resolve) => this.defer(() => resolve));
        }
        return this._sequence;
    }

    /**
     * @returns The current sequence
     */
    async getId() {
        if (this.status === 'opening') {
            await new Promise((resolve) => this.defer(() => resolve));
        }
        return this._id;
    }

    /**
     * @returns A Local level that is not syncronized
     */
    async getLocalLevel(): Promise<AbstractSublevel<Level<string, any>, any, string, V>> {
        if (this.status === 'opening') {
            await new Promise((resolve) => this.defer(() => resolve));
        }
        return new Promise((resolve) => this.nextTick(() => resolve(this._local)));
    }

    /**
     * @returns The feed level
     */
    async getFeedLevel(): Promise<AbstractSublevel<Level<string, any>, any, string, Feed>> {
        if (this.status === 'opening') {
            await new Promise((resolve) => this.defer(() => resolve));
        }
        return new Promise((resolve) => this.nextTick(() => resolve(this._feed)));
    }

    /** @internal */
    get id() {
        return this._id;
    }

    /** @internal */
    get sequence() {
        return this._sequence;
    }

    /** @internal */
    set sequence(sequence) {
        this._sequence = sequence;
    }

    /** @internal */
    get index() {
        return this._index;
    }

    /** @internal */
    get data() {
        return this._data;
    }

    /** @internal */
    get realdb() {
        return this._db;
    }

    /** @internal */
    get feed() {
        return this._feed;
    }

    /** @internal */
    get friends() {
        return this._friends;
    }
}
