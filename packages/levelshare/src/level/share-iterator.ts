import {
    AbstractIterator,
    AbstractIteratorOptions,
    AbstractLevel,
    AbstractSublevel,
    NodeCallback,
} from 'abstract-level';
import { NextCallback } from 'abstract-level/types/abstract-iterator.js';
import { Level } from 'level';
import { ShareLevel } from './share-level.js';

export class ShareIterator<V> extends AbstractIterator<AbstractLevel<any, string, V>, string, V> {
    private _index: AbstractSublevel<Level<string, any>, any, string, string>;
    private _data: AbstractSublevel<Level<string, any>, any, string, V>;
    private _options: AbstractIteratorOptions<string, V>;
    private _iterator;

    constructor(db: ShareLevel<V>, options: AbstractIteratorOptions<string, V>) {
        super(db, options);

        this._index = db.index;
        this._data = db.data;

        this._options = options;
        this._iterator = this._index.iterator<string, string>({
            ...this._options,
            valueEncoding: 'utf8',
            keys: true,
            values: true,
        });
    }

    _nextv(size: number, options: {}, callback: NodeCallback<[[string, V]]>) {
        this._internalNextv(size, options)
            .then((result) => {
                this.db.nextTick(() => {
                    callback(null, result);
                });
            })
            .catch((error) => {
                this.db.nextTick(() => {
                    callback(error);
                });
            });
    }

    async _internalNextv(size: number, options: {}): Promise<[[string, V]]> {
        const nextv = await this._iterator.nextv(size, options);
        let realResult: any[] = [];
        for (const [key, value] of nextv) {
            realResult.push([key, await this._data.get(value, { ...this._options, keyEncoding: 'utf8' })]);
        }
        return realResult as [[string, V]];
    }

    _next(callback: NextCallback<string, V>) {
        this._internalNext()
            .then((result) => {
                if (result) {
                    const [key, value] = result;
                    this.db.nextTick(() => {
                        callback(null, key, value);
                    });
                } else {
                    this.db.nextTick(() => {
                        callback(null, result);
                    });
                }
            })
            .catch((error) => {
                this.db.nextTick(() => {
                    callback(error);
                });
            });
    }

    async _internalNext(): Promise<[string, V] | undefined> {
        const next = await this._iterator.next();
        if (next) {
            const [key, value] = next;
            return [key, await this._data.get(value, { ...this._options, keyEncoding: 'utf8' })];
        }
        return next;
    }

    _all(options: {}, callback: NodeCallback<[[string, V]]>) {
        this._internalAll(options)
            .then((result) => {
                this.db.nextTick(() => {
                    callback(null, result);
                });
            })
            .catch((error) => {
                this.db.nextTick(() => {
                    callback(error);
                });
            });
    }

    async _internalAll(options: {}): Promise<[[string, V]]> {
        const all = await this._iterator.all(options);
        const result = [];
        for (const [key, value] of all) {
            result.push([key, await this._data.get(value, { ...this._options, keyEncoding: 'utf8' })]);
        }
        return result as [[string, V]];
    }
}
