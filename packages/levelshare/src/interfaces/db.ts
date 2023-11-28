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
