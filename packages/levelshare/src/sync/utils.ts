import { ShareLevel } from '../index.js';
import { Feed, FeedImportResult, Friend } from '../type.js';
import { compareSequence, nextSequence } from '../utils/sequence.js';

/**
 * Import a Feed from another ShareLevel
 * @param param0
 * @returns A list of elements to download from the other ShareLevel
 */
export const importFeed = async ({
    shareLevel,
    feed,
    endSeq,
    startSeq,
    otherId,
    direction,
}: {
    shareLevel: ShareLevel;
    feed: [string, Feed][];
    startSeq?: string;
    endSeq: string;
    otherId: string;
    direction: 'pull' | 'push';
}): Promise<FeedImportResult> => {
    const friendsLevel = shareLevel.friends;
    const dataLevel = shareLevel.data;
    const feedLevel = shareLevel.feed;
    const indexLevel = shareLevel.index;
    const realDb = shareLevel.realdb;

    // 0 - results
    const toGet: Set<string> = new Set();

    // 1 - add friend
    let batch = realDb.batch();
    const friendItem: Friend = { seq: endSeq!, lastSeen: new Date() };
    batch = batch.put(otherId, friendItem, { sublevel: friendsLevel });
    const modKeys = feed.map((item) => item[1].key);

    const initialSeq = shareLevel.sequence;

    // pull ( rebase my feed on top of remote feed )
    // push ( put remote feed on top of my feed )
    if (direction == 'pull') {
        // 2 - move current sequence on top of endSeq
        shareLevel.sequence = nextSequence(endSeq); // next ( sequence is always the next )
        const checkSeq = shareLevel.sequence;

        // 3 - move current feed up ( all feed ), over imported feed
        const fUpOpt: any = {};
        if (startSeq) {
            fUpOpt['gt'] = startSeq;
        }

        let newSeq = checkSeq;
        for await (const [feedKey, value] of feedLevel.iterator(fUpOpt)) {
            const feed = value;
            const oldKey = feed.key;

            if (!modKeys.includes(oldKey)) {
                // 3a - add feed if not in conflict
                batch.put(newSeq, feed, { sublevel: feedLevel });
                newSeq = nextSequence(newSeq);
            } else {
                // 3b - remove data associated to feed if in conflict & remove feed in conflict
                const dataKey = `${value.key}#${value.seq}`;
                batch.del(dataKey, { sublevel: dataLevel });
                batch.del(feedKey, { sublevel: feedLevel });
            }
        }

        // real check that no one write on feed during feed batch creation ( after is not a problem )
        if (checkSeq != shareLevel.sequence) {
            batch.close();
            throw new Error('Someone write during import feed, aborting');
        }

        shareLevel.sequence = newSeq;
    } else {
        // check status of current feed, if not expected throw error
        const tmpStart = startSeq ? nextSequence(startSeq) : nextSequence(); // next
        if (compareSequence(shareLevel.sequence, tmpStart) != 0) {
            batch.close();
            throw new Error('Cannot push on top of different feed, you need to pull before');
        }

        shareLevel.sequence = nextSequence(endSeq);
    }

    // iterate over feed result and
    for (const [key, value] of feed) {
        // 4 - add feed
        batch.put(key, value, { sublevel: feedLevel });

        // 5 - create data key
        const dataKey = `${value.key}#${value.seq}`;

        // 6 - add index  &  7 - add to download
        if (value.type == 'put') {
            batch.put(value.key, dataKey, { sublevel: indexLevel });
            batch.put(dataKey, `__${otherId}__`, { sublevel: dataLevel });
            toGet.add(dataKey);
        } else {
            batch.del(value.key, { sublevel: indexLevel });
            batch.put(dataKey, '__del__', { sublevel: dataLevel });
        }
    }

    await batch.write();
    return { toGet: Array.from(toGet), from: initialSeq, to: shareLevel.sequence };
};

export const emitSync = ({ shareLevel, from, to }: { shareLevel: ShareLevel; from: string; to: string }) => {
    shareLevel.emit('db:sync', { from, to });
};
