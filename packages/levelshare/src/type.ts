import { ChainedBatch, Level } from 'level';

export type Operation = 'put' | 'del';

export interface Feed {
    key: string;
    seq: string;
    type: Operation;
}

export interface Friend {
    seq: string;
    lastSeen: Date;
}

export type FeedImportResult = {
    toGet: string[];
    batch: ChainedBatch<Level<string, any>, string, any>;
    from: string;
    to: string;
}