import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ShareLevel, AbstractSyncClient } from '@kele23/levelshare';

export type ClientConfig = AxiosRequestConfig<any> & {};

export class SyncHttpClient extends AbstractSyncClient {
    private _axios: AxiosInstance;

    constructor(db: ShareLevel<unknown>, baseURL: string, options?: ClientConfig) {
        super(db);
        this._axios = axios.create({ ...options, baseURL });
    }

    protected async send(data: Uint8Array): Promise<Uint8Array> {
        const response = await this._axios.post('/db', data, {
            responseType: 'blob',
            headers: {
                'Content-Type': 'application/octet-stream',
                Accept: 'application/octet-stream',
            },
        });
        return new Uint8Array(await response.data.arrayBuffer());
    }
}
