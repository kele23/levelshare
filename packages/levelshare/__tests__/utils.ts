import { ShareLevel, AbstractSyncClient, AbstractSyncServer } from '../src/index.js';

export type T = {
    assert: (result: boolean) => void;
};

export const test = async (name: string, fn: (t: T) => Promise<void>) => {
    const t = {
        assert: (result: boolean) => {
            console.log(`Test: ${name} ${result ? 'passet' : 'failed'}`);
        },
    };
    await fn(t);
};

export async function printDB(title: string, db: ShareLevel<any>) {
    console.log('----------- ' + title + '---------------');
    let tmp = '[';
    for await (const [key, value] of db.realdb.iterator()) {
        tmp += ` [${key}, ${value}] `;
    }
    tmp += ']';
    console.log(tmp);
}

export class TestSyncServer extends AbstractSyncServer {}

export class TestSyncClient extends AbstractSyncClient {
    private _server: TestSyncServer;

    constructor(db: ShareLevel<any>, server: TestSyncServer) {
        super(db);
        this._server = server;
    }

    protected send(data: Uint8Array): Promise<Uint8Array> {
        return new Promise((resolve) => {
            this._db.nextTick(async () => {
                resolve(await this._server.receive(data));
            });
        });
    }
}
