import { DatabaseOptions } from 'level';

export type ShareOptions = DatabaseOptions<string | Uint8Array, any> & {
    manager: string;
    autoConnect: boolean;
    interval: number;
};
