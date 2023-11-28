import { decode, encode } from '@msgpack/msgpack';

export const msgEncode = (data: any): Uint8Array => {
    const buff = encode(data);
    return new Uint8Array(buff.slice(buff.byteOffset, buff.byteLength));
};

export const msgDecode = <T>(data: Uint8Array): T => {
    const obj = decode(data);
    return obj as T;
};
