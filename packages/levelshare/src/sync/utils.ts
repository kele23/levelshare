import { ShareLevel } from '../index.js';
import { Feed, FeedImportResult, Friend } from '../type.js';
import { getSequence } from '../utils/sequence.js';

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
        // 2 - move current feed on top of endSeq
        const currSeq = shareLevel.sequence;
        shareLevel.sequence = endSeq; // TODO: Calculate and set last sequence value directly
        let tmpSeq = shareLevel.sequence;

        // increment sequence to last (sync)
        while (shareLevel.sequence.localeCompare(currSeq) <= 0) {
            shareLevel.getIncrementSequence();
        }

        // 3 - move current feed up, over imported feed
        const fUpOpt: any = { lte: currSeq };
        if (startSeq) {
            fUpOpt['gt'] = startSeq;
        }
        for await (const [_, value] of feedLevel.iterator(fUpOpt)) {
            tmpSeq = getSequence(tmpSeq);
            const seq = tmpSeq;
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
        if (shareLevel.sequence.localeCompare(tmpStart) < 0) {
            throw new Error('Cannot push on top of modified feed');
        }

        shareLevel.sequence = endSeq;
    }

    // iterate over feed result and
    for (const [key, value] of feed) {
        // 4 - add feed
        batch = batch.put(key, value, { sublevel: feedLevel });

        // 5 - create data key
        const dataKey = `${value.key}#${value.seq}`;

        // 6 - add index  &  7 - add to download
        if (value.type == 'put') {
            batch = batch.put(value.key, dataKey, { sublevel: indexLevel });
            toGet.add(dataKey);
        } else {
            batch = batch.del(value.key, { sublevel: indexLevel });
            toGet.delete(dataKey);
        }
    }

    return { toGet: Array.from(toGet), batch, from: initialSeq, to: shareLevel.sequence };
};

export const emitSync = ({ shareLevel, from, to }: { shareLevel: ShareLevel; from: string; to: string }) => {
    shareLevel.emit('db:sync', { from, to });
};
