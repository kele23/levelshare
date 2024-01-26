import { ShareLevel, SyncServer } from '@kele23/levelshare';
import { Level } from 'level';

const syncrers = new Map<string, SyncServer>();

export const getShareLevel = async (name: string, db: Level<string, any>): Promise<SyncServer> => {
    let server = syncrers.get(name);
    if (server) {
        await Promise.resolve();
        return server;
    }

    // load sublevel into sharelevel
    const level = db.sublevel<string, any>(name, {
        keyEncoding: 'utf8',
        valueEncoding: 'buffer',
    }) as unknown as Level<string, any>;
    const share = new ShareLevel<any>({ level });
    await share.open();

    // create sync server
    server = new SyncServer(share);

    // return
    syncrers.set(name, server);
    return server;
};
